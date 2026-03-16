package ai.offgridmobile.download

import android.app.DownloadManager
import android.content.Context
import android.content.SharedPreferences
import android.database.Cursor
import android.net.Uri
import android.os.Environment
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

class DownloadManagerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "DownloadManagerModule"
        const val PREFS_NAME = "OffgridMobileDownloads"
        const val DOWNLOADS_KEY = "active_downloads"
        private const val POLL_INTERVAL_MS = 500L

        internal fun statusToString(status: Int): String = when (status) {
            DownloadManager.STATUS_PENDING -> "pending"
            DownloadManager.STATUS_RUNNING -> "running"
            DownloadManager.STATUS_PAUSED -> "paused"
            DownloadManager.STATUS_SUCCESSFUL -> "completed"
            DownloadManager.STATUS_FAILED -> "failed"
            else -> "unknown"
        }

        internal fun reasonToString(status: Int, reason: Int): String {
            if (status == DownloadManager.STATUS_PAUSED) {
                return when (reason) {
                    DownloadManager.PAUSED_QUEUED_FOR_WIFI -> "Waiting for WiFi"
                    DownloadManager.PAUSED_WAITING_FOR_NETWORK -> "Waiting for network"
                    DownloadManager.PAUSED_WAITING_TO_RETRY -> "Waiting to retry"
                    else -> "Paused"
                }
            }
            if (status == DownloadManager.STATUS_FAILED) {
                return when (reason) {
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
            return ""
        }

        /**
         * Returns true if the given download entry should be pruned from the persisted list.
         *
         * A download is removed when:
         * - [liveStatus] is "unknown" (DownloadManager no longer tracks it), OR
         * - its stored status is "completed", the JS side has confirmed the move by
         *   setting "moveCompleted" to true, and it's been at least 5 seconds since.
         *
         * Time-based removal alone is wrong — the JS side may not call
         * moveCompletedDownload for minutes (phone sleeping, app backgrounded).
         * Only moveCompletedDownload (or explicit cleanup) should remove entries.
         *
         * The [currentTimeMs] parameter is injectable so tests can control the clock.
         */
        internal fun shouldRemoveDownload(
            download: JSONObject,
            liveStatus: String,
            currentTimeMs: Long = System.currentTimeMillis(),
        ): Boolean {
            if (liveStatus == "unknown") return true
            if (download.optString("status", "pending") == "completed") {
                val moveCompleted = download.optBoolean("moveCompleted", false)
                if (moveCompleted) {
                    val completedAt = download.optLong("completedAt", 0L)
                    val ageMs = currentTimeMs - completedAt
                    return completedAt > 0 && ageMs > 5_000
                }
            }
            return false
        }
    }

    private val executor = Executors.newSingleThreadExecutor()

    private val allowedDownloadHosts = setOf(
        "huggingface.co",
        "cdn-lfs.huggingface.co",
        "cas-bridge.xethub.hf.co",
    )

    private val downloadManager: DownloadManager by lazy {
        reactApplicationContext.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    }

    private val sharedPrefs: SharedPreferences by lazy {
        reactApplicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    private val handler = Handler(Looper.getMainLooper())
    private var isPolling = false
    private val pollRunnable = object : Runnable {
        override fun run() {
            if (isPolling) {
                pollAllDownloads()
                handler.postDelayed(this, POLL_INTERVAL_MS)
            }
        }
    }

    override fun getName(): String = NAME

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        if (!executor.isShutdown) {
            executor.shutdown()
        }
    }

    @ReactMethod
    fun startDownload(params: ReadableMap, promise: Promise) {
        val url = params.getString("url") ?: run {
            promise.reject("DOWNLOAD_ERROR", "URL is required")
            return
        }
        val fileName = params.getString("fileName")?.let { File(it).name } ?: run {
            promise.reject("DOWNLOAD_ERROR", "fileName is required")
            return
        }
        val title = params.getString("title") ?: fileName
        val description = params.getString("description") ?: "Downloading model..."
        val modelId = params.getString("modelId") ?: ""
        val totalBytes = if (params.hasKey("totalBytes")) params.getDouble("totalBytes").toLong() else 0L
        val hideNotification = params.hasKey("hideNotification") && params.getBoolean("hideNotification")
        val expectedSha256 = params.getString("expectedSha256")

        // Validate URL against allowed download hosts to prevent SSRF
        val parsedHost = try { URL(url).host } catch (_: Exception) { null }
        if (parsedHost == null || !allowedDownloadHosts.any { parsedHost == it || parsedHost.endsWith(".$it") }) {
            promise.reject("DOWNLOAD_ERROR", "Download URL host not allowed: $parsedHost")
            return
        }

        // Resolve redirects on a background thread (network I/O)
        executor.execute {
            try {
                // Clean up any existing file with the same name to prevent DownloadManager
                // from auto-renaming (e.g., file.gguf → file-1.gguf)
                val existingFile = File(
                    reactApplicationContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                    fileName
                )
                if (existingFile.exists()) {
                    android.util.Log.d("DownloadManager", "Deleting existing file before download: ${existingFile.absolutePath}")
                    existingFile.delete()
                }

                // Also clean up any stale entries from previous sessions
                cleanupStaleDownloads()

                // Pre-resolve redirects so DownloadManager gets the final CDN URL directly.
                // HuggingFace returns a 302 redirect to a long signed CDN URL (~1350 chars)
                // that some OEM DownloadManager implementations fail to follow silently.
                val resolvedUrl = resolveRedirects(url)
                android.util.Log.d("DownloadManager", "Resolved URL: ${resolvedUrl.take(120)}...")

                val request = DownloadManager.Request(Uri.parse(resolvedUrl))
                    .setTitle(title)
                    .setDescription(description)
                    .setNotificationVisibility(
                        if (hideNotification) DownloadManager.Request.VISIBILITY_HIDDEN
                        else DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
                    )
                    .setDestinationInExternalFilesDir(
                        reactApplicationContext,
                        Environment.DIRECTORY_DOWNLOADS,
                        fileName
                    )
                    .setAllowedOverMetered(true)
                    .setAllowedOverRoaming(true)

                val downloadId = downloadManager.enqueue(request)

                // Persist download info
                val downloadInfo = JSONObject().apply {
                    put("downloadId", downloadId)
                    put("url", url)
                    put("fileName", fileName)
                    put("modelId", modelId)
                    put("title", title)
                    put("totalBytes", totalBytes)
                    put("status", "pending")
                    put("startedAt", System.currentTimeMillis())
                    if (!expectedSha256.isNullOrBlank()) {
                        put("expectedSha256", expectedSha256)
                    }
                }
                persistDownload(downloadId, downloadInfo)

                val result = Arguments.createMap().apply {
                    putDouble("downloadId", downloadId.toDouble())
                    putString("fileName", fileName)
                    putString("modelId", modelId)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("DOWNLOAD_ERROR", "Failed to start download: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    fun cancelDownload(downloadId: Double, promise: Promise) {
        try {
            val id = downloadId.toLong()

            // Get download info BEFORE removing from SharedPreferences
            val downloadInfo = getDownloadInfo(id)

            downloadManager.remove(id)
            removeDownload(id)

            // Clean up partial file
            downloadInfo?.optString("fileName")?.let { fileName ->
                val file = File(
                    reactApplicationContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                    fileName
                )
                if (file.exists()) {
                    file.delete()
                }
            }

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CANCEL_ERROR", "Failed to cancel download: ${e.message}", e)
        }
    }

    @ReactMethod
    fun getActiveDownloads(promise: Promise) {
        try {
            val downloads = getAllPersistedDownloads()
            val result = Arguments.createArray()

            for (i in 0 until downloads.length()) {
                val download = downloads.getJSONObject(i)
                val downloadId = download.getLong("downloadId")

                // Get current status from DownloadManager
                val statusInfo = queryDownloadStatus(downloadId)

                val map = Arguments.createMap().apply {
                    putDouble("downloadId", downloadId.toDouble())
                    putString("fileName", download.optString("fileName"))
                    putString("modelId", download.optString("modelId"))
                    putString("title", download.optString("title"))
                    putDouble("totalBytes", download.optDouble("totalBytes", 0.0))
                    putString("status", statusInfo.getString("status"))
                    putDouble("bytesDownloaded", statusInfo.getDouble("bytesDownloaded"))
                    putString("localUri", statusInfo.getString("localUri"))
                    putDouble("startedAt", download.optDouble("startedAt", 0.0))
                }
                result.pushMap(map)
            }

            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("QUERY_ERROR", "Failed to get active downloads: ${e.message}", e)
        }
    }

    @ReactMethod
    fun getDownloadProgress(downloadId: Double, promise: Promise) {
        try {
            val id = downloadId.toLong()
            val statusInfo = queryDownloadStatus(id)
            val downloadInfo = getDownloadInfo(id)

            val result = Arguments.createMap().apply {
                putDouble("downloadId", id.toDouble())
                putDouble("bytesDownloaded", statusInfo.getDouble("bytesDownloaded"))
                putDouble("totalBytes", statusInfo.getDouble("totalBytes").takeIf { it > 0 }
                    ?: downloadInfo?.optDouble("totalBytes", 0.0) ?: 0.0)
                putString("status", statusInfo.getString("status"))
                putString("localUri", statusInfo.getString("localUri"))
                putString("reason", statusInfo.getString("reason"))
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("PROGRESS_ERROR", "Failed to get download progress: ${e.message}", e)
        }
    }

    @ReactMethod
    fun moveCompletedDownload(downloadId: Double, targetPath: String, promise: Promise) {
        try {
            val id = downloadId.toLong()
            val downloadInfo = getDownloadInfo(id)
            val fileName = downloadInfo?.optString("fileName")
                ?: throw IllegalArgumentException("Download info not found")

            // First try to get the actual file path from DownloadManager (handles auto-renamed files)
            var sourceFile: File? = null
            val statusInfo = queryDownloadStatus(id)
            val localUri = statusInfo.getString("localUri")
            if (!localUri.isNullOrEmpty()) {
                try {
                    val uri = Uri.parse(localUri)
                    val path = uri.path
                    if (path != null) {
                        val uriFile = File(path)
                        if (uriFile.exists()) {
                            sourceFile = uriFile
                            android.util.Log.d("DownloadManager", "Using DownloadManager localUri: ${uriFile.absolutePath}")
                        }
                    }
                } catch (e: Exception) {
                    android.util.Log.w("DownloadManager", "Failed to resolve localUri: $localUri", e)
                }
            }

            // Fallback to persisted fileName
            if (sourceFile == null) {
                sourceFile = File(
                    reactApplicationContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                    fileName
                )
                android.util.Log.d("DownloadManager", "Using persisted fileName: ${sourceFile.absolutePath}")
            }

            if (!sourceFile.exists()) {
                throw IllegalArgumentException("Downloaded file not found: ${sourceFile.absolutePath}")
            }

            val targetFile = File(targetPath)
            targetFile.parentFile?.mkdirs()

            // Move the file
            if (sourceFile.renameTo(targetFile)) {
                markMoveCompleted(id)
                promise.resolve(targetFile.absolutePath)
            } else {
                // If rename fails (different filesystem), copy then delete
                sourceFile.copyTo(targetFile, overwrite = true)
                if (!sourceFile.delete()) {
                    android.util.Log.w("DownloadManager", "Failed to delete source file: ${sourceFile.absolutePath}")
                }
                markMoveCompleted(id)
                promise.resolve(targetFile.absolutePath)
            }
        } catch (e: Exception) {
            promise.reject("MOVE_ERROR", "Failed to move completed download: ${e.message}", e)
        }
    }

    /**
     * Verify the SHA-256 checksum of a completed download.
     * If no expectedSha256 was provided at download time, logs a warning and resolves with
     * a "skipped" result to maintain backward compatibility.
     */
    @ReactMethod
    fun verifyChecksum(downloadId: Double, promise: Promise) {
        executor.execute {
            try {
                val id = downloadId.toLong()
                val downloadInfo = getDownloadInfo(id)
                    ?: throw IllegalArgumentException("Download info not found for ID: $id")

                val expectedHash = downloadInfo.optString("expectedSha256", "")
                val fileName = downloadInfo.optString("fileName", "")

                if (expectedHash.isBlank()) {
                    android.util.Log.w("DownloadManager",
                        "No expected SHA-256 hash for download $id ($fileName). " +
                        "Skipping checksum verification. Provide expectedSha256 in startDownload params for integrity checking.")
                    val result = Arguments.createMap().apply {
                        putString("status", "skipped")
                        putString("reason", "No expected hash provided")
                    }
                    promise.resolve(result)
                    return@execute
                }

                // Find the downloaded file
                val statusInfo = queryDownloadStatus(id)
                val localUri = statusInfo.getString("localUri")
                var file: File? = null
                if (!localUri.isNullOrEmpty()) {
                    try {
                        val uri = android.net.Uri.parse(localUri)
                        uri.path?.let { path ->
                            val f = File(path)
                            if (f.exists()) file = f
                        }
                    } catch (_: Exception) {}
                }
                if (file == null) {
                    file = File(
                        reactApplicationContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                        fileName
                    )
                }

                if (file == null || !file!!.exists()) {
                    throw IllegalArgumentException("Downloaded file not found")
                }

                val actualHash = computeSha256(file!!)
                val matches = actualHash.equals(expectedHash, ignoreCase = true)

                if (!matches) {
                    android.util.Log.e("DownloadManager",
                        "SHA-256 mismatch for $fileName: expected=$expectedHash, actual=$actualHash")
                }

                val result = Arguments.createMap().apply {
                    putString("status", if (matches) "verified" else "mismatch")
                    putString("expectedHash", expectedHash)
                    putString("actualHash", actualHash)
                    putBoolean("matches", matches)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("CHECKSUM_ERROR", "Failed to verify checksum: ${e.message}", e)
            }
        }
    }

    private fun computeSha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(8192)
        FileInputStream(file).use { fis ->
            var bytesRead: Int
            while (fis.read(buffer).also { bytesRead = it } != -1) {
                digest.update(buffer, 0, bytesRead)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    @ReactMethod
    fun startProgressPolling() {
        if (!isPolling) {
            isPolling = true
            handler.post(pollRunnable)
        }
    }

    @ReactMethod
    fun stopProgressPolling() {
        isPolling = false
        handler.removeCallbacks(pollRunnable)
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN event emitter
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for RN event emitter
    }

    private fun isHostAllowed(host: String?): Boolean {
        if (host == null) return false
        return allowedDownloadHosts.any { host == it || host.endsWith(".$it") }
    }

    private fun followOneRedirect(currentUrl: String): String? {
        val connection = URL(currentUrl).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = "HEAD"
            connection.connectTimeout = 10_000
            connection.readTimeout = 10_000
            val responseCode = connection.responseCode
            if (responseCode !in 300..399) return null

            val location = connection.getHeaderField("Location")
            if (location.isNullOrEmpty()) return null

            val nextUrl = if (location.startsWith("http")) location
                else URL(URL(currentUrl), location).toString()

            val nextHost = try { URL(nextUrl).host } catch (_: Exception) { null }
            if (!isHostAllowed(nextHost)) {
                android.util.Log.w("DownloadManager", "Redirect to unauthorized host blocked: $nextHost")
                return null
            }
            return nextUrl
        } finally {
            connection.disconnect()
        }
    }

    /**
     * Follow HTTP redirects manually and return the final URL.
     * Some OEM DownloadManager implementations silently fail on 302 redirects
     * to long signed CDN URLs (e.g. HuggingFace → xethub.hf.co).
     * By pre-resolving, DownloadManager gets the direct URL with no redirects.
     * Falls back to the original URL on any error so downloads aren't blocked.
     */
    internal fun resolveRedirects(originalUrl: String, maxRedirects: Int = 5): String {
        var currentUrl = originalUrl
        for (i in 0 until maxRedirects) {
            try {
                val nextUrl = followOneRedirect(currentUrl) ?: return currentUrl
                currentUrl = nextUrl
            } catch (e: Exception) {
                android.util.Log.w("DownloadManager", "Redirect resolution failed, using original URL", e)
                return originalUrl
            }
        }
        android.util.Log.w("DownloadManager", "Redirect resolution exceeded max redirects ($maxRedirects), using original URL")
        return originalUrl
    }

    private fun buildEventParams(
        downloadId: Long, download: JSONObject, statusInfo: ReadableMap, status: String,
    ): WritableMap = Arguments.createMap().apply {
        putDouble("downloadId", downloadId.toDouble())
        putString("fileName", download.optString("fileName"))
        putString("modelId", download.optString("modelId"))
        putDouble("bytesDownloaded", statusInfo.getDouble("bytesDownloaded"))
        putDouble("totalBytes", statusInfo.getDouble("totalBytes").takeIf { it > 0 }
            ?: download.optDouble("totalBytes", 0.0))
        putString("status", status)
        putString("reason", statusInfo.getString("reason") ?: "")
    }

    private fun handlePollCompleted(
        downloadId: Long, eventParams: WritableMap, statusInfo: ReadableMap, completedEventSent: Boolean,
    ) {
        eventParams.putString("localUri", statusInfo.getString("localUri"))
        if (!completedEventSent) {
            android.util.Log.d("DownloadManager", "Sending DownloadComplete event for $downloadId")
            sendEvent("DownloadComplete", eventParams)
            updateDownloadStatus(downloadId, "completed", statusInfo.getString("localUri"))
        }
    }

    private fun handlePollUnknown(downloadId: Long, eventParams: WritableMap, completedEventSent: Boolean) {
        android.util.Log.w("DownloadManager", "Download $downloadId has unknown status - may have completed or been removed")
        val downloadInfo = getDownloadInfo(downloadId)
        val fileName = downloadInfo?.optString("fileName")
        if (fileName == null) {
            android.util.Log.d("DownloadManager", "No info for unknown download $downloadId, removing stale entry")
            removeDownload(downloadId)
            return
        }
        val file = java.io.File(
            reactApplicationContext.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS), fileName
        )
        if (file.exists() && file.length() > 0) {
            android.util.Log.d("DownloadManager", "File exists, treating as completed: ${file.absolutePath}")
            eventParams.putString("localUri", file.toURI().toString())
            if (!completedEventSent) sendEvent("DownloadComplete", eventParams)
            updateDownloadStatus(downloadId, "completed", file.toURI().toString())
        } else {
            android.util.Log.d("DownloadManager", "No file found for unknown download $downloadId, removing stale entry")
            removeDownload(downloadId)
        }
    }

    private fun pollAllDownloads() {
        val downloads = getAllPersistedDownloads()

        for (i in 0 until downloads.length()) {
            val download = downloads.getJSONObject(i)
            val downloadId = download.getLong("downloadId")
            val statusInfo = queryDownloadStatus(downloadId)
            val status = statusInfo.getString("status") ?: "unknown"
            val eventParams = buildEventParams(downloadId, download, statusInfo, status)
            val completedEventSent = download.optBoolean("completedEventSent", false)

            when (status) {
                "completed" -> handlePollCompleted(downloadId, eventParams, statusInfo, completedEventSent)
                "failed" -> {
                    eventParams.putString("reason", statusInfo.getString("reason"))
                    sendEvent("DownloadError", eventParams)
                    removeDownload(downloadId)
                }
                "paused" -> {
                    eventParams.putString("reason", statusInfo.getString("reason"))
                    sendEvent("DownloadProgress", eventParams)
                }
                "running", "pending" -> sendEvent("DownloadProgress", eventParams)
                "unknown" -> handlePollUnknown(downloadId, eventParams, completedEventSent)
            }
        }
    }

    private fun buildUnknownStatusMap(reason: String): WritableMap = Arguments.createMap().apply {
        putDouble("bytesDownloaded", 0.0)
        putDouble("totalBytes", 0.0)
        putString("localUri", "")
        putString("status", "unknown")
        putString("reason", reason)
    }

    private fun buildStatusFromCursor(cursor: Cursor): WritableMap {
        val bytesDownloadedIdx = cursor.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)
        val totalBytesIdx = cursor.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)
        val statusIdx = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS)
        val reasonIdx = cursor.getColumnIndex(DownloadManager.COLUMN_REASON)
        val localUriIdx = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI)

        val bytesDownloaded = if (bytesDownloadedIdx >= 0) cursor.getLong(bytesDownloadedIdx) else 0L
        val totalBytes = if (totalBytesIdx >= 0) cursor.getLong(totalBytesIdx) else 0L
        val status = if (statusIdx >= 0) cursor.getInt(statusIdx) else DownloadManager.STATUS_PENDING
        val reason = if (reasonIdx >= 0) cursor.getInt(reasonIdx) else 0
        val localUri = if (localUriIdx >= 0) cursor.getString(localUriIdx) else null

        return Arguments.createMap().apply {
            putDouble("bytesDownloaded", bytesDownloaded.toDouble())
            putDouble("totalBytes", totalBytes.toDouble())
            putString("localUri", localUri ?: "")
            putString("status", statusToString(status))
            putString("reason", reasonToString(status, reason))
        }
    }

    private fun queryDownloadStatus(downloadId: Long): ReadableMap {
        val query = DownloadManager.Query().setFilterById(downloadId)
        val cursor: Cursor? = downloadManager.query(query)

        cursor?.use {
            return if (it.moveToFirst()) buildStatusFromCursor(it)
                else buildUnknownStatusMap("Download not found")
        }

        return buildUnknownStatusMap("Query failed")
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    private fun persistDownload(downloadId: Long, info: JSONObject) {
        val downloads = getAllPersistedDownloads()

        // Update or add the download
        var found = false
        for (i in 0 until downloads.length()) {
            val existing = downloads.getJSONObject(i)
            if (existing.getLong("downloadId") == downloadId) {
                downloads.put(i, info)
                found = true
                break
            }
        }
        if (!found) {
            downloads.put(info)
        }

        sharedPrefs.edit().putString(DOWNLOADS_KEY, downloads.toString()).apply()
    }

    private fun updateDownloadStatus(downloadId: Long, status: String, localUri: String?) {
        val info = getDownloadInfo(downloadId)
        if (info != null) {
            info.put("status", status)
            if (localUri != null) {
                info.put("localUri", localUri)
            }
            if (status == "completed") {
                info.put("completedAt", System.currentTimeMillis())
                info.put("completedEventSent", true)
            }
            persistDownload(downloadId, info)
        }
    }

    private fun markMoveCompleted(downloadId: Long) {
        val info = getDownloadInfo(downloadId)
        if (info != null) {
            info.put("moveCompleted", true)
            persistDownload(downloadId, info)
        } else {
            // Info already cleaned up — nothing to mark
        }
    }

    private fun removeDownload(downloadId: Long) {
        val downloads = getAllPersistedDownloads()
        val newDownloads = JSONArray()

        for (i in 0 until downloads.length()) {
            val download = downloads.getJSONObject(i)
            if (download.getLong("downloadId") != downloadId) {
                newDownloads.put(download)
            }
        }

        sharedPrefs.edit().putString(DOWNLOADS_KEY, newDownloads.toString()).apply()
    }

    private fun getDownloadInfo(downloadId: Long): JSONObject? {
        val downloads = getAllPersistedDownloads()
        for (i in 0 until downloads.length()) {
            val download = downloads.getJSONObject(i)
            if (download.getLong("downloadId") == downloadId) {
                return download
            }
        }
        return null
    }

    /**
     * Clean up stale download entries from SharedPreferences.
     * Removes entries where DownloadManager no longer has the download (status=unknown)
     * or entries that have been moved to their final location by moveCompletedDownload.
     */
    private fun cleanupStaleDownloads() {
        val downloads = getAllPersistedDownloads()
        val cleanedDownloads = JSONArray()
        var removedCount = 0

        for (i in 0 until downloads.length()) {
            val download = downloads.getJSONObject(i)
            val downloadId = download.getLong("downloadId")
            val statusInfo = queryDownloadStatus(downloadId)
            val status = statusInfo.getString("status")
            val previousStatus = download.optString("status", "pending")

            if (shouldRemoveDownload(download, status ?: "unknown")) {
                android.util.Log.d("DownloadManager", "Cleanup: removing download $downloadId (liveStatus=$status, storedStatus=$previousStatus)")
                removedCount++
                continue
            }

            if (previousStatus == "completed" && download.optLong("completedAt", 0L) > 0 && !download.optBoolean("completedEventSent", false)) {
                android.util.Log.w("DownloadManager", "Cleanup: found completed download $downloadId without event sent - will retry in polling")
            }

            cleanedDownloads.put(download)
        }

        if (removedCount > 0) {
            android.util.Log.d("DownloadManager", "Cleanup: removed $removedCount stale entries")
            sharedPrefs.edit().putString(DOWNLOADS_KEY, cleanedDownloads.toString()).apply()
        }
    }

    private fun getAllPersistedDownloads(): JSONArray {
        val json = sharedPrefs.getString(DOWNLOADS_KEY, "[]") ?: "[]"
        return try {
            JSONArray(json)
        } catch (e: Exception) {
            JSONArray()
        }
    }
}
