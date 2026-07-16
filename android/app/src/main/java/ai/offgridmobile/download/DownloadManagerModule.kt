package ai.offgridmobile.download

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import android.os.Environment
import android.util.Log
import android.os.PowerManager
import android.provider.Settings
import androidx.lifecycle.Observer
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID
import ai.offgridmobile.SafePromise

class DownloadManagerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val downloadDao = DownloadDatabase.getInstance(reactContext).downloadDao()
    private val workManager = WorkManager.getInstance(reactContext)

    private val workObservers = mutableMapOf<String, Observer<List<WorkInfo>>>()

    init {
        DownloadEventBridge.attach(reactContext)
    }

    override fun getName(): String = NAME

    override fun onCatalystInstanceDestroy() {
        workObservers.keys.toList().forEach { removeWorkObserver(it) }
        workObservers.clear()
        super.onCatalystInstanceDestroy()
        scope.cancel()
    }

    // -------------------------------------------------------------------------
    // React methods
    // -------------------------------------------------------------------------

    @ReactMethod
    fun startDownload(params: ReadableMap, promise: Promise) {
        scope.launch {
            try {
                val url = params.getString("url")
                    ?: return@launch SafePromise(promise, NAME).reject("DOWNLOAD_ERROR", "URL is required")
                val fileName = params.getString("fileName")?.let { File(it).name }
                    ?: return@launch SafePromise(promise, NAME).reject("DOWNLOAD_ERROR", "fileName is required")

                if (!WorkerDownload.isHostAllowed(url)) {
                    return@launch SafePromise(promise, NAME).reject("DOWNLOAD_ERROR", "Download URL host not allowed")
                }

                val modelId = params.getString("modelId") ?: ""
                val modelKey = params.getString("modelKey")
                val modelType = params.getString("modelType") ?: "text"
                val quantization = params.getString("quantization")
                val combinedTotalBytes = if (params.hasKey("combinedTotalBytes")) params.getDouble("combinedTotalBytes").toLong() else 0L
                val mmProjDownloadId = params.getString("mmProjDownloadId")
                val metadataJson = params.getString("metadataJson")
                val totalBytes = if (params.hasKey("totalBytes")) params.getDouble("totalBytes").toLong() else 0L
                val expectedSha256 = params.getString("sha256")?.lowercase()?.takeIf { it.length == 64 }

                val downloadId = UUID.randomUUID().toString()
                val destination = File(
                    reactApplicationContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),
                    "${downloadId}_${fileName}",
                ).absolutePath

                val entity = DownloadEntity(
                    id = downloadId,
                    url = url,
                    fileName = fileName,
                    modelId = modelId,
                    destination = destination,
                    totalBytes = totalBytes,
                    downloadedBytes = 0L,
                    status = DownloadStatus.QUEUED,
                    createdAt = System.currentTimeMillis(),
                    expectedSha256 = expectedSha256,
                    modelType = modelType,
                    modelKey = modelKey,
                    quantization = quantization,
                    combinedTotalBytes = combinedTotalBytes,
                    mmProjDownloadId = mmProjDownloadId,
                    metadataJson = metadataJson,
                )

                withContext(Dispatchers.IO) {
                    downloadDao.insertDownload(entity)
                }
                registerObserver(downloadId, fileName, modelId)
                WorkerDownload.enqueue(reactApplicationContext, downloadId)

                val result = Arguments.createMap().apply {
                    putString("downloadId", downloadId)
                    putString("fileName", fileName)
                    putString("modelId", modelId)
                }
                SafePromise(promise, NAME).resolve(result)
            } catch (e: Exception) {
                SafePromise(promise, NAME).reject("DOWNLOAD_ERROR", "Failed to start download: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    fun retryDownload(downloadId: String, promise: Promise) {
        if (!isNetworkAvailable(reactApplicationContext)) {
            SafePromise(promise, NAME).reject("RETRY_ERROR", "No network. Please check and retry.")
            return
        }

        scope.launch {
            try {
                val download = withContext(Dispatchers.IO) { downloadDao.getDownload(downloadId) }
                    ?: return@launch SafePromise(promise, NAME).reject("RETRY_ERROR", "Download not found")
                if (download.status != DownloadStatus.FAILED) {
                    return@launch SafePromise(promise, NAME).reject("RETRY_ERROR", "Download is not in a failed state")
                }
                withContext(Dispatchers.IO) {
                    downloadDao.updateStatus(downloadId, DownloadStatus.QUEUED)
                }
                // Enqueue before observeForever so the LiveData replay sees the new
                // ENQUEUED WorkInfo, not the stale FAILED one from the previous run.
                WorkerDownload.enqueue(reactApplicationContext, downloadId)
                registerObserver(downloadId, download.fileName, download.modelId)
                SafePromise(promise, NAME).resolve(true)
            } catch (e: Exception) {
                // Roll back DB so hydration after restart doesn't leave a zombie QUEUED row.
                runCatching { withContext(Dispatchers.IO) { downloadDao.updateStatus(downloadId, DownloadStatus.FAILED) } }
                SafePromise(promise, NAME).reject("RETRY_ERROR", "Failed to retry download: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    fun cancelDownload(downloadId: String, promise: Promise) {
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    val download = downloadDao.getDownload(downloadId)
                    if (download != null) {
                        downloadDao.updateStatus(downloadId, DownloadStatus.CANCELLED, DownloadReason.USER_CANCELLED)
                        val file = File(download.destination)
                        if (file.exists() && !file.delete()) Log.w(NAME, "Failed to delete cancelled download file: ${file.path}")
                    }
                }
                WorkerDownload.cancel(reactApplicationContext, downloadId)
                workManager.pruneWork()
                removeWorkObserver(downloadId)
                SafePromise(promise, NAME).resolve(true)
            } catch (e: Exception) {
                SafePromise(promise, NAME).reject("CANCEL_ERROR", "Failed to cancel download: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    fun getActiveDownloads(promise: Promise) {
        scope.launch {
            try {
                val downloads = withContext(Dispatchers.IO) {
                    downloadDao.getAllDownloads().first().filter {
                        it.status != DownloadStatus.CANCELLED
                    }
                }
                val result = Arguments.createArray()
                downloads.forEach { d ->
                    val uiState = DownloadReason.toUiState(d.status, d.error)
                    result.pushMap(Arguments.createMap().apply {
                        putString("id", d.id)
                        putString("url", d.url)
                        putString("fileName", d.fileName)
                        putString("modelId", d.modelId)
                        putString("modelKey", d.modelKey)
                        putString("modelType", d.modelType)
                        putString("quantization", d.quantization)
                        putDouble("totalBytes", d.totalBytes.toDouble())
                        putDouble("bytesDownloaded", d.downloadedBytes.toDouble())
                        putDouble("combinedTotalBytes", d.combinedTotalBytes.toDouble())
                        putString("mmProjDownloadId", d.mmProjDownloadId)
                        putString("metadataJson", d.metadataJson)
                        putString("status", uiState.status)
                        putString("localUri", Uri.fromFile(File(d.destination)).toString())
                        putString("reason", uiState.reason ?: "")
                        putString("reasonCode", uiState.reasonCode ?: "")
                        putDouble("createdAt", d.createdAt.toDouble())
                    })
                }
                SafePromise(promise, NAME).resolve(result)
            } catch (e: Exception) {
                SafePromise(promise, NAME).reject("QUERY_ERROR", "Failed to get active downloads: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    fun getDownloadProgress(downloadId: String, promise: Promise) {
        scope.launch {
            try {
                val d = withContext(Dispatchers.IO) { downloadDao.getDownload(downloadId) }
                if (d == null) {
                    SafePromise(promise, NAME).reject("QUERY_ERROR", "Download not found")
                    return@launch
                }
                val uiState = DownloadReason.toUiState(d.status, d.error)
                val result = Arguments.createMap().apply {
                    putString("downloadId", d.id)
                    putDouble("bytesDownloaded", d.downloadedBytes.toDouble())
                    putDouble("totalBytes", d.totalBytes.toDouble())
                    putString("status", uiState.status)
                    putString("localUri", Uri.fromFile(File(d.destination)).toString())
                    putString("reason", uiState.reason ?: "")
                    putString("reasonCode", uiState.reasonCode ?: "")
                }
                SafePromise(promise, NAME).resolve(result)
            } catch (e: Exception) {
                SafePromise(promise, NAME).reject("PROGRESS_ERROR", "Failed to get progress: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    fun moveCompletedDownload(downloadId: String, targetPath: String, promise: Promise) {
        scope.launch {
            try {
                validateTargetPath(targetPath)
                    ?: return@launch SafePromise(promise, NAME)
                        .reject("MOVE_ERROR", "Target path is outside the app sandbox.")

                val download = withContext(Dispatchers.IO) { downloadDao.getDownload(downloadId) }
                    ?: return@launch SafePromise(promise, NAME).reject("MOVE_ERROR", "Download info not found")

                val movedPath = moveCompletedDownloadInternal(download, targetPath)
                SafePromise(promise, NAME).resolve(movedPath)
            } catch (e: Exception) {
                SafePromise(promise, NAME).reject("MOVE_ERROR", "Failed to move completed download: ${e.message}", e)
            }
        }
    }

    private fun validateTargetPath(targetPath: String): Boolean? {
        if (targetPath.isEmpty()) return true
        val targetFile = File(targetPath)
        val allowedDirs = listOfNotNull(
            reactApplicationContext.filesDir?.canonicalPath,
            reactApplicationContext.cacheDir?.canonicalPath,
            reactApplicationContext.getExternalFilesDir(null)?.canonicalPath,
        )
        return allowedDirs.any { targetFile.canonicalPath.startsWith(it) }
    }

    private suspend fun moveCompletedDownloadInternal(download: DownloadEntity, targetPath: String): String {
        val sourceFile = File(download.destination)
        if (targetPath.isEmpty()) {
            withContext(Dispatchers.IO) { downloadDao.deleteDownload(download) }
            return sourceFile.absolutePath
        }

        val existingTarget = resolveExistingTargetPath(sourceFile, targetPath, download)
        if (existingTarget != null) return existingTarget

        val targetFile = File(targetPath)
        targetFile.parentFile?.mkdirs()
        val movedPath = moveFile(sourceFile, targetFile)
        withContext(Dispatchers.IO) { downloadDao.deleteDownload(download) }
        return movedPath
    }

    private suspend fun resolveExistingTargetPath(
        sourceFile: File,
        targetPath: String,
        download: DownloadEntity,
    ): String? {
        if (sourceFile.exists()) return null
        val targetFile = File(targetPath)
        check(targetFile.exists()) { "Downloaded file not found: ${sourceFile.absolutePath}" }
        withContext(Dispatchers.IO) { downloadDao.deleteDownload(download) }
        return targetPath
    }

    private suspend fun moveFile(sourceFile: File, targetFile: File): String = withContext(Dispatchers.IO) {
        if (sourceFile.renameTo(targetFile)) {
            targetFile.absolutePath
        } else {
            sourceFile.copyTo(targetFile, overwrite = true)
            if (!sourceFile.delete()) sourceFile.deleteOnExit()
            targetFile.absolutePath
        }
    }

    @ReactMethod
    fun startProgressPolling() {
        scope.launch {
            val active = withContext(Dispatchers.IO) {
                downloadDao.getAllDownloads().first().filter {
                    it.status == DownloadStatus.QUEUED || it.status == DownloadStatus.RUNNING
                }
            }
            active.forEach { if (!workObservers.containsKey(it.id)) registerObserver(it.id, it.fileName, it.modelId) }
        }
    }

    @ReactMethod
    fun stopProgressPolling() {
        workObservers.keys.toList().forEach { removeWorkObserver(it) }
        workObservers.clear()
    }

    /** Ask for POST_NOTIFICATIONS (Android 13+) so the foreground-service download
     *  notification is visible. The download still runs as an FGS if denied; this only
     *  affects notification visibility. Best-effort, no-op when unavailable/granted. */
    @ReactMethod
    fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val activity = reactApplicationContext.currentActivity ?: return
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED) return
        try {
            ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 8123)
        } catch (_: Exception) { /* activity gone or already prompting */ }
    }

    @ReactMethod
    fun addListener(eventName: String) { /* required for RN event emitter */ }

    @ReactMethod
    fun removeListeners(count: Int) { /* required for RN event emitter */ }

    @ReactMethod
    fun isBatteryOptimizationIgnored(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                promise.resolve(true)
                return
            }
            val pm = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            promise.resolve(pm.isIgnoringBatteryOptimizations(reactApplicationContext.packageName))
        } catch (e: Exception) {
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun requestBatteryOptimizationIgnore() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        try {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:${reactApplicationContext.packageName}")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactApplicationContext.startActivity(intent)
        } catch (_: Exception) {
            // startActivity is a best-effort call; ignore failures on restricted devices
        }
    }

    // -------------------------------------------------------------------------
    // WorkInfo observer management
    // -------------------------------------------------------------------------

    private fun registerObserver(downloadId: String, fileName: String, modelId: String) {
        workObservers[downloadId]?.let { old ->
            workManager.getWorkInfosForUniqueWorkLiveData(WorkerDownload.workName(downloadId))
                .removeObserver(old)
        }

        val observer = Observer<List<WorkInfo>> { workInfos ->
            val info = workInfos.firstOrNull() ?: return@Observer
            when (info.state) {
                WorkInfo.State.RUNNING -> {
                    val bytes = info.progress.getLong(WorkerDownload.KEY_PROGRESS, -1L)
                    val total = info.progress.getLong(WorkerDownload.KEY_TOTAL, -1L)
                    if (bytes == -1L || total == -1L) {
                        scope.launch {
                            val d = withContext(Dispatchers.IO) { downloadDao.getDownload(downloadId) }
                            if (d != null) {
                                DownloadEventBridge.progress(
                                    downloadId, fileName, modelId, d.downloadedBytes, d.totalBytes,
                                    DownloadStatus.RUNNING.name.lowercase(),
                                )
                            }
                        }
                    } else {
                        DownloadEventBridge.progress(
                            downloadId, fileName, modelId, bytes, total,
                            DownloadStatus.RUNNING.name.lowercase(),
                        )
                    }
                }
                WorkInfo.State.ENQUEUED,
                WorkInfo.State.BLOCKED,
                -> {
                    scope.launch {
                        val d = withContext(Dispatchers.IO) { downloadDao.getDownload(downloadId) }
                            ?: return@launch
                        // BLOCKED with our only constraint (NetworkType.CONNECTED)
                        // means we're waiting for the network to come back. Persist
                        // that to the DB so a restart while still offline restores
                        // the visible state. ENQUEUED with no prior network failure
                        // is plain pending.
                        if (info.state == WorkInfo.State.BLOCKED &&
                            d.status != DownloadStatus.WAITING_FOR_NETWORK
                        ) {
                            withContext(Dispatchers.IO) {
                                downloadDao.updateStatus(downloadId, DownloadStatus.WAITING_FOR_NETWORK)
                            }
                            DownloadEventBridge.progress(
                                downloadId, d.fileName, d.modelId,
                                d.downloadedBytes, d.totalBytes,
                                "waiting_for_network",
                                "Waiting for network",
                                "network_lost",
                            )
                            return@launch
                        }
                        val uiState = DownloadReason.toUiState(d.status, d.error)
                        DownloadEventBridge.progress(
                            downloadId,
                            d.fileName,
                            d.modelId,
                            d.downloadedBytes,
                            d.totalBytes,
                            uiState.status,
                            uiState.reason,
                            uiState.reasonCode,
                        )
                    }
                }
                WorkInfo.State.SUCCEEDED -> {
                    scope.launch {
                        val d = withContext(Dispatchers.IO) { downloadDao.getDownload(downloadId) }
                        if (d != null) {
                            DownloadEventBridge.complete(
                                downloadId, d.fileName, d.modelId,
                                Uri.fromFile(File(d.destination)).toString(),
                                d.downloadedBytes, d.totalBytes,
                            )
                        }
                        removeWorkObserver(downloadId)
                    }
                }
                WorkInfo.State.FAILED -> {
                    scope.launch {
                        val d = withContext(Dispatchers.IO) { downloadDao.getDownload(downloadId) }
                        val uiState = DownloadReason.toUiState(d?.status ?: DownloadStatus.FAILED, d?.error)
                        DownloadEventBridge.error(
                            downloadId,
                            d?.fileName ?: "",
                            d?.modelId ?: "",
                            uiState.reason ?: "Something went wrong while downloading.",
                            uiState.reasonCode,
                        )
                        removeWorkObserver(downloadId)
                    }
                }
                WorkInfo.State.CANCELLED -> {
                    scope.launch { removeWorkObserver(downloadId) }
                }
                else -> Unit
            }
        }

        workObservers[downloadId] = observer
        workManager.getWorkInfosForUniqueWorkLiveData(WorkerDownload.workName(downloadId))
            .observeForever(observer)
    }

    private fun removeWorkObserver(downloadId: String) {
        workObservers.remove(downloadId)?.let { observer ->
            workManager.getWorkInfosForUniqueWorkLiveData(WorkerDownload.workName(downloadId))
                .removeObserver(observer)
        }
    }

    // -------------------------------------------------------------------------

    private fun isNetworkAvailable(context: Context): Boolean {
        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager
        if (connectivityManager != null) {
            val capabilities = connectivityManager.getNetworkCapabilities(connectivityManager.activeNetwork)
            if (capabilities != null) {
                return capabilities.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET)
            }
        }
        return false
    }

    companion object {
        const val NAME = "DownloadManagerModule"
        const val PREFS_NAME = "OffgridWorkerDownloads"
        const val DOWNLOADS_KEY = "downloads"
    }
}
