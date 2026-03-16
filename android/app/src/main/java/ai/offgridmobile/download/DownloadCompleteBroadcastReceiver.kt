package ai.offgridmobile.download

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * BroadcastReceiver that handles download completion events from Android's DownloadManager.
 * This receiver runs even when the app is killed, ensuring completed downloads are tracked.
 *
 * When the app restarts, it can check SharedPreferences for completed downloads
 * and move them to the appropriate location.
 *
 * Security: This receiver is exported (required to receive system DOWNLOAD_COMPLETE broadcasts).
 * To mitigate spoofed intents, we validate the download ID against both our persisted list
 * and the DownloadManager itself — a spoofed ID that isn't tracked by either is silently dropped.
 */
class DownloadCompleteBroadcastReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "DownloadCompleteRcv"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return

        val downloadId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
        if (downloadId == -1L) return

        // Validate that DownloadManager actually knows about this download ID.
        // This guards against spoofed intents from other apps sending fake IDs.
        val downloadManager = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val probe = downloadManager.query(DownloadManager.Query().setFilterById(downloadId))
        val knownBySystem = probe?.use { it.moveToFirst() } ?: false
        if (!knownBySystem) {
            Log.w(TAG, "Ignoring DOWNLOAD_COMPLETE for unknown download ID: $downloadId (possible spoofed intent)")
            return
        }

        val sharedPrefs = context.getSharedPreferences(
            DownloadManagerModule.PREFS_NAME,
            Context.MODE_PRIVATE
        )
        val downloads = parseDownloads(sharedPrefs.getString(DownloadManagerModule.DOWNLOADS_KEY, "[]")) ?: return
        val (downloadInfo, downloadIndex) = findDownload(downloads, downloadId) ?: return

        applyDownloadResult(downloadManager, downloadId, downloadInfo) ?: return

        downloads.put(downloadIndex, downloadInfo)
        sharedPrefs.edit()
            .putString(DownloadManagerModule.DOWNLOADS_KEY, downloads.toString())
            .apply()
    }

    private fun parseDownloads(json: String?): JSONArray? = try {
        JSONArray(json ?: "[]")
    } catch (e: Exception) {
        null
    }

    private fun findDownload(downloads: JSONArray, downloadId: Long): Pair<JSONObject, Int>? {
        for (i in 0 until downloads.length()) {
            val download = downloads.getJSONObject(i)
            if (download.getLong("downloadId") == downloadId) return Pair(download, i)
        }
        return null
    }

    private fun applyDownloadResult(
        downloadManager: DownloadManager,
        downloadId: Long,
        downloadInfo: JSONObject,
    ): Unit? {
        val cursor = downloadManager.query(DownloadManager.Query().setFilterById(downloadId))
        return cursor?.use {
            if (!it.moveToFirst()) return@use null
            val status = it.getColumnIndex(DownloadManager.COLUMN_STATUS).let { idx -> if (idx >= 0) it.getInt(idx) else -1 }
            val localUri = it.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI).let { idx -> if (idx >= 0) it.getString(idx) else null }
            val reason = it.getColumnIndex(DownloadManager.COLUMN_REASON).let { idx -> if (idx >= 0) it.getInt(idx) else 0 }
            when (status) {
                DownloadManager.STATUS_SUCCESSFUL -> {
                    downloadInfo.put("status", "completed")
                    downloadInfo.put("localUri", localUri ?: "")
                    downloadInfo.put("completedAt", System.currentTimeMillis())
                }
                DownloadManager.STATUS_FAILED -> {
                    downloadInfo.put("status", "failed")
                    downloadInfo.put("failureReason", reasonToString(reason))
                    downloadInfo.put("completedAt", System.currentTimeMillis())
                }
            }
        }
    }

    private fun reasonToString(reason: Int): String = when (reason) {
        DownloadManager.ERROR_CANNOT_RESUME -> "Cannot resume"
        DownloadManager.ERROR_DEVICE_NOT_FOUND -> "Device not found"
        DownloadManager.ERROR_FILE_ALREADY_EXISTS -> "File already exists"
        DownloadManager.ERROR_FILE_ERROR -> "File error"
        DownloadManager.ERROR_HTTP_DATA_ERROR -> "HTTP data error"
        DownloadManager.ERROR_INSUFFICIENT_SPACE -> "Insufficient space"
        DownloadManager.ERROR_TOO_MANY_REDIRECTS -> "Too many redirects"
        DownloadManager.ERROR_UNHANDLED_HTTP_CODE -> "Unhandled HTTP code"
        DownloadManager.ERROR_UNKNOWN -> "Unknown error"
        else -> "Error: $reason"
    }
}
