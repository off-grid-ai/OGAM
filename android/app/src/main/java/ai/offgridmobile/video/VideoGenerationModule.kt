package ai.offgridmobile.video

import ai.offgridmobile.BuildConfig
import android.content.Intent
import android.view.Window
import android.view.WindowManager
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.*
import com.facebook.react.common.LifecycleState
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class VideoGenerationModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), LifecycleEventListener {
    companion object {
        init { System.loadLibrary("offgrid_video") }
        // JNI owns one process-wide runtime, even when React recreates its bridge.
        private val busy = AtomicBoolean(false)
        @Volatile private var activeVideo: VideoGenerationModule? = null
        @Volatile private var videoStatus: Map<String, Any?>? = null
    }
    private val executor = Executors.newSingleThreadExecutor()
    private val cancelled = AtomicBoolean(false)
    private val videoScreenActive = AtomicBoolean(false)
    private var awakeWindow: Window? = null
    private var addedScreenFlag = false
    private var encoder: VideoEncoder? = null
    private var previewFile: File? = null
    private var videoSteps = 0
    init { context.addLifecycleEventListener(this) }
    private fun releaseScreenFlag() {
        if (addedScreenFlag) awakeWindow?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        awakeWindow = null
        addedScreenFlag = false
    }
    private fun updateScreenFlag() {
        val window = if (videoScreenActive.get() && context.lifecycleState == LifecycleState.RESUMED) context.currentActivity?.window else null
        if (window === awakeWindow) return
        releaseScreenFlag()
        if (window != null) {
            awakeWindow = window
            addedScreenFlag = window.attributes.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON == 0
            if (addedScreenFlag) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }
    private fun keepVideoScreenAwake(active: Boolean) {
        videoScreenActive.set(active)
        UiThreadUtil.runOnUiThread { updateScreenFlag() }
    }
    override fun onHostResume() { updateScreenFlag() }
    override fun onHostPause() { releaseScreenFlag() }
    override fun onHostDestroy() { releaseScreenFlag() }
    override fun getName() = "VideoGenerationModule"
    private external fun nativeGenerate(weight: String, vae: String, encoder: String, prompt: String, negative: String, width: Int, height: Int, frames: Int, fps: Int, steps: Int, guidance: Double, seed: Double, llm: String, embeddings: String, audioVae: String, flowShift: Double, diagnosticBackend: String)
    private external fun nativeCancel()
    private external fun nativePrepare()
    private external fun nativeSetRuntimeDirectory(path: String)
    private fun prepareHexagonRuntime() {
        val directory = File(context.filesDir, "video-hexagon").apply { mkdirs() }
        val names = context.assets.list("video-hexagon") ?: emptyArray()
        check(names.isNotEmpty()) { "The video NPU runtime is missing from this build." }
        for (name in names) {
            check(name.matches(Regex("liboffgrid-video-htp-v[0-9]+\\.so")))
            val temporary = File(directory, "$name.tmp")
            context.assets.open("video-hexagon/$name").use { input ->
                temporary.outputStream().use { output -> input.copyTo(output) }
            }
            check(temporary.renameTo(File(directory, name))) { "Could not install the video NPU runtime." }
        }
        nativeSetRuntimeDirectory(directory.absolutePath)
    }
    @ReactMethod fun addListener(name: String) {}
    @ReactMethod fun removeListeners(count: Int) {}
    private fun stop() { cancelled.set(true); nativeCancel() }
    @ReactMethod fun cancel(promise: Promise) { (activeVideo ?: this).stop(); promise.resolve(null) }
    @ReactMethod fun getVideoStatus(outputPath: String, promise: Promise) {
        val status = videoStatus?.takeIf { it["path"] == outputPath }
        keepVideoScreenAwake(status?.get("phase") == "running")
        promise.resolve(status?.let { Arguments.makeNativeMap(it) })
    }
    // Called synchronously by JNI while its worker owns the runtime.
    fun conditioning(backend: String) { emit("conditioning", 0, 0, backend) }
    fun progress(step: Int, total: Int) {
        // Loading and VAE counters share this callback; preserve the sampling snapshot.
        if (total != videoSteps || step !in 0..videoSteps) return
        emit("generating", step, total)
    }
    fun decoding(completed: Int, total: Int) { emit("decoding", completed, total) }
    fun preview(rgb: ByteArray, width: Int, height: Int) {
        if (cancelled.get()) return
        val destination = previewFile ?: return
        runCatching {
            saveRgbPng(rgb, width, height, destination)
            emit("encoding", 0, 0, preview = Arguments.createMap().apply {
                putString("path", destination.path); putInt("width", width); putInt("height", height)
            })
        }.onFailure { destination.delete() }
    }
    private fun saveRgbPng(rgb: ByteArray, width: Int, height: Int, destination: File, channels: Int = 3) {
        require(width > 0 && height > 0 && channels in 3..4 && rgb.size.toLong() == width.toLong() * height * channels)
        val pixels = IntArray(width * height) { i ->
            val offset = i * channels
            android.graphics.Color.argb(if (channels == 4) rgb[offset + 3].toInt() and 255 else 255,
                rgb[offset].toInt() and 255, rgb[offset + 1].toInt() and 255, rgb[offset + 2].toInt() and 255)
        }
        val bitmap = android.graphics.Bitmap.createBitmap(pixels, width, height, android.graphics.Bitmap.Config.ARGB_8888)
        try { destination.outputStream().use { check(bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)) } }
        finally { bitmap.recycle() }
    }
    fun frame(rgb: ByteArray, width: Int, height: Int, channels: Int) {
        check(!cancelled.get()) { "Video generation stopped." }
        emit("encoding", 0, 0)
        checkNotNull(encoder).append(rgb, channels) { cancelled.get() }
    }
    private fun emit(stage: String, step: Int, total: Int, backend: String? = null, preview: WritableMap? = null) {
        videoStatus = videoStatus?.plus(mapOf(
            "stage" to stage, "step" to step, "total" to total, "backend" to backend,
        ))?.let { status -> if (preview != null) status + ("preview" to preview.toHashMap()) else status }
        if (!context.hasActiveReactInstance()) return
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("VideoGenerationProgress", Arguments.createMap().apply { putString("stage", stage); putInt("step", step); putInt("total", total); if (backend != null) putString("backend", backend); if (preview != null) putMap("preview", preview) })
    }
    @ReactMethod fun generate(input: ReadableMap, promise: Promise) {
        if (!busy.compareAndSet(false, true)) { promise.reject("VIDEO_BUSY", "Video generation is already running."); return }
        activeVideo = this
        videoStatus = mapOf("path" to input.getString("outputPath"), "phase" to "running", "stage" to "preparing", "step" to 0, "total" to 0)
        cancelled.set(false); nativePrepare()
        executor.execute {
            var output: File? = null
            var terminal: Map<String, Any?> = mapOf("phase" to "failed", "code" to "VIDEO_FAILED", "error" to "Video generation failed.")
            try {
                keepVideoScreenAwake(true)
                prepareHexagonRuntime()
                val destination = File(checkNotNull(input.getString("outputPath")))
                output = destination
                previewFile = File(destination.path + ".preview.png")
                VideoGenerationService.admission = CompletableFuture()
                VideoGenerationService.cancel = { stop() }
                ContextCompat.startForegroundService(context, Intent(context, VideoGenerationService::class.java))
                VideoGenerationService.admission.get(5, TimeUnit.SECONDS)
                check(!cancelled.get()) { "Video generation stopped." }
                videoSteps = input.getInt("steps")
                emit("preparing", 0, videoSteps)
                VideoEncoder(destination.path, input.getInt("width"), input.getInt("height"), input.getInt("fps")).use { writer ->
                    encoder = writer
                    nativeGenerate(checkNotNull(input.getString("weight")), checkNotNull(input.getString("vae")), if (input.hasKey("encoder")) input.getString("encoder") ?: "" else "",
                        checkNotNull(input.getString("prompt")), input.getString("negativePrompt") ?: "", input.getInt("width"), input.getInt("height"),
                        input.getInt("frames"), input.getInt("fps"), input.getInt("steps"), input.getDouble("guidance"), input.getDouble("seed"),
                        if (input.hasKey("llm")) input.getString("llm") ?: "" else "",
                        if (input.hasKey("embeddings")) input.getString("embeddings") ?: "" else "",
                        if (input.hasKey("audioVae")) input.getString("audioVae") ?: "" else "",
                        input.getDouble("flowShift"), if (BuildConfig.DEBUG && input.hasKey("diagnosticBackend")) input.getString("diagnosticBackend") ?: "auto" else "auto")
                    writer.finish { cancelled.get() }
                }
                check(destination.length() > 0) { "Video encoder produced no file." }
                terminal = mapOf("phase" to "succeeded")
                if (context.hasActiveReactInstance())
                    promise.resolve(Arguments.createMap().apply { putString("path", destination.path) })
            } catch (error: Throwable) {
                val code = if (cancelled.get()) "VIDEO_CANCELLED" else "VIDEO_FAILED"
                terminal = mapOf("phase" to "failed", "code" to code, "error" to (error.message ?: "Video generation failed."))
                output?.delete()
                if (context.hasActiveReactInstance()) promise.reject(code, error.message, error)
            } finally {
                keepVideoScreenAwake(false)
                encoder = null; previewFile = null; VideoGenerationService.cancel = null
                context.stopService(Intent(context, VideoGenerationService::class.java))
                videoStatus = videoStatus?.plus(terminal)
                activeVideo = null
                busy.set(false)
            }
        }
    }
    private external fun nativeLoadImage(path: String, weight: String, vae: String, llm: String, threads: Int, cpuOnly: Boolean, family: String, sampler: String, scheduler: String)
    private external fun nativeUnloadImage()
    private external fun nativeImagePath(): String
    private external fun nativeGenerateImage(prompt: String, negative: String, width: Int, height: Int, steps: Int, guidance: Double, seed: Double, previewInterval: Int): ByteArray
    private var imagePreviewFile: File? = null
    private var imageSteps = 0
    fun imagePreview(pixels: ByteArray, width: Int, height: Int, channels: Int, step: Int) {
        if (cancelled.get()) return
        val file = imagePreviewFile ?: return
        runCatching {
            saveRgbPng(pixels, width, height, file, channels)
            if (context.hasActiveReactInstance()) context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("SDImageProgress", Arguments.createMap().apply {
                    putInt("step", step); putInt("totalSteps", imageSteps)
                    putDouble("progress", if (imageSteps > 0) step.toDouble() / imageSteps else 0.0)
                    putString("previewPath", file.path)
                })
        }
    }
    fun imageProgress(step: Int, total: Int) {
        if (!context.hasActiveReactInstance()) return
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("SDImageProgress", Arguments.createMap().apply {
            putInt("step", step); putInt("totalSteps", total); putDouble("progress", if (total > 0) step.toDouble() / total else 0.0)
        })
    }
    @ReactMethod fun getLoadedImagePath(promise: Promise) { promise.resolve(nativeImagePath().ifEmpty { null }) }
    @ReactMethod fun loadImageModel(input: ReadableMap, promise: Promise) {
        if (!busy.compareAndSet(false, true)) { promise.reject("IMAGE_BUSY", "Image or video generation is running."); return }
        cancelled.set(false); nativePrepare()
        executor.execute {
            try {
                prepareHexagonRuntime()
                nativeLoadImage(checkNotNull(input.getString("modelPath")), checkNotNull(input.getString("weight")),
                    if (input.hasKey("vae")) input.getString("vae") ?: "" else "",
                    if (input.hasKey("llm")) input.getString("llm") ?: "" else "",
                    input.getInt("threads"), input.getBoolean("cpuOnly"),
                    if (input.hasKey("family")) input.getString("family") ?: "" else "",
                    if (input.hasKey("sampler")) input.getString("sampler") ?: "" else "",
                    if (input.hasKey("scheduler")) input.getString("scheduler") ?: "" else "")
                promise.resolve(true)
            } catch (error: Throwable) { promise.reject("IMAGE_LOAD_FAILED", error.message, error) }
            finally { busy.set(false) }
        }
    }
    @ReactMethod fun unloadImageModel(promise: Promise) {
        if (!busy.compareAndSet(false, true)) { promise.reject("IMAGE_BUSY", "Image or video generation is running."); return }
        executor.execute {
            try { nativeUnloadImage(); promise.resolve(true) }
            catch (error: Throwable) { promise.reject("IMAGE_UNLOAD_FAILED", error.message, error) }
            finally { busy.set(false) }
        }
    }
    @ReactMethod fun generateImage(input: ReadableMap, promise: Promise) {
        if (!busy.compareAndSet(false, true)) { promise.reject("IMAGE_BUSY", "Image or video generation is running."); return }
        cancelled.set(false); nativePrepare()
        executor.execute {
            var output: File? = null
            try {
                val width = input.getInt("width"); val height = input.getInt("height")
                require(width in 64..2048 && height in 64..2048 && width % 16 == 0 && height % 16 == 0)
                output = File(checkNotNull(input.getString("outputPath")))
                VideoGenerationService.admission = CompletableFuture()
                VideoGenerationService.cancel = { stop() }
                ContextCompat.startForegroundService(context, Intent(context, VideoGenerationService::class.java).putExtra("modality", "image"))
                VideoGenerationService.admission.get(5, TimeUnit.SECONDS)
                imagePreviewFile = File(output.path + ".preview.png")
                imageSteps = input.getInt("steps")
                val bytes = nativeGenerateImage(checkNotNull(input.getString("prompt")), input.getString("negativePrompt") ?: "", width, height, input.getInt("steps"), input.getDouble("guidanceScale"), input.getDouble("seed"), if (input.hasKey("previewInterval")) input.getInt("previewInterval").coerceAtLeast(0) else 0)
                check(!cancelled.get()) { "Image generation stopped." }
                saveRgbPng(bytes, width, height, output, bytes.size / (width * height))
                check(!cancelled.get()) { "Image generation stopped." }
                promise.resolve(Arguments.createMap().apply {
                    putString("imagePath", output.path); putInt("width", width); putInt("height", height); putDouble("seed", input.getDouble("seed")); putString("id", input.getString("id"))
                })
            } catch (error: Throwable) { output?.delete(); promise.reject("IMAGE_FAILED", error.message, error) }
            finally { imagePreviewFile?.delete(); imagePreviewFile = null; VideoGenerationService.cancel = null; context.stopService(Intent(context, VideoGenerationService::class.java)); busy.set(false) }
        }
    }
    override fun invalidate() {
        keepVideoScreenAwake(false)
        context.removeLifecycleEventListener(this)
        // A bridge reload must not cancel a video owned by the foreground service.
        // The replacement bridge reads its retained status and completion.
        if (activeVideo == null) stop()
        executor.shutdown(); super.invalidate()
    }
}
