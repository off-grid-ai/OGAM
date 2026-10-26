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
    // Start images run in sd.cpp; the in-process ESRGAN upscaler sharpens film shots.
    override fun getConstants(): Map<String, Any> = mapOf("supportsInitImage" to true, "supportsUpscale" to true)
    private external fun nativeGenerate(weight: String, vae: String, encoder: String, prompt: String, negative: String, width: Int, height: Int, frames: Int, fps: Int, steps: Int, guidance: Double, seed: Double, llm: String, embeddings: String, audioVae: String, flowShift: Double, diagnosticBackend: String, initImage: ByteArray?)
    private external fun nativeUpscalerOpen(modelPath: String, threads: Int): Long
    private external fun nativeUpscalerClose(handle: Long)
    private external fun nativeUpscale(handle: Long, rgb: ByteArray, width: Int, height: Int, factor: Int): ByteArray?

    /** A photo as RGB at the clip size, centre-cropped to fill. */
    private fun initImageRgb(path: String?, width: Int, height: Int): ByteArray? {
        if (path.isNullOrEmpty()) return null
        val source = android.graphics.BitmapFactory.decodeFile(path.removePrefix("file://")) ?: return null
        val scale = maxOf(width.toFloat() / source.width, height.toFloat() / source.height)
        val crop = android.graphics.Bitmap.createBitmap(width, height, android.graphics.Bitmap.Config.ARGB_8888)
        android.graphics.Canvas(crop).apply {
            translate((width - source.width * scale) / 2f, (height - source.height * scale) / 2f)
            scale(scale, scale)
            drawBitmap(source, 0f, 0f, android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))
        }
        source.recycle()
        return toRgb(crop).also { crop.recycle() }
    }

    private fun toRgb(bitmap: android.graphics.Bitmap): ByteArray {
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        val rgb = ByteArray(pixels.size * 3)
        for (i in pixels.indices) {
            rgb[i * 3] = (pixels[i] shr 16).toByte(); rgb[i * 3 + 1] = (pixels[i] shr 8).toByte(); rgb[i * 3 + 2] = pixels[i].toByte()
        }
        return rgb
    }

    /** A film owns one foreground service for its whole run; a clip inside it starts none of its own. */
    private fun filmServiceRunning(): Boolean = runCatching {
        Class.forName("ai.offgridmobile.film.FilmRenderService").getDeclaredField("running").apply { isAccessible = true }.getBoolean(null)
    }.getOrDefault(false)

    /** Upscale every frame of a clip with sd.cpp's ESRGAN, and write it at the clip's own rate. */
    @ReactMethod fun upscaleVideo(input: ReadableMap, promise: Promise) {
        cancelled.set(false)
        executor.execute {
            val retriever = android.media.MediaMetadataRetriever()
            var handle = 0L
            try {
                val inputPath = checkNotNull(input.getString("inputPath")); val outputPath = checkNotNull(input.getString("outputPath"))
                val factor = input.getInt("scale")
                retriever.setDataSource(inputPath)
                val durationUs = (retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLong() ?: 0L) * 1000
                val frameCount = retriever.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_FRAME_COUNT)?.toIntOrNull() ?: 0
                check(durationUs > 0 && frameCount > 0) { "The clip has no frames." }
                val fps = maxOf(1, Math.round(frameCount * 1_000_000.0 / durationUs).toInt())
                handle = nativeUpscalerOpen(checkNotNull(input.getString("modelPath")), Runtime.getRuntime().availableProcessors().coerceIn(2, 6))
                check(handle != 0L) { "The upscaler model did not load." }
                var writer: VideoEncoder? = null
                try {
                    for (index in 0 until frameCount) {
                        check(!cancelled.get()) { "Upscaling stopped." }
                        val frame = retriever.getFrameAtTime(index * 1_000_000L / fps, android.media.MediaMetadataRetriever.OPTION_CLOSEST) ?: continue
                        val rgb = toRgb(frame); val w = frame.width; val h = frame.height
                        frame.recycle()
                        val up = nativeUpscale(handle, rgb, w, h, factor) ?: error("The upscaler failed on a frame.")
                        val target = writer ?: VideoEncoder(outputPath, w * factor, h * factor, fps).also { writer = it }
                        target.append(up, 3) { cancelled.get() }
                    }
                    writer?.finish { cancelled.get() }
                } finally { writer?.close() }
                promise.resolve(Arguments.createMap().apply { putString("path", outputPath) })
            } catch (error: Throwable) {
                promise.reject("VIDEO_UPSCALE_FAILED", error.message ?: "Could not upscale the clip.", error)
            } finally {
                if (handle != 0L) nativeUpscalerClose(handle)
                runCatching { retriever.release() }
            }
        }
    }
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
                if (filmServiceRunning()) VideoGenerationService.admission.complete(Unit)
                else ContextCompat.startForegroundService(context, Intent(context, VideoGenerationService::class.java))
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
                        input.getDouble("flowShift"), if (BuildConfig.DEBUG && input.hasKey("diagnosticBackend")) input.getString("diagnosticBackend") ?: "auto" else "auto",
                        initImageRgb(if (input.hasKey("initImage")) input.getString("initImage") else null, input.getInt("width"), input.getInt("height")))
                    writer.finish { cancelled.get() }
                }
                check(destination.length() > 0) { "Video encoder produced no file." }
                terminal = mapOf("phase" to "succeeded")
                if (context.hasActiveReactInstance())
                    promise.resolve(Arguments.createMap().apply { putString("path", destination.path) })
            } catch (error: Throwable) {
                val code = if (cancelled.get()) "VIDEO_CANCELLED" else "VIDEO_FAILED"
                terminal = mapOf("phase" to "failed", "code" to code, "error" to (error.message ?: "Video generation failed."))
                discard(output)
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
            } catch (error: Throwable) { discard(output); promise.reject("IMAGE_FAILED", error.message, error) }
            finally { discard(imagePreviewFile); imagePreviewFile = null; VideoGenerationService.cancel = null; context.stopService(Intent(context, VideoGenerationService::class.java)); busy.set(false) }
        }
    }
    /** Remove a partial output; a file that cannot be removed is logged, not ignored. */
    private fun discard(file: File?) {
        if (file != null && file.exists() && !file.delete())
            android.util.Log.w("OffGridVideo", "Could not delete ${file.path}")
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
