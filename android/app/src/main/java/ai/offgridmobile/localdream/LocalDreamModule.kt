package ai.offgridmobile.localdream

import android.graphics.Bitmap
import android.os.Build
import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.BufferedReader
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.*
import org.json.JSONObject

/**
 * React Native native module that manages local-dream's inference server process.
 *
 * Architecture:
 * - Spawns libstable_diffusion_core.so as a subprocess
 * - The subprocess runs an HTTP server on localhost:18081
 * - TypeScript layer talks to the HTTP server directly for generation
 * - This module handles: process lifecycle, QNN lib extraction, image file management
 */
class LocalDreamModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "LocalDreamModule"
        private const val MODULE_NAME = "LocalDreamModule"
        private const val EXECUTABLE_NAME = "libstable_diffusion_core.so"
        private const val RUNTIME_DIR = "runtime_libs"
        private const val SERVER_PORT = 18081

        private const val MNN_OPENCL_TUNING_MODE = "WIDE"
        private const val EVENT_PROGRESS = "LocalDreamProgress"
        private const val EVENT_ERROR = "LocalDreamError"

        // Mirrors local-dream's getChipsetSuffix: any SM-prefixed chip → supported
        internal fun isNpuSupportedInternal(): Boolean {
            val soc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                Build.SOC_MODEL
            } else {
                return false
            }
            return soc.startsWith("SM")
        }

        internal fun resolveModelDir(dir: File, isCpu: Boolean): File? {
            val markerFile = if (isCpu) "unet.mnn" else "unet.bin"

            if (File(dir, markerFile).exists()) return dir

            fun searchDir(current: File, depth: Int): File? {
                if (depth > 3) return null
                current.listFiles()?.filter { it.isDirectory }?.forEach { subDir ->
                    if (File(subDir, markerFile).exists()) {
                        Log.d(TAG, "Found $markerFile in: ${subDir.absolutePath}")
                        return subDir
                    }
                    val deeper = searchDir(subDir, depth + 1)
                    if (deeper != null) return deeper
                }
                return null
            }

            return searchDir(dir, 0)
        }

        internal fun detectTextEmbeddingSize(modelDir: File, isCpu: Boolean): String {
            // SD1.5 models always use 768
            return "768"
        }

        internal fun buildCommand(
            executable: File,
            modelDir: File,
            runtimeDir: File,
            isCpu: Boolean,
        ): List<String> {
            val embeddingSize = detectTextEmbeddingSize(modelDir, isCpu)
            Log.d(TAG, "Detected text_embedding_size: $embeddingSize")

            return if (isCpu) {
                // MNN backend — --cpu tells the binary to use MNN instead of QNN.
                // OpenCL GPU acceleration is requested per-request via "use_opencl": true in the
                // JSON body. Do NOT remove --cpu — without it the binary crashes on some devices.
                // IMPORTANT: Always pass "clip.mnn" even if only clip_v2.mnn exists.
                // The binary auto-detects clip_v2.mnn in the same directory when the
                // --clip path ends with "clip.mnn", and loads pos_emb.bin + token_emb.bin.
                // Passing clip_v2.mnn directly bypasses this and causes a segfault.
                mutableListOf(
                    executable.absolutePath,
                    "--clip", File(modelDir, "clip.mnn").absolutePath,
                    "--unet", File(modelDir, "unet.mnn").absolutePath,
                    "--vae_decoder", File(modelDir, "vae_decoder.mnn").absolutePath,
                    "--tokenizer", File(modelDir, "tokenizer.json").absolutePath,
                    "--port", SERVER_PORT.toString(),
                    "--text_embedding_size", embeddingSize,
                    "--cpu",
                ).also { cmd ->
                    val vaeEncoder = File(modelDir, "vae_encoder.mnn")
                    if (vaeEncoder.exists()) {
                        cmd.addAll(listOf("--vae_encoder", vaeEncoder.absolutePath))
                    }
                }
            } else {
                // QNN NPU backend
                // Same clip.mnn rule applies for QNN — binary auto-detects clip_v2
                val hasMnnClip = File(modelDir, "clip.mnn").exists() || File(modelDir, "clip_v2.mnn").exists()
                val clipFile = if (hasMnnClip) "clip.mnn" else "clip.bin"

                mutableListOf(
                    executable.absolutePath,
                    "--clip", File(modelDir, clipFile).absolutePath,
                    "--unet", File(modelDir, "unet.bin").absolutePath,
                    "--vae_decoder", File(modelDir, "vae_decoder.bin").absolutePath,
                    "--tokenizer", File(modelDir, "tokenizer.json").absolutePath,
                    "--backend", File(runtimeDir, "libQnnHtp.so").absolutePath,
                    "--system_library", File(runtimeDir, "libQnnSystem.so").absolutePath,
                    "--port", SERVER_PORT.toString(),
                    "--text_embedding_size", embeddingSize,
                ).also { cmd ->
                    if (hasMnnClip) {
                        cmd.add("--use_cpu_clip")
                    }
                    val vaeEncoder = File(modelDir, "vae_encoder.bin")
                    if (vaeEncoder.exists()) {
                        cmd.addAll(listOf("--vae_encoder", vaeEncoder.absolutePath))
                    }
                }
            }
        }

        internal fun saveRgbToPng(base64Rgb: String, width: Int, height: Int, outputPath: String) {
            val rgbBytes = Base64.decode(base64Rgb, Base64.DEFAULT)
            val expectedSize = width * height * 3
            if (rgbBytes.size != expectedSize) {
                throw IllegalArgumentException(
                    "RGB data size ${rgbBytes.size} doesn't match expected $expectedSize (${width}x${height}x3)"
                )
            }
            val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
            val pixels = IntArray(width * height)

            for (i in 0 until width * height) {
                val idx = i * 3
                val r = rgbBytes[idx].toInt() and 0xFF
                val g = rgbBytes[idx + 1].toInt() and 0xFF
                val b = rgbBytes[idx + 2].toInt() and 0xFF
                pixels[i] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
            }

            bitmap.setPixels(pixels, 0, width, 0, 0, width, height)

            File(outputPath).parentFile?.mkdirs()
            FileOutputStream(outputPath).use { out ->
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            }
            bitmap.recycle()
        }

        internal fun buildEnvironment(runtimeDir: File): Map<String, String> {
            val env = mutableMapOf<String, String>()

            val systemLibPaths = mutableListOf(
                runtimeDir.absolutePath,
                "/system/lib64",
                "/vendor/lib64",
                "/vendor/lib64/egl",
            )

            try {
                val maliSymlink = File("/system/vendor/lib64/egl/libGLES_mali.so")
                if (maliSymlink.exists()) {
                    val realPath = maliSymlink.canonicalPath
                    val soc = realPath.split("/").getOrNull(realPath.split("/").size - 2)
                    if (soc != null) {
                        listOf("/vendor/lib64/$soc", "/vendor/lib64/egl/$soc").forEach { path ->
                            if (!systemLibPaths.contains(path)) systemLibPaths.add(path)
                        }
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "Failed to resolve Mali paths: ${e.message}")
            }

            env["LD_LIBRARY_PATH"] = systemLibPaths.joinToString(":")
            env["DSP_LIBRARY_PATH"] = runtimeDir.absolutePath
            env["ADSP_LIBRARY_PATH"] = runtimeDir.absolutePath

            // MNN OpenCL tuning: request wider kernel search for better Adreno perf
            env["MNN_OPENCL_TUNING"] = MNN_OPENCL_TUNING_MODE

            return env
        }
    }

    private var serverProcess: Process? = null
    private var currentModelPath: String? = null
    private var currentBackend: String? = null
    private var isServerReady = false
    private val coroutineScope = CoroutineScope(Dispatchers.Default + Job())
    private var monitorJob: Job? = null
    private val generationCancelled = AtomicBoolean(false)
    private var activeGenerationConnection: HttpURLConnection? = null

    override fun getName(): String = MODULE_NAME

    override fun getConstants(): Map<String, Any> {
        return mapOf(
            "DEFAULT_STEPS" to 20,
            "DEFAULT_GUIDANCE_SCALE" to 7.5,
            "DEFAULT_WIDTH" to 512,
            "DEFAULT_HEIGHT" to 512,
            "SUPPORTED_WIDTHS" to listOf(128, 192, 256, 320, 384, 448, 512),
            "SUPPORTED_HEIGHTS" to listOf(128, 192, 256, 320, 384, 448, 512),
            "SERVER_PORT" to SERVER_PORT,
        )
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    // =====================================================================
    // QNN Library Extraction
    // =====================================================================

    private fun prepareRuntimeDir(): File {
        val runtimeDir = File(reactApplicationContext.filesDir, RUNTIME_DIR).apply {
            if (!exists()) mkdirs()
        }

        try {
            val qnnLibs = reactApplicationContext.assets.list("qnnlibs")
            qnnLibs?.forEach { fileName ->
                val targetLib = File(runtimeDir, fileName)

                val needsCopy = !targetLib.exists() || run {
                    val assetInputStream = reactApplicationContext.assets.open("qnnlibs/$fileName")
                    val assetSize = assetInputStream.use { it.available().toLong() }
                    targetLib.length() != assetSize
                }

                if (needsCopy) {
                    reactApplicationContext.assets.open("qnnlibs/$fileName").use { input ->
                        targetLib.outputStream().use { output ->
                            input.copyTo(output)
                        }
                    }
                    Log.d(TAG, "Copied $fileName to runtime directory")
                }

                targetLib.setReadable(true, true)
                targetLib.setExecutable(true, true)
            }
            Log.i(TAG, "QNN libraries prepared in: ${runtimeDir.absolutePath}")
        } catch (e: IOException) {
            Log.w(TAG, "No QNN libraries found in assets (CPU-only mode): ${e.message}")
        }

        runtimeDir.setReadable(true, true)
        runtimeDir.setExecutable(true, true)
        return runtimeDir
    }

    // =====================================================================
    // Model Directory Resolution
    // =====================================================================

    /**
     * Resolve the actual model directory. react-native-zip-archive preserves
     * zip internal paths, so a zip like `ChilloutMix.zip` containing
     * `ChilloutMix/clip.mnn` extracts to `modelDir/ChilloutMix/clip.mnn`
     * instead of `modelDir/clip.mnn`.
     *
     * This function checks for model files at the root, and if not found,
     * looks one level deep for a subdirectory that contains them.
     */
    // =====================================================================
    // Process Lifecycle
    // =====================================================================

    private fun normalizeBackend(params: ReadableMap): String {
        val requestedBackend = if (params.hasKey("backend")) params.getString("backend") else null
        return when (requestedBackend?.lowercase()) {
            "mnn", "cpu" -> "mnn"
            "qnn", "npu" -> "qnn"
            "auto", null, "" -> "auto"
            else -> "auto"
        }
    }

    private fun resolveBackendAndDir(
        normalizedBackend: String, rawModelDir: File,
    ): Pair<String, File>? {
        val cpuModelDir = resolveModelDir(rawModelDir, true)
        val qnnModelDir = resolveModelDir(rawModelDir, false)
        val npuSupported = isNpuSupportedInternal()
        return when (normalizedBackend) {
            "mnn" -> cpuModelDir?.let { "mnn" to it }
            "qnn" -> qnnModelDir?.let { "qnn" to it }
            else -> resolveAutoBackend(cpuModelDir, qnnModelDir, npuSupported)
        }
    }

    private fun resolveAutoBackend(
        cpuModelDir: File?, qnnModelDir: File?, npuSupported: Boolean,
    ): Pair<String, File>? = when {
        qnnModelDir != null && npuSupported -> "qnn" to qnnModelDir
        cpuModelDir != null -> "mnn" to cpuModelDir
        qnnModelDir != null -> "qnn" to qnnModelDir
        else -> null
    }

    private suspend fun startWithFallback(
        modelPath: String, backend: String, modelDir: File, cpuModelDir: File?,
    ): StartResult {
        val result = tryStartServer(modelPath, modelDir, backend, backend == "mnn")
        if (result.success) return result

        if (backend != "qnn" || cpuModelDir == null) return result

        Log.w(TAG, "QNN backend failed (${result.error}), falling back to MNN/CPU")
        stopServer()
        val fallbackResult = tryStartServer(modelPath, cpuModelDir, "mnn", true)
        if (fallbackResult.success) {
            Log.i(TAG, "Successfully fell back to MNN/CPU backend")
            return fallbackResult
        }
        return StartResult(false, "QNN failed: ${result.error}. MNN fallback also failed: ${fallbackResult.error}")
    }

    @ReactMethod
    fun loadModel(params: ReadableMap, promise: Promise) {
        coroutineScope.launch {
            try {
                val modelPath = params.getString("modelPath")
                if (modelPath.isNullOrBlank()) {
                    promise.reject("INVALID_ARGS", "modelPath is required")
                    return@launch
                }

                val rawModelDir = File(modelPath)
                val canonicalPath = rawModelDir.canonicalPath
                val allowedBase = reactApplicationContext.filesDir.canonicalPath
                if (!canonicalPath.startsWith(allowedBase)) {
                    promise.reject("INVALID_PATH", "Model path is outside the app's files directory")
                    return@launch
                }

                if (!rawModelDir.exists() || !rawModelDir.isDirectory) {
                    promise.reject("MODEL_NOT_FOUND", "Model directory not found: $modelPath")
                    return@launch
                }

                val normalizedBackend = normalizeBackend(params)
                val (backend, modelDir) = resolveBackendAndDir(normalizedBackend, rawModelDir) ?: run {
                    val contents = rawModelDir.listFiles()?.map { it.name }?.joinToString(", ") ?: "empty"
                    promise.reject(
                        "MODEL_FILES_NOT_FOUND",
                        "Could not find model files (unet.mnn or unet.bin) in $modelPath or its subdirectories. " +
                            "Directory contents: [$contents]"
                    )
                    return@launch
                }

                Log.d(TAG, "Resolved model directory: ${modelDir.absolutePath}")
                Log.d(TAG, "Backend selection: requested=$normalizedBackend, selected=$backend")

                if (currentModelPath == modelPath && serverProcess?.isAlive == true && isServerReady) {
                    Log.d(TAG, "Model already loaded: $modelPath")
                    promise.resolve(true)
                    return@launch
                }

                stopServer()
                Log.d(TAG, "Loading model from: $modelPath, backend: $backend")

                val cpuModelDir = resolveModelDir(rawModelDir, true)
                val result = startWithFallback(modelPath, backend, modelDir, cpuModelDir)

                if (result.success) {
                    promise.resolve(true)
                } else {
                    promise.reject("SERVER_FAILED", result.error ?: "Server failed to start")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error loading model", e)
                stopServer()
                promise.reject("LOAD_ERROR", "Failed to load model: ${e.message}", e)
            }
        }
    }

    private data class StartResult(val success: Boolean, val error: String? = null)

    private suspend fun tryStartServer(
        modelPath: String,
        modelDir: File,
        backend: String,
        isCpu: Boolean
    ): StartResult {
        val runtimeDir = prepareRuntimeDir()

        // Look for executable in nativeLibraryDir first (has execute permission),
        // then fall back to runtime_libs (extracted from assets)
        val nativeDir = reactApplicationContext.applicationInfo.nativeLibraryDir
        val nativeDirFile = File(nativeDir, EXECUTABLE_NAME)
        val runtimeDirFile = File(runtimeDir, EXECUTABLE_NAME)

        val executableFile = when {
            nativeDirFile.exists() -> {
                Log.d(TAG, "Using executable from nativeLibraryDir: ${nativeDirFile.absolutePath}")
                nativeDirFile
            }
            runtimeDirFile.exists() -> {
                Log.d(TAG, "Using executable from runtime_libs: ${runtimeDirFile.absolutePath}")
                if (!runtimeDirFile.setExecutable(true, true)) {
                    Log.w(TAG, "Failed to set executable permission on ${runtimeDirFile.absolutePath}")
                }
                runtimeDirFile
            }
            else -> {
                return StartResult(false,
                    "Executable not found in nativeLibraryDir (${nativeDirFile.absolutePath}) " +
                    "or runtime_libs (${runtimeDirFile.absolutePath})")
            }
        }

        // Build command based on backend
        val command = buildCommand(executableFile, modelDir, runtimeDir, isCpu)

        // Build environment
        val env = buildEnvironment(runtimeDir)

        // Log model directory contents for debugging
        val modelFiles = modelDir.listFiles()?.map { "${it.name} (${it.length()} bytes)" }?.joinToString(", ")
        Log.d(TAG, "Model dir contents: [$modelFiles]")
        Log.d(TAG, "COMMAND: ${command.joinToString(" ")}")
        Log.d(TAG, "LD_LIBRARY_PATH=${env["LD_LIBRARY_PATH"]}")

        val processBuilder = ProcessBuilder(command).apply {
            directory(executableFile.parentFile)
            redirectErrorStream(true)
            environment().putAll(env)
        }

        serverProcess = processBuilder.start()
        currentModelPath = modelPath
        currentBackend = backend
        isServerReady = false

        // Start monitoring stdout
        startMonitor()

        // Wait for server to be ready (poll health endpoint)
        // Use 120s for QNN (first-time cache building can take a while)
        // Use 180s for MNN (CPU inference setup can be slow)
        val timeoutMs = if (isCpu) 180000L else 120000L
        val ready = waitForServer(timeoutMs)

        if (ready) {
            isServerReady = true
            Log.i(TAG, "Server is ready on port $SERVER_PORT (backend: $backend)")
            return StartResult(true)
        }
        return buildStartFailure(timeoutMs)
    }

    private fun buildStartFailure(timeoutMs: Long): StartResult {
        val alive = serverProcess?.isAlive == true
        if (alive) {
            return StartResult(false,
                "Server failed to start within ${timeoutMs/1000}s. " +
                "The model may be too large or the device is low on memory.")
        }
        val exitCode = try { serverProcess?.exitValue() } catch (_: Exception) { null }
        val socModel = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Build.SOC_MODEL else "unknown"
        return StartResult(false,
            "Server process exited with code $exitCode. " +
            "Your device ($socModel) may not support this model's backend. " +
            "Try a CPU model instead.")
    }

    /**
     * Detect text_embedding_size from the model files.
     * All SD1.5 models (which is everything in xororz/sd-mnn and sd-qnn) use
     * CLIP ViT-L/14 with 768-dimensional text embeddings.
     * Note: "clip_v2" refers to MNN model format v2 (separate weight files),
     * NOT CLIP architecture v2. The embedding dimension is still 768.
     */
    private suspend fun waitForServer(timeoutMs: Long): Boolean {
        val startTime = System.currentTimeMillis()
        while (System.currentTimeMillis() - startTime < timeoutMs) {
            // Bail early if the process has died
            if (serverProcess?.isAlive != true) {
                Log.w(TAG, "Server process died while waiting for it to become ready")
                return false
            }

            try {
                val url = java.net.URL("http://127.0.0.1:$SERVER_PORT/health")
                val conn = url.openConnection() as java.net.HttpURLConnection
                conn.connectTimeout = 1000
                conn.readTimeout = 1000
                conn.requestMethod = "GET"
                val code = conn.responseCode
                conn.disconnect()
                if (code == 200) return true
            } catch (_: Exception) {
                // Server not ready yet
            }
            delay(500)
        }
        return false
    }

    private fun startMonitor() {
        monitorJob?.cancel()
        monitorJob = coroutineScope.launch(Dispatchers.IO) {
            try {
                serverProcess?.inputStream?.bufferedReader()?.use { reader ->
                    var line: String?
                    while (reader.readLine().also { line = it } != null) {
                        Log.i(TAG, "[server] $line")
                    }
                }

                val exitCode = serverProcess?.waitFor() ?: -1
                Log.i(TAG, "Server process exited with code: $exitCode")
                isServerReady = false

                if (exitCode != 0 && exitCode != 143) { // 143 = SIGTERM (expected on stop)
                    withContext(Dispatchers.Main) {
                        val errorMap = Arguments.createMap().apply {
                            putString("error", "Server process exited unexpectedly (code: $exitCode)")
                        }
                        sendEvent(EVENT_ERROR, errorMap)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Monitor error", e)
            }
        }
    }

    private fun stopServer() {
        monitorJob?.cancel()
        monitorJob = null

        serverProcess?.let { proc ->
            try {
                proc.destroy()
                if (!proc.waitFor(5, TimeUnit.SECONDS)) {
                    proc.destroyForcibly()
                }
                Log.i(TAG, "Server process stopped")
            } catch (e: Exception) {
                Log.e(TAG, "Error stopping server: ${e.message}")
            }
        }

        serverProcess = null
        currentModelPath = null
        currentBackend = null
        isServerReady = false
    }

    @ReactMethod
    fun unloadModel(promise: Promise) {
        try {
            stopServer()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("UNLOAD_ERROR", "Failed to unload model: ${e.message}", e)
        }
    }

    @ReactMethod
    fun isModelLoaded(promise: Promise) {
        promise.resolve(serverProcess?.isAlive == true && isServerReady)
    }

    @ReactMethod
    fun getLoadedModelPath(promise: Promise) {
        promise.resolve(currentModelPath)
    }

    @ReactMethod
    fun isGenerating(promise: Promise) {
        promise.resolve(activeGenerationConnection != null)
    }

    @ReactMethod
    fun cancelGeneration(promise: Promise) {
        generationCancelled.set(true)
        activeGenerationConnection?.let {
            try { it.disconnect() } catch (_: Exception) {}
        }
        activeGenerationConnection = null
        promise.resolve(true)
    }

    // =====================================================================
    // Image Generation (HTTP POST + SSE parsing on native side)
    // =====================================================================

    /**
     * Check if the server is alive and responsive before making a request.
     */
    private fun checkServerHealth(): Boolean {
        return try {
            val url = URL("http://127.0.0.1:$SERVER_PORT/health")
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 3000
            conn.readTimeout = 3000
            conn.requestMethod = "GET"
            val code = conn.responseCode
            conn.disconnect()
            code == 200
        } catch (e: Exception) {
            Log.w(TAG, "Health check failed: ${e.message}")
            false
        }
    }

    private fun buildGenerationBody(params: ReadableMap): JSONObject = JSONObject().apply {
        put("prompt", params.getString("prompt") ?: "")
        put("negative_prompt", params.getString("negativePrompt") ?: "")
        put("steps", if (params.hasKey("steps")) params.getInt("steps") else 20)
        put("cfg", if (params.hasKey("guidanceScale")) params.getDouble("guidanceScale") else 7.5)
        put("seed", if (params.hasKey("seed")) params.getInt("seed") else (Math.random() * 2147483647).toInt())
        put("width", if (params.hasKey("width")) params.getInt("width") else 512)
        put("height", if (params.hasKey("height")) params.getInt("height") else 512)
        put("scheduler", "dpm")
        put("show_diffusion_process", true)
        put("show_diffusion_stride", if (params.hasKey("previewInterval")) params.getInt("previewInterval") else 2)
    }

    private fun openGenerationConnection(): HttpURLConnection {
        val url = URL("http://127.0.0.1:$SERVER_PORT/generate")
        return (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Accept", "text/event-stream")
            connectTimeout = 10000
            readTimeout = 600000
        }
    }

    private fun savePreviewImage(
        previewBase64: String, step: Int, reqWidth: Int, reqHeight: Int,
    ): String? = try {
        val previewDir = File(reactApplicationContext.cacheDir, "preview").apply {
            if (!exists()) mkdirs()
        }
        val previewPath = File(previewDir, "preview_step_$step.png").absolutePath
        saveRgbToPng(previewBase64, reqWidth, reqHeight, previewPath)
        previewPath
    } catch (e: Exception) {
        Log.w(TAG, "Failed to save preview: ${e.message}")
        null
    }

    private suspend fun handleProgressEvent(data: JSONObject, body: JSONObject) {
        val step = data.getInt("step")
        val totalSteps = data.getInt("total_steps")
        val progressMap = Arguments.createMap().apply {
            putInt("step", step)
            putInt("totalSteps", totalSteps)
            putDouble("progress", step.toDouble() / totalSteps.toDouble())
        }

        val previewBase64 = data.optString("image", "")
        if (previewBase64.isNotEmpty()) {
            val previewPath = savePreviewImage(previewBase64, step, body.getInt("width"), body.getInt("height"))
            if (previewPath != null) progressMap.putString("previewPath", previewPath)
        }

        withContext(Dispatchers.Main) { sendEvent(EVENT_PROGRESS, progressMap) }
    }

    private sealed class SseParseResult {
        data class Complete(val data: JSONObject) : SseParseResult()
        object Cancelled : SseParseResult()
        object NoResult : SseParseResult()
    }

    private suspend fun parseSseStream(
        connection: HttpURLConnection, body: JSONObject,
    ): SseParseResult {
        var completeData: JSONObject? = null
        var currentEventType = ""

        BufferedReader(InputStreamReader(connection.inputStream)).use { reader ->
            var line: String?
            while (reader.readLine().also { line = it } != null) {
                if (generationCancelled.get()) return SseParseResult.Cancelled

                val trimmed = line!!.trim()
                if (trimmed.startsWith("event: ")) {
                    currentEventType = trimmed.substring(7).trim()
                    continue
                }
                if (!trimmed.startsWith("data: ")) continue

                try {
                    val data = JSONObject(trimmed.substring(6))
                    when (data.optString("type", currentEventType)) {
                        "progress" -> handleProgressEvent(data, body)
                        "complete" -> completeData = data
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to parse SSE data: ${e.message}")
                }
                currentEventType = ""
            }
        }

        if (generationCancelled.get()) return SseParseResult.Cancelled
        return if (completeData != null) SseParseResult.Complete(completeData!!) else SseParseResult.NoResult
    }

    private fun buildFinalResult(completeData: JSONObject): WritableMap {
        val imageBase64 = completeData.getString("image")
        val width = completeData.getInt("width")
        val height = completeData.getInt("height")
        val seed = completeData.optInt("seed", 0)
        val generationTimeMs = completeData.optLong("generation_time_ms", 0)

        val imageId = UUID.randomUUID().toString()
        val outputDir = File(reactApplicationContext.filesDir, "generated_images").apply {
            if (!exists()) mkdirs()
        }
        val outputPath = File(outputDir, "$imageId.png").absolutePath
        saveRgbToPng(imageBase64, width, height, outputPath)

        return Arguments.createMap().apply {
            putString("id", imageId)
            putString("imagePath", outputPath)
            putInt("width", width)
            putInt("height", height)
            putInt("seed", seed)
            putDouble("generationTimeMs", generationTimeMs.toDouble())
        }
    }

    private fun handleEofException(e: java.io.EOFException, promise: Promise) {
        if (generationCancelled.get()) {
            promise.reject("CANCELLED", "Generation cancelled")
            return
        }
        val alive = serverProcess?.isAlive == true
        Log.e(TAG, "EOFException during generation. Server alive: $alive", e)
        if (!alive) {
            isServerReady = false
            promise.reject("SERVER_CRASHED",
                "Server process died during generation. Reload the model and try again.")
        } else {
            promise.reject("CONNECTION_ERROR",
                "Connection to server was closed unexpectedly. " +
                "The server may have crashed during inference. Try again.")
        }
    }

    private fun handleGeneralException(e: Exception, promise: Promise) {
        if (generationCancelled.get()) {
            promise.reject("CANCELLED", "Generation cancelled")
        } else {
            Log.e(TAG, "Generation error: ${e.javaClass.simpleName}", e)
            promise.reject("GENERATION_ERROR",
                "Failed to generate image: [${e.javaClass.simpleName}] ${e.message ?: "unknown error"}", e)
        }
    }

    @ReactMethod
    fun generateImage(params: ReadableMap, promise: Promise) {
        coroutineScope.launch(Dispatchers.IO) {
            if (!isServerReady || serverProcess?.isAlive != true) {
                promise.reject("SERVER_NOT_READY", "Server is not running. Load a model first.")
                return@launch
            }
            if (!checkServerHealth()) {
                isServerReady = false
                promise.reject("SERVER_NOT_READY",
                    "Server process is not responsive. Try unloading and reloading the model.")
                return@launch
            }

            generationCancelled.set(false)
            var connection: HttpURLConnection? = null

            try {
                val body = buildGenerationBody(params)
                Log.d(TAG, "Starting generation: ${body.toString().take(200)}...")

                connection = openGenerationConnection()
                activeGenerationConnection = connection
                OutputStreamWriter(connection.outputStream).use { it.write(body.toString()); it.flush() }

                val responseCode = connection.responseCode
                if (responseCode != 200) {
                    val errorBody = try {
                        connection.errorStream?.bufferedReader()?.readText() ?: "no error body"
                    } catch (_: Exception) { "could not read error" }
                    promise.reject("SERVER_ERROR",
                        "Server returned $responseCode: ${connection.responseMessage}. Body: $errorBody")
                    return@launch
                }

                when (val result = parseSseStream(connection, body)) {
                    is SseParseResult.Complete -> promise.resolve(buildFinalResult(result.data))
                    is SseParseResult.Cancelled -> promise.reject("CANCELLED", "Generation cancelled")
                    is SseParseResult.NoResult -> promise.reject("NO_RESULT", "Server did not return a complete event")
                }
            } catch (e: java.io.EOFException) {
                handleEofException(e, promise)
            } catch (e: Exception) {
                handleGeneralException(e, promise)
            } finally {
                activeGenerationConnection = null
                connection?.disconnect()
            }
        }
    }

    // =====================================================================
    // Image File Management (RGB → PNG conversion and file operations)
    // =====================================================================

    @ReactMethod
    fun saveRgbAsPng(params: ReadableMap, promise: Promise) {
        coroutineScope.launch {
            try {
                val base64Rgb = params.getString("base64Rgb") ?: ""
                val width = params.getInt("width")
                val height = params.getInt("height")
                val outputPath = params.getString("outputPath") ?: ""

                if (base64Rgb.isEmpty() || outputPath.isEmpty()) {
                    promise.reject("INVALID_ARGS", "base64Rgb and outputPath are required")
                    return@launch
                }

                val rgbBytes = Base64.decode(base64Rgb, Base64.DEFAULT)
                val expectedSize = width * height * 3
                if (rgbBytes.size != expectedSize) {
                    promise.reject("SIZE_MISMATCH",
                        "RGB data size ${rgbBytes.size} doesn't match expected $expectedSize (${width}x${height}x3)")
                    return@launch
                }

                val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                val pixels = IntArray(width * height)

                for (i in 0 until width * height) {
                    val idx = i * 3
                    val r = rgbBytes[idx].toInt() and 0xFF
                    val g = rgbBytes[idx + 1].toInt() and 0xFF
                    val b = rgbBytes[idx + 2].toInt() and 0xFF
                    pixels[i] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
                }

                bitmap.setPixels(pixels, 0, width, 0, 0, width, height)

                val outputFile = File(outputPath)
                outputFile.parentFile?.mkdirs()
                FileOutputStream(outputFile).use { out ->
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
                }
                bitmap.recycle()

                promise.resolve(true)
            } catch (e: Exception) {
                Log.e(TAG, "Error saving RGB as PNG", e)
                promise.reject("SAVE_ERROR", "Failed to save image: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    fun getGeneratedImages(promise: Promise) {
        try {
            val outputDir = File(reactApplicationContext.filesDir, "generated_images")
            if (!outputDir.exists()) {
                promise.resolve(Arguments.createArray())
                return
            }

            val images = Arguments.createArray()
            outputDir.listFiles()?.filter { it.extension == "png" }?.forEach { file ->
                val imageMap = Arguments.createMap().apply {
                    putString("id", file.nameWithoutExtension)
                    putString("imagePath", file.absolutePath)
                    putDouble("size", file.length().toDouble())
                    putString("createdAt", file.lastModified().toString())
                }
                images.pushMap(imageMap)
            }

            promise.resolve(images)
        } catch (e: Exception) {
            promise.reject("LIST_ERROR", "Failed to list generated images: ${e.message}", e)
        }
    }

    @ReactMethod
    fun deleteGeneratedImage(imageId: String, promise: Promise) {
        try {
            val outputDir = File(reactApplicationContext.filesDir, "generated_images")
            val imageFile = File(outputDir, "$imageId.png")

            if (imageFile.exists()) {
                imageFile.delete()
                promise.resolve(true)
            } else {
                promise.reject("NOT_FOUND", "Image not found: $imageId")
            }
        } catch (e: Exception) {
            promise.reject("DELETE_ERROR", "Failed to delete image: ${e.message}", e)
        }
    }

    /**
     * Get the server port for the TypeScript layer to connect to.
     */
    @ReactMethod
    fun getServerPort(promise: Promise) {
        promise.resolve(SERVER_PORT)
    }

    /**
     * Check if the device has a supported Qualcomm NPU.
     */
    @ReactMethod
    fun isNpuSupported(promise: Promise) {
        promise.resolve(isNpuSupportedInternal())
    }

    @ReactMethod
    fun getSoCModel(promise: Promise) {
        val soc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Build.SOC_MODEL
        } else {
            ""
        }
        promise.resolve(soc)
    }

    /**
     * Clear OpenCL kernel cache files (.mnnc) from a model directory.
     * Forces MNN to retune OpenCL kernels on the next generation,
     * which may find better kernels for the current GPU.
     */
    @ReactMethod
    fun clearOpenCLCache(modelPath: String, promise: Promise) {
        val appFilesDir = reactApplicationContext.filesDir.canonicalPath
        val canonical = File(modelPath).canonicalPath
        if (!canonical.startsWith(appFilesDir)) {
            promise.reject("CACHE_ERROR", "Model path is outside the app directory")
            return
        }
        coroutineScope.launch(Dispatchers.IO) {
            try {
                val modelDir = File(modelPath)
                val cpuModelDir = resolveModelDir(modelDir, true)
                if (cpuModelDir == null) {
                    promise.resolve(0)
                    return@launch
                }

                var cleared = 0
                val cachePattern = Regex(".*\\.mnnc(\\..+)?$")
                cpuModelDir.listFiles()?.filter { it.name.matches(cachePattern) }?.forEach { file ->
                    Log.d(TAG, "Deleting OpenCL cache: ${file.name}")
                    if (file.delete()) cleared++
                }
                Log.i(TAG, "Cleared $cleared OpenCL cache file(s) from ${cpuModelDir.absolutePath}")
                promise.resolve(cleared)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to clear OpenCL cache", e)
                promise.reject("CACHE_ERROR", "Failed to clear OpenCL cache: ${e.message}", e)
            }
        }
    }

    /**
     * Check if OpenCL kernel cache (.mnnc files) exists for the given model.
     * Returns false on first run, indicating GPU kernel compilation will be needed.
     */
    @ReactMethod
    fun hasOpenCLCache(modelPath: String, promise: Promise) {
        val appFilesDir = reactApplicationContext.filesDir.canonicalPath
        val canonical = File(modelPath).canonicalPath
        if (!canonical.startsWith(appFilesDir)) {
            promise.reject("CACHE_ERROR", "Model path is outside the app directory")
            return
        }
        coroutineScope.launch(Dispatchers.IO) {
            try {
                val modelDir = File(modelPath)
                val cpuModelDir = resolveModelDir(modelDir, true)
                if (cpuModelDir == null) {
                    promise.resolve(false)
                    return@launch
                }

                val cachePattern = Regex(".*\\.mnnc(\\..+)?$")
                val hasCache = cpuModelDir.listFiles()?.any { it.name.matches(cachePattern) } == true
                promise.resolve(hasCache)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to check OpenCL cache", e)
                promise.reject("CACHE_ERROR", "Failed to check OpenCL cache: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN event emitter
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for RN event emitter
    }

    override fun invalidate() {
        super.invalidate()
        coroutineScope.cancel()
        stopServer()
    }
}
