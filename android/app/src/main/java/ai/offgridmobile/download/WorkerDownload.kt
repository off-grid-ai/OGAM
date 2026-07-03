package ai.offgridmobile.download

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import android.util.Log
import android.os.Environment
import android.os.StatFs
import androidx.core.app.NotificationCompat
import androidx.work.BackoffPolicy
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkRequest
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.File
import java.io.FileOutputStream
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlinx.coroutines.Job
import org.json.JSONObject

class WorkerDownload(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    private val downloadDao = DownloadDatabase.getInstance(context).downloadDao()
    private val client = httpClient

    override suspend fun doWork(): Result {
        val downloadId = inputData.getString(KEY_DOWNLOAD_ID) ?: return Result.failure()
        val progressInterval = inputData.getLong(KEY_PROGRESS_INTERVAL, DEFAULT_PROGRESS_INTERVAL)
        val download = downloadDao.getDownload(downloadId) ?: return Result.failure()

        // Run as a foreground service so a multi-GB download keeps progressing when the
        // app is backgrounded or the screen is off. A plain CoroutineWorker gets WorkManager's
        // ~10-min window + Doze throttling, so large downloads stalled/retry-looped (the
        // Android-only "downloads never finish in background" bug). Best-effort: on Android
        // 12+ setForeground can be refused if the app can't start an FGS right now; the
        // worker still runs (just without the promotion), so never fail the download on it.
        runCatching { setForeground(createForegroundInfo(download.fileName)) }
            .onFailure { Log.w(TAG, "setForeground refused; continuing as background worker: ${it.message}") }

        if (isStopped) return handleStoppedState(downloadId, download, 0L)

        val targetFile = File(download.destination)
        targetFile.parentFile?.mkdirs()

        syncFileSizeWithDb(downloadId, targetFile, download)

        val existingBytes = if (targetFile.exists()) targetFile.length() else 0L

        val diskCheckResult = checkDiskSpace(downloadId, download, targetFile, existingBytes)
        if (diskCheckResult != null) return diskCheckResult

        downloadDao.updateStatus(downloadId, DownloadStatus.RUNNING)

        val call = client.newCall(buildRequest(download.url, existingBytes))
        val cancelHandle = coroutineContext[Job]?.invokeOnCompletion { call.cancel() }
        return try {
            call.execute().use { response ->
                handleResponse(response, existingBytes, download, downloadId, targetFile, progressInterval)
            }
        } catch (e: Exception) {
            handleDownloadException(downloadId, download, e)
        } finally {
            cancelHandle?.dispose()
        }
    }

    /** Required by expedited work as the pre-Android-12 foreground fallback. */
    override suspend fun getForegroundInfo(): ForegroundInfo = buildForegroundInfo(applicationContext, null)

    private fun createForegroundInfo(fileName: String?): ForegroundInfo =
        buildForegroundInfo(applicationContext, fileName)

    private suspend fun checkDiskSpace(downloadId: String, download: DownloadEntity, targetFile: File, existingBytes: Long): Result? {
        if (download.totalBytes <= 0L) return null
        val needed = download.totalBytes - existingBytes
        val available = StatFs(targetFile.parentFile?.absolutePath ?: download.destination).availableBytes
        if (available < needed) {
            return failDownload(downloadId, download, DownloadReason.DISK_FULL)
        }
        return null
    }

    private suspend fun handleDownloadException(downloadId: String, download: DownloadEntity, e: Exception): Result {
        if (isStopped) return handleStoppedState(downloadId, download, download.downloadedBytes)
        return failDownload(downloadId, download, DownloadReason.fromThrowable(e))
    }

    private data class StreamParams(
        val input: java.io.InputStream,
        val targetFile: File,
        val code: Int,
        val download: DownloadEntity,
        val downloadId: String,
        val currentFileBytes: Long,
        val totalBytes: Long,
        val progressInterval: Long,
    )

    private suspend fun syncFileSizeWithDb(downloadId: String, targetFile: File, download: DownloadEntity) {
        if (targetFile.exists() && targetFile.length() != download.downloadedBytes) {
            downloadDao.updateProgress(downloadId, targetFile.length(), download.totalBytes, DownloadStatus.RUNNING)
        }
    }

    private fun buildRequest(url: String, existingBytes: Long): Request {
        val builder = Request.Builder().url(url)
        if (existingBytes > 0L) {
            builder.addHeader("Range", "bytes=$existingBytes-")
        }
        return builder.build()
    }

    private suspend fun handleResponse(
        response: Response,
        existingBytes: Long,
        download: DownloadEntity,
        downloadId: String,
        targetFile: File,
        progressInterval: Long,
    ): Result {
        val code = response.code
        val earlyResult = handleResponseCode(response, code, existingBytes, download, downloadId, targetFile)
        if (earlyResult != null) return earlyResult

        val body = response.body ?: return failDownload(downloadId, download, DownloadReason.EMPTY_RESPONSE)

        val currentFileBytes = if (targetFile.exists() && code == 206) targetFile.length() else 0L
        val contentLength = body.contentLength()
        val totalBytes = calculateTotalBytes(code, currentFileBytes, contentLength, download.totalBytes)
        Log.i(
            TAG,
            "handleResponse id=$downloadId code=$code url=${download.url} existingBytes=$existingBytes currentFileBytes=$currentFileBytes contentLength=$contentLength dbExpectedBytes=${download.totalBytes} resolvedTotalBytes=$totalBytes shaPresent=${!download.expectedSha256.isNullOrEmpty()} fileName=${download.fileName}",
        )
        downloadDao.updateProgress(downloadId, currentFileBytes, totalBytes, DownloadStatus.RUNNING)

        return streamToFile(StreamParams(body.byteStream().buffered(), targetFile, code, download, downloadId, currentFileBytes, totalBytes, progressInterval))
    }

    private suspend fun handleResponseCode(
        response: Response,
        code: Int,
        existingBytes: Long,
        download: DownloadEntity,
        downloadId: String,
        targetFile: File,
    ): Result? {
        return when {
            existingBytes > 0L && code == 200 -> {
                if (!targetFile.delete()) Log.w(TAG, "Failed to delete stale file for re-download: ${targetFile.path}")
                null
            }
            code == 416 -> {
                if (!targetFile.delete()) Log.w(TAG, "Failed to delete file on 416: ${targetFile.path}")
                failDownload(downloadId, download, DownloadReason.HTTP_416)
            }
            !response.isSuccessful -> failDownload(downloadId, download, DownloadReason.fromHttpCode(code))
            else -> null
        }
    }

    private suspend fun streamToFile(params: StreamParams): Result {
        val (input, targetFile, code, download, downloadId, currentFileBytes, totalBytes, progressInterval) = params
        val appendMode = targetFile.exists() && code == 206
        var bytesWritten = currentFileBytes
        var lastProgressAt = 0L

        FileOutputStream(targetFile, appendMode).buffered().use { output ->
            input.use { src ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                var read = src.read(buffer)
                while (read >= 0) {
                    if (isStopped) return handleStoppedState(downloadId, download, bytesWritten)

                    output.write(buffer, 0, read)
                    bytesWritten += read

                    val now = System.currentTimeMillis()
                    if (now - lastProgressAt >= progressInterval) {
                        emitProgressUpdate(downloadId, bytesWritten, totalBytes)
                        lastProgressAt = now
                    }
                    read = src.read(buffer)
                }
            }
        }

        val authoritativeExpectedBytes = when {
            totalBytes > 0L -> totalBytes
            download.totalBytes > 0L -> download.totalBytes
            else -> 0L
        }
        Log.i(
            TAG,
            "streamToFile complete id=$downloadId file=${download.fileName} actualBytes=$bytesWritten dbExpectedBytes=${download.totalBytes} responseExpectedBytes=$totalBytes authoritativeExpectedBytes=$authoritativeExpectedBytes shaPresent=${!download.expectedSha256.isNullOrEmpty()}",
        )
        // Curated entries (offgrid/* namespace) opt out of strict size validation
        // because their URLs are pinned to a commit hash — the URL itself is the
        // integrity guarantee, matching how the Google AI Edge Gallery app handles
        // its LiteRT models. A transient Content-Length / payload undershoot from
        // the CDN should not be treated as corruption when no SHA is available.
        val skipSizeValidation = parseSkipSizeValidation(download.metadataJson)
        if (authoritativeExpectedBytes > 0L && !skipSizeValidation) {
            val sizeDiffPercent = abs(bytesWritten - authoritativeExpectedBytes).toDouble() / authoritativeExpectedBytes
            if (sizeDiffPercent > 0.001) {
                // A meaningful final size mismatch is corruption unless a known SHA can
                // explicitly prove the downloaded file is still the expected artifact.
                val expectedSha256 = download.expectedSha256
                if (expectedSha256.isNullOrEmpty()) {
                    Log.w(
                        TAG,
                        "streamToFile size mismatch without SHA id=$downloadId file=${download.fileName} actualBytes=$bytesWritten authoritativeExpectedBytes=$authoritativeExpectedBytes dbExpectedBytes=${download.totalBytes} responseExpectedBytes=$totalBytes",
                    )
                    if (!targetFile.delete()) Log.w(TAG, "Failed to delete size-mismatched file: ${targetFile.path}")
                    return failDownload(downloadId, download, DownloadReason.FILE_CORRUPTED)
                }

                val actual = computeFileSha256(targetFile)
                Log.w(
                    TAG,
                    "streamToFile size mismatch with SHA id=$downloadId file=${download.fileName} actualBytes=$bytesWritten authoritativeExpectedBytes=$authoritativeExpectedBytes shaMatch=${actual.lowercase() == expectedSha256.lowercase()}",
                )
                if (actual.lowercase() != expectedSha256.lowercase()) {
                    if (!targetFile.delete()) Log.w(TAG, "Failed to delete corrupted file: ${targetFile.path}")
                    return failDownload(downloadId, download, DownloadReason.FILE_CORRUPTED)
                }
            }
        }

        downloadDao.updateProgress(downloadId, bytesWritten, totalBytes, DownloadStatus.COMPLETED)
        return Result.success()
    }

    private suspend fun emitProgressUpdate(downloadId: String, bytesWritten: Long, totalBytes: Long) {
        setProgress(workDataOf(KEY_PROGRESS to bytesWritten, KEY_TOTAL to totalBytes))
        downloadDao.updateProgress(downloadId, bytesWritten, totalBytes, DownloadStatus.RUNNING)
    }

    private fun parseSkipSizeValidation(metadataJson: String?): Boolean {
        if (metadataJson.isNullOrEmpty()) return false
        return try {
            JSONObject(metadataJson).optBoolean("skipSizeValidation", false)
        } catch (e: Exception) {
            Log.w(TAG, "parseSkipSizeValidation — invalid metadataJson, defaulting to false: ${e.message}")
            false
        }
    }

    private suspend fun failDownload(downloadId: String, download: DownloadEntity, reasonCode: String): Result {
        val uiReason = DownloadReason.messageFor(reasonCode) ?: DownloadReason.messageFor(DownloadReason.UNKNOWN_ERROR)!!
        downloadDao.updateStatus(downloadId, DownloadStatus.FAILED, reasonCode)
        DownloadEventBridge.error(downloadId, download.fileName, download.modelId, uiReason, reasonCode)
        return Result.failure()
    }

    private suspend fun handleStoppedState(downloadId: String, download: DownloadEntity, bytesWritten: Long): Result {
        val current = downloadDao.getDownload(downloadId) ?: download
        return if (current.status == DownloadStatus.CANCELLED) {
            val partialFile = File(current.destination)
            if (partialFile.exists()) partialFile.delete()
            Result.failure()
        } else {
            // System stopped the worker — retry silently, no JS state change.
            downloadDao.updateProgress(downloadId, bytesWritten, current.totalBytes, DownloadStatus.QUEUED)
            Result.retry()
        }
    }

    companion object {
        private const val TAG = "WorkerDownload"

        val httpClient: OkHttpClient = OkHttpClient.Builder()
            .retryOnConnectionFailure(true)
            .followRedirects(true)
            .followSslRedirects(true)
            .build()

        const val DEFAULT_PROGRESS_INTERVAL = 1500L
        private const val DOWNLOAD_CHANNEL_ID = "model_downloads"
        private const val DOWNLOAD_NOTIFICATION_ID = 4711
        const val KEY_DOWNLOAD_ID = "download_id"
        const val KEY_PROGRESS = "progress"
        const val KEY_TOTAL = "total"
        const val KEY_PROGRESS_INTERVAL = "progress_interval"

        /**
         * The authoritative total size for the download. A successful response's
         * Content-Length is the source of truth and MUST win over the caller's
         * seeded estimate.
         *
         * Callers seed `existingTotal` only so progress can render before the first
         * byte arrives — and some (e.g. Whisper) seed it from a rounded MB figure
         * (`sizeMB * 1024 * 1024`) that never equals the exact byte count. Clamping
         * the real Content-Length UP to that rounded estimate made the completion
         * size check (which tolerates only a 0.1% delta) reject every such file as
         * FILE_CORRUPTED when no SHA-256 was available to vouch for it. Fall back to
         * the seeded estimate only when the server reports no length (<= 0).
         */
        internal fun calculateTotalBytes(code: Int, currentFileBytes: Long, contentLength: Long, existingTotal: Long): Long {
            return when (code) {
                206 -> if (contentLength > 0L) currentFileBytes + contentLength else existingTotal
                200 -> if (contentLength > 0L) contentLength else existingTotal
                else -> maxOf(existingTotal, contentLength)
            }
        }

        /** Build the ongoing progress notification that promotes the worker to a
         *  foreground service (dataSync type). Extracted here so it's testable with a
         *  Robolectric Context without constructing the worker. */
        internal fun buildForegroundInfo(ctx: Context, fileName: String?): ForegroundInfo {
            ensureNotificationChannel(ctx)
            val notification: Notification = NotificationCompat.Builder(ctx, DOWNLOAD_CHANNEL_ID)
                .setContentTitle("Downloading model")
                .setContentText(fileName ?: "Preparing download")
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build()
            return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ForegroundInfo(DOWNLOAD_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            } else {
                ForegroundInfo(DOWNLOAD_NOTIFICATION_ID, notification)
            }
        }

        internal fun ensureNotificationChannel(ctx: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val mgr = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (mgr.getNotificationChannel(DOWNLOAD_CHANNEL_ID) != null) return
            mgr.createNotificationChannel(
                NotificationChannel(DOWNLOAD_CHANNEL_ID, "Model downloads", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Keeps large model downloads running in the background"
                }
            )
        }

        internal fun computeFileSha256(file: File): String {
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().buffered().use { input ->
                val buf = ByteArray(DEFAULT_BUFFER_SIZE)
                var n = input.read(buf)
                while (n >= 0) {
                    digest.update(buf, 0, n)
                    n = input.read(buf)
                }
            }
            return digest.digest().joinToString("") { "%02x".format(it) }
        }

        private val allowedDownloadHosts = setOf(
            "huggingface.co",
            "cdn-lfs.huggingface.co",
            "cas-bridge.xethub.hf.co",
        )

        fun isHostAllowed(url: String): Boolean {
            val host = try { URI(url).host } catch (_: Exception) { return false }
            if (host == null) return false
            return allowedDownloadHosts.any { host == it || host.endsWith(".$it") }
        }

        fun enqueue(
            context: Context,
            downloadId: String,
            progressInterval: Long = DEFAULT_PROGRESS_INTERVAL,
        ): OneTimeWorkRequest {
            val request = OneTimeWorkRequestBuilder<WorkerDownload>()
                .setConstraints(
                    androidx.work.Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    WorkRequest.MIN_BACKOFF_MILLIS,
                    TimeUnit.MILLISECONDS,
                )
                // Start expedited when the OS allows it; fall back to a normal (still
                // foreground-promoted via setForeground) run otherwise, so we never
                // fail to enqueue when the expedited quota is exhausted.
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .setInputData(
                    workDataOf(
                        KEY_DOWNLOAD_ID to downloadId,
                        KEY_PROGRESS_INTERVAL to progressInterval,
                    )
                )
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                workName(downloadId),
                ExistingWorkPolicy.REPLACE,
                request,
            )
            return request
        }

        fun cancel(context: Context, downloadId: String) {
            WorkManager.getInstance(context).cancelUniqueWork(workName(downloadId))
        }

        fun workName(downloadId: String) = "download_$downloadId"
    }
}
