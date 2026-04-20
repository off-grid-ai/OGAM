package ai.offgridmobile.download

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import java.util.concurrent.ConcurrentHashMap

/**
 * Foreground service that keeps model downloads running at high priority.
 *
 * The service is stateful: the companion object holds a ConcurrentHashMap of
 * every active download. Any worker calling update() writes its current progress
 * into the map, then triggers onStartCommand which rebuilds the notification from
 * the full map state. This eliminates two flickering bugs:
 *
 *   1. Vision models (GGUF + mmproj): both workers update their own map entry;
 *      the notification always shows the model title and combined progress.
 *
 *   2. Multiple simultaneous downloads: each has its own entry; the notification
 *      shows aggregate progress across all of them rather than round-robining.
 *
 * Call remove() when a download completes or fails to drop it from the map and
 * refresh (or stop) the notification.
 */
class DownloadForegroundService : Service() {

    companion object {
        private const val CHANNEL_ID = "offgrid_download_channel"
        private const val NOTIFICATION_ID = 9001
        private const val DEFAULT_TITLE = "Downloading model…"
        private const val PROGRESS_MAX = 100

        /** One entry per active downloadId. Thread-safe. */
        private val activeDownloads = ConcurrentHashMap<Long, DownloadEntry>()

        data class DownloadEntry(
            val modelTitle: String,
            val bytesDownloaded: Long,
            val totalBytes: Long,
            /** True for mmproj / secondary files of a vision model. */
            val isSecondary: Boolean,
            val statusText: String,
        )

        /**
         * Update progress for one download and refresh the notification.
         * Safe to call from any thread at any frequency.
         */
        fun update(
            context: Context,
            downloadId: Long,
            modelTitle: String,
            bytesDownloaded: Long = 0L,
            totalBytes: Long = 0L,
            isSecondary: Boolean = false,
            statusText: String = "Downloading",
        ) {
            activeDownloads[downloadId] = DownloadEntry(
                modelTitle = modelTitle.ifEmpty { DEFAULT_TITLE },
                bytesDownloaded = bytesDownloaded,
                totalBytes = totalBytes,
                isSecondary = isSecondary,
                statusText = statusText,
            )
            startService(context)
        }

        /**
         * Remove a completed / failed / cancelled download from the map.
         * If no downloads remain the service stops; otherwise the notification
         * is refreshed to show only the still-active downloads.
         */
        fun remove(context: Context, downloadId: Long) {
            activeDownloads.remove(downloadId)
            if (activeDownloads.isEmpty()) {
                stop(context, "download $downloadId done, none remaining")
            } else {
                startService(context)
            }
        }

        fun stop(context: Context, reason: String = "unknown") {
            android.util.Log.d("DownloadService", "stop() called — reason: $reason")
            activeDownloads.clear()
            context.stopService(Intent(context, DownloadForegroundService::class.java))
        }

        private fun startService(context: Context) {
            val intent = Intent(context, DownloadForegroundService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (e: IllegalStateException) {
                // App is in the background on Android 12+ — notification skipped,
                // but WorkManager continues the download unaffected.
                android.util.Log.w("DownloadService", "Skipping foreground notification (background): ${e.message}")
            }
        }
    }

    // -------------------------------------------------------------------------

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = buildNotificationFromState()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: IllegalStateException) {
            // startForeground() can throw on Android 15+ when the dataSync time budget
            // is exhausted. Calling stopSelf() here prevents the service sitting in limbo,
            // which would otherwise trigger ForegroundServiceDidNotStartInTimeException.
            // WorkManager continues the download unaffected without the notification.
            android.util.Log.w("DownloadService", "startForeground failed, stopping service: ${e.message}")
            stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        android.util.Log.d("DownloadService", "Service destroyed")
    }

    // -------------------------------------------------------------------------
    // Notification construction
    // -------------------------------------------------------------------------

    /**
     * Builds a notification that reflects all entries currently in activeDownloads.
     *
     * Groups entries by modelTitle so that a vision model's GGUF + mmproj pair
     * appears as a single download in the notification. Multiple distinct models
     * are shown as an aggregate count + progress bar.
     */
    private fun buildNotificationFromState(): Notification {
        val entries = activeDownloads.values.toList()
        if (entries.isEmpty()) {
            return buildNotification(DEFAULT_TITLE, "Starting…", 0, true, null)
        }

        // Group by model title — GGUF and mmproj share the same title
        val byModel = entries.groupBy { it.modelTitle }
        val modelCount = byModel.size

        val totalDownloaded = entries.sumOf { it.bytesDownloaded }
        val totalSize = entries.sumOf { it.totalBytes }
        val progressPercent = if (totalSize > 0L) (totalDownloaded * PROGRESS_MAX / totalSize).toInt() else 0
        val indeterminate = totalSize <= 0L

        return if (modelCount == 1) {
            val title = byModel.keys.first()
            val contentText = buildSingleModelText(byModel.values.first(), totalDownloaded, totalSize)
            buildNotification(title, contentText, progressPercent, indeterminate, null)
        } else {
            val overallPct = if (totalSize > 0L) totalDownloaded * 100L / totalSize else 0L
            val title = "Downloading $modelCount models"
            val contentText = "${formatMb(totalDownloaded)} / ${formatMb(totalSize)} · $overallPct%"
            val inboxStyle = NotificationCompat.InboxStyle().setBigContentTitle(title)
            byModel.entries.forEach { (modelTitle, modelEntries) ->
                val dl = modelEntries.sumOf { it.bytesDownloaded }
                val total = modelEntries.sumOf { it.totalBytes }
                val pct = if (total > 0L) dl * 100L / total else 0L
                val shortTitle = if (modelTitle.length > 20) modelTitle.take(17) + "…" else modelTitle
                inboxStyle.addLine("$shortTitle  $pct%")
            }
            buildNotification(title, contentText, progressPercent, indeterminate, inboxStyle)
        }
    }

    /** Content text for a single model (may have primary + secondary files). */
    private fun buildSingleModelText(
        entries: List<DownloadEntry>,
        totalDownloaded: Long,
        totalSize: Long,
    ): String {
        val primary = entries.firstOrNull { !it.isSecondary }
        val secondary = entries.firstOrNull { it.isSecondary }

        return if (primary != null && secondary != null && secondary.totalBytes > 0L) {
            val mainPct = if (primary.totalBytes > 0L) primary.bytesDownloaded * 100L / primary.totalBytes else 0L
            val secPct = secondary.bytesDownloaded * 100L / secondary.totalBytes
            "GGUF: $mainPct% · mmproj: $secPct% (${formatMb(totalDownloaded)} / ${formatMb(totalSize)})"
        } else if (totalSize > 0L) {
            val pct = totalDownloaded * 100L / totalSize
            "$pct% · ${formatMb(totalDownloaded)} / ${formatMb(totalSize)}"
        } else {
            entries.firstOrNull()?.statusText ?: "Downloading"
        }
    }

    private fun buildNotification(
        title: String,
        contentText: String,
        progressPercent: Int,
        indeterminate: Boolean,
        style: NotificationCompat.Style?,
    ): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val contentIntent = launchIntent?.let {
            PendingIntent.getActivity(
                this, 0, it,
                PendingIntent.FLAG_UPDATE_CURRENT or
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0,
            )
        }
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(contentText)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOnlyAlertOnce(true)
            .setProgress(PROGRESS_MAX, progressPercent, indeterminate)
            .setContentIntent(contentIntent)
        if (style != null) builder.setStyle(style)
        return builder.build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Model Downloads",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Keeps model downloads running in the background"
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun formatMb(bytes: Long): String {
        return if (bytes >= 1024L * 1024L * 1024L) {
            String.format("%.1fGB", bytes / (1024.0 * 1024.0 * 1024.0))
        } else {
            "${bytes / (1024L * 1024L)}MB"
        }
    }
}
