package ai.offgridmobile.localdream

import android.content.Context
import android.graphics.BitmapFactory
import android.os.SystemClock
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.ArrayDeque
import kotlin.concurrent.thread
import java.util.UUID

/** Original safetensors and GGUF image weights executed by stable-diffusion.cpp. */
internal class AtlasNativeDiffusion(private val context: Context) {
    companion object {
        const val EXECUTABLE = "libatlas_sdcli.so"
        /** Same sd-cli built with ggml's OpenCL backend (Adreno kernels) instead of Vulkan. */
        const val EXECUTABLE_OPENCL = "libatlas_sdcli_opencl.so"
    }
    @Volatile private var running: Process? = null
    @Volatile private var startedMs = 0L
    @Volatile private var lastOutputMs = 0L
    @Volatile private var lastStepMs = 0L
    @Volatile private var reportedStep = 0
    @Volatile private var requestedSteps = 0
    @Volatile private var phase = "Idle"
    /** Where sd-cli writes the low-resolution picture of each step, while one is being made. */
    @Volatile private var previewDir: File? = null
    @Volatile private var computeBackend = "not selected"
    @Volatile private var weightPrecision = "checkpoint precision"
    @Volatile private var deviceLabel = "not probed"
    @Volatile private var vulkanSupported: Boolean? = null
    @Volatile private var vulkanDevice = "vulkan0"
    @Volatile private var gpuApi = "vulkan"
    @Volatile private var vulkanProbeOutput = "Not checked"
    @Volatile private var androidHasVulkan = false

    /** Prefer the Android OS Vulkan loader over app-private libraries. OpenCL lives in the
     *  vendor partition (Adreno's libOpenCL.so), so OpenCL runs search /vendor/lib64 first. */
    private fun configureNativeEnvironment(builder: ProcessBuilder, api: String = "vulkan") {
        val environment = builder.environment()
        val inherited = environment["LD_LIBRARY_PATH"]?.split(':').orEmpty()
        val system = listOf("/system/lib64", context.applicationInfo.nativeLibraryDir, "/vendor/lib64")
        val order = if (api == "opencl") listOf("/vendor/lib64") + system else system
        environment["LD_LIBRARY_PATH"] = (order + inherited)
            .filter { it.isNotBlank() }.distinct().joinToString(":")
    }

    private fun executableFor(api: String): File =
        File(context.applicationInfo.nativeLibraryDir, if (api == "opencl") EXECUTABLE_OPENCL else EXECUTABLE)

    /**
     * sd-cli outputs "device name<TAB>description".
     * Capture its full output without deadlocking on a subprocess pipe.
     */
    private fun detectVulkan(cli: File, cancelled: () -> Boolean, force: Boolean = false,
                             api: String = "vulkan"): Boolean {
        if (vulkanSupported == true && !force && api == gpuApi) return true
        gpuApi = api
        if (cancelled()) return false
        androidHasVulkan = try {
            context.packageManager.hasSystemFeature("android.hardware.vulkan.level") ||
                context.packageManager.hasSystemFeature("android.hardware.vulkan.version")
        } catch (_: Exception) { false }
        val log = File(context.cacheDir, "atlas-gpu-probe-" + UUID.randomUUID() + ".log")
        val proc = try {
            ProcessBuilder(cli.absolutePath, "--list-devices").apply {
                directory(cli.parentFile)
                redirectErrorStream(true)
                redirectOutput(log)
                configureNativeEnvironment(this, api)
            }.start()
        } catch (e: Exception) {
            vulkanProbeOutput = "Probe could not start: " + e.javaClass.simpleName + ": " + e.message
            deviceLabel = vulkanProbeOutput.take(300)
            log.delete()
            return false
        }
        running = proc
        return try {
            val finished = proc.waitFor(30, TimeUnit.SECONDS)
            if (!finished || cancelled()) proc.destroyForcibly()
            val output = if (log.isFile) log.readText().takeLast(4096) else ""
            val code = if (finished) proc.exitValue() else -1
            vulkanProbeOutput = AtlasVulkanProbe.summary(output, code, !finished)
            val selected = if (finished && code == 0) AtlasVulkanProbe.device(output, api) else null
            vulkanSupported = selected != null
            if (selected != null) {
                vulkanDevice = selected.name
                deviceLabel = (if (api == "opencl") "OpenCL " else "Vulkan ") + selected.name + ": " + selected.description
                true
            } else {
                deviceLabel = "Native " + (if (api == "opencl") "OpenCL" else "Vulkan") + " probe inconclusive. " +
                    "Android Vulkan feature: " + (if (androidHasVulkan) "yes" else "not advertised") +
                    ". " + vulkanProbeOutput.takeLast(360)
                false
            }
        } catch (e: Exception) {
            vulkanProbeOutput = "Probe failed: " + e.javaClass.simpleName + ": " + e.message
            deviceLabel = vulkanProbeOutput.take(300)
            false
        } finally {
            if (running === proc) running = null
            if (proc.isAlive) proc.destroyForcibly()
            log.delete()
        }
    }

    /** Let a user diagnose the Vulkan or OpenCL GPU before loading any weights. */
    fun probeGpu(api: String = "vulkan"): WritableMap {
        val binary = executableFor(api)
        if (!binary.isFile) throw IOException(
            (if (api == "opencl") "OpenCL" else "Native") + " image engine missing from the installed APK")
        val available = detectVulkan(binary, { false }, force = true, api = api)
        return Arguments.createMap().apply {
            putBoolean("enumerated", available)
            putBoolean("androidVulkanFeature", androidHasVulkan)
            putString("api", api)
            putString("backend", if (available) vulkanDevice else (if (api == "opencl") "GPUOpenCL" else "vulkan0") + " (unverified)")
            putString("detail", deviceLabel)
            putString("nativeOutput", vulkanProbeOutput)
        }
    }

    /** Android SDK Process lacks pid(); read it optionally for status diagnostics. */
    private fun childPid(process: Process): Long? = try {
        (process.javaClass.getMethod("pid").invoke(process) as? Number)?.toLong()?.takeIf { it > 0L }
    } catch (_: Exception) { null }

    /** Lightweight native status; unlike a spinning UI, also reports child CPU ticks. */
    fun status(): WritableMap {
        val now = SystemClock.elapsedRealtime()
        val process = running
        val alive = process?.isAlive == true
        val ticks = try {
            if (alive && process != null) {
                childPid(process)?.let { pid -> AtlasImageProgress.cpuTicks(File("/proc/$pid/stat").readText()) }
            } else null
        } catch (_: Exception) { null }
        return Arguments.createMap().apply {
            putBoolean("running", alive)
            putString("stage", phase)
            putString("computeBackend", computeBackend)
            putString("weightPrecision", weightPrecision)
            putString("deviceLabel", deviceLabel)
            putString("probeOutput", vulkanProbeOutput)
            putBoolean("androidVulkanFeature", androidHasVulkan)
            putInt("step", reportedStep)
            putInt("totalSteps", requestedSteps)
            putDouble("elapsedSeconds", if (startedMs > 0) (now - startedMs) / 1000.0 else 0.0)
            putDouble("secondsSinceStep", if (lastStepMs > 0) (now - lastStepMs) / 1000.0 else -1.0)
            putDouble("secondsSinceLog", if (lastOutputMs > 0) (now - lastOutputMs) / 1000.0 else -1.0)
            putDouble("cpuTicks", ticks?.toDouble() ?: -1.0)
        }
    }

    /**
     * The newest finished preview picture, or null. A file written in the last moment may
     * still be open, so the one before it is used then.
     */
    fun latestPreview(): String? {
        val now = System.currentTimeMillis()
        return previewDir?.listFiles { f -> f.name.endsWith(".png") && f.length() > 0 }
            ?.sortedByDescending { it.name }
            ?.firstOrNull { now - it.lastModified() > 300 }
            ?.absolutePath
    }

    fun available(): Boolean = File(context.applicationInfo.nativeLibraryDir, EXECUTABLE).isFile
    fun cancel() { running?.destroyForcibly() }

    fun generate(dirPath: String, params: ReadableMap, cancelled: () -> Boolean,
                 progress: (Int, Int) -> Unit): WritableMap {
        val dir = File(dirPath).canonicalFile
        val library = File(context.filesDir, "image_models").canonicalFile
        if (!dir.path.startsWith(library.path + File.separator)) throw IOException("Unsafe image model path")
        val manifestFile = File(dir, "atlas-image.json")
        if (!manifestFile.isFile) throw IOException("Not a directly imported image model")
        val manifest = JSONObject(manifestFile.readText())
        val primary = File(dir, manifest.getString("primary")).canonicalFile
        if (primary.parentFile != dir || !primary.isFile) throw IOException("Image weights are missing")
        AtlasImageCheckpointHeader.validate(primary)
        val family = manifest.optString("family", "unknown")
        val variant = manifest.optString("variant", "base")
        if (!AtlasImageArchitecture.supported(family)) {
            throw IOException("Unsupported image architecture: " + family + ". Import a supported checkpoint.")
        }
        // computeBackend picks the engine ("vulkan", "opencl" or "cpu"). Older JS sends only
        // useOpenCL, the legacy settings key, which maps to Vulkan for these models.
        val requested = params.takeIf { it.hasKey("computeBackend") }?.getString("computeBackend")
            ?: if (!params.hasKey("useOpenCL") || params.getBoolean("useOpenCL")) "vulkan" else "cpu"
        val api = if (requested == "opencl") "opencl" else "vulkan"
        val preferGpu = requested != "cpu"
        val apiName = if (api == "opencl") "OpenCL" else "Vulkan"
        val executable = executableFor(api)
        if (!executable.isFile) throw IOException(
            if (api == "opencl") "The OpenCL image engine is missing from this APK" else "Native image runtime is missing from this APK")
        phase = if (preferGpu) "Checking $apiName GPU" else "CPU selected manually"
        // Recheck on every GPU generation: a previous successful enumeration is
        // not proof that the driver/runtime is still available for this run.
        val probeEnumerated = preferGpu && detectVulkan(executable, cancelled, force = true, api = api)
        if (cancelled()) throw IOException("Generation cancelled")
        // Do not launch a GPU run against an unverified device: the app then tries the next backend.
        if (preferGpu && !probeEnumerated) {
            computeBackend = "$apiName unavailable (probe failed)"
            throw IOException("No usable $apiName diffusion GPU was detected by the native image engine. " +
                "Device probe: " + deviceLabel.takeLast(380) + ".")
        }
        val gpuRequested = preferGpu
        // The Snapdragon/Adreno Vulkan driver can reject BF16 matrix-vector
        // compute pipelines, even when it correctly detects the GPU.
        // Convert BF16 safetensors weights to F16 *in memory while loading*.
        // Do not rewrite the model file or expand quantized GGUF checkpoints.
        val precisionArgs = AtlasImageGpuPrecision.overrideArguments(primary, gpuRequested)
        weightPrecision = if (precisionArgs.isNotEmpty())
            "BF16 checkpoint -> F16 $apiName compatibility"
        else "Original checkpoint precision"
        computeBackend = if (gpuRequested) "$apiName GPU requested (unverified)" else "CPU"
        if (!preferGpu) deviceLabel = "GPU disabled in settings"


        val width = (if (params.hasKey("width")) params.getInt("width") else 512).coerceIn(256, 1024)
        val height = (if (params.hasKey("height")) params.getInt("height") else 512).coerceIn(256, 1024)
        val steps = (if (params.hasKey("steps")) params.getInt("steps") else 20).coerceIn(1, 60)
        val seed = if (params.hasKey("seed")) params.getDouble("seed").toLong() else 42L
        val scale = if (params.hasKey("guidanceScale")) params.getDouble("guidanceScale") else 7.0
        var prompt = params.getString("prompt")?.trim() ?: ""
        if (prompt.isBlank()) throw IOException("A prompt is required")
        val id = UUID.randomUUID().toString()
        val output = File(File(context.filesDir, "generated_images").apply { mkdirs() }, "$id.png")
        val cmd = mutableListOf(executable.absolutePath)
        if (family in setOf("flux", "z_image", "anima", "chroma"))
            cmd.addAll(listOf("--diffusion-model", primary.absolutePath))
        else cmd.addAll(listOf("-m", primary.absolutePath))
        val attachments = mutableMapOf<String, File>()
        val support = manifest.optJSONArray("support")
        val loraDir = File(dir, "support/lora")
        var hasLora = false
        if (support != null) for (i in 0 until support.length()) {
            val item = support.getJSONObject(i)
            if (!item.optBoolean("enabled", true)) continue
            val kind = item.getString("kind")
            val path = File(item.getString("path")).canonicalFile
            if (!path.path.startsWith(File(dir, "support").canonicalPath + File.separator) ||
                !path.isFile) throw IOException("Missing or unsafe attached $kind file")
            if (kind == "lora") {
                if (params.hasKey("skipLoRA") && params.getBoolean("skipLoRA")) continue
                hasLora = true
                val name = path.name.substringBeforeLast('.')
                if (!name.matches(Regex("[a-zA-Z0-9_.-]+"))) throw IOException("Unsafe LoRA filename")
                val strength = item.optDouble("strength", 0.75).coerceIn(-2.0, 2.0)
                prompt += "<lora:$name:$strength>"
            } else attachments[kind] = path
        }
        // Versioned atlas-runtime.json supports native sampler/schedule settings.
        // Generic tokenizer/config JSON is metadata and does not enable a new model architecture.
        val runtimeConfig = AtlasNativeImageConfig.resolve(dir, support)
        val missing = AtlasImageArchitecture.missing(family, attachments.keys)
        if (missing.isNotEmpty()) {
            throw IOException(family.uppercase() + " is missing required components: " +
                missing.joinToString(", ") + ". Attach them in My models before generating.")
        }
        for ((type, flag) in listOf("vae" to "--vae", "clip_l" to "--clip_l",
                "t5xxl" to "--t5xxl", "llm" to "--llm")) {
            attachments[type]?.let { cmd.addAll(listOf(flag, it.absolutePath)) }
        }
        if (hasLora) cmd.addAll(listOf("--lora-model-dir", loraDir.absolutePath))
        // Use sd.cpp's on-load conversion for BF16 matrices to avoid broken
        // mul_mat_vec_bf16_f32_f32 pipeline creation on mobile Adreno Vulkan.
        // --type f16 is supported by the pinned sd.cpp CLI; it converts
        // eligible matrix weights but does not modify the saved checkpoint.
        cmd.addAll(precisionArgs)
        // Explicit execution assignment: quantized transformer diffusion runs on
        // the probed GPU device (vulkanN or GPUOpenCL), while Qwen/T5 encoders and
        // VAE stay on CPU to reduce transient GPU allocations. If the GPU run fails,
        // the app retries with the next backend and tells the user.
        if (gpuRequested) {
            cmd.addAll(listOf("--backend", "diffusion=$vulkanDevice,te=cpu,vae=cpu",
                "--auto-fit", "on", "--max-vram", "$vulkanDevice=4"))
        } else {
            cmd.addAll(listOf("--backend", "cpu"))
        }
        cmd.addAll(listOf("-p", prompt, "-o", output.absolutePath,
            "-W", width.toString(), "-H", height.toString(),
            "--steps", steps.toString(), "-s", seed.toString(),
            "--cfg-scale", AtlasImageArchitecture.cfg(family, variant, scale).toString(),
            "--vae-tiling", "--clip-on-cpu"))
        // sdcpp defaults to every physical core. Four threads is more thermal-
        // friendly on a phone; expose it in Atlas settings for native checkpoints.
        val threads = (if (params.hasKey("threads")) params.getInt("threads") else 4).coerceIn(1, 8)
        cmd.addAll(listOf("--threads", threads.toString(), "--log-level", "verbose"))
        // On Vulkan, auto-fit manages residency: do NOT force
        // --offload-to-cpu, which would disable auto-fit and over-stage weights.
        AtlasNativeImageConfig.addArguments(cmd, runtimeConfig, family)
        if (family in setOf("z_image", "anima", "chroma")) {
            cmd.add("--diffusion-fa")
            if (!gpuRequested) cmd.add("--offload-to-cpu")
        }
        if (family == "chroma") cmd.addAll(listOf("--model-args", "chroma_use_dit_mask=false"))
        // A rough picture of the image so far (the latent shown as colours, no extra decoding),
        // written every few steps so the app can show the image taking shape.
        val previews = File(context.cacheDir, "atlas-image-preview").apply { deleteRecursively(); mkdirs() }
        previewDir = previews
        val previewEvery = (if (params.hasKey("previewInterval")) params.getInt("previewInterval") else 2).coerceIn(1, 10)
        cmd.addAll(listOf("--preview", "proj", "--preview-interval", previewEvery.toString(),
            "--preview-path", File(previews, "step_%04d.png").absolutePath))
        if (params.hasKey("negativePrompt") && family != "flux") {
            params.getString("negativePrompt")?.takeIf { it.isNotEmpty() }?.let {
                cmd.addAll(listOf("-n", it))
            }
        }
        val proc = ProcessBuilder(cmd).apply {
            directory(executable.parentFile)
            redirectErrorStream(true)
            configureNativeEnvironment(this, api)
        }.start()
        val startTime = SystemClock.elapsedRealtime()
        startedMs = startTime
        lastOutputMs = startTime
        lastStepMs = 0L
        reportedStep = 0
        requestedSteps = steps
        phase = "Starting " + computeBackend
        running = proc
        val tail = ArrayDeque<String>()
        val watchdogActive = AtomicBoolean(true)
        val watchdogTimedOut = AtomicBoolean(false)
        val shaderFailed = AtomicBoolean(false)
        var completed = false
        val watchdog = thread(start = true, isDaemon = true, name = "AtlasNativeImageWatchdog") {
            while (watchdogActive.get() && proc.isAlive) {
                try { Thread.sleep(4000L) } catch (_: InterruptedException) { break }
                if (watchdogActive.get() && proc.isAlive &&
                    AtlasImageProgress.isStalled(
                        SystemClock.elapsedRealtime(), startedMs, lastStepMs, gpuRequested, lastOutputMs)) {
                    watchdogTimedOut.set(true)
                    phase = "No diffusion step progress; native engine timed out"
                    proc.destroyForcibly()
                    break
                }
            }
        }
        try {
            // CLI terminal progress bars are carriage-return-delimited rather
            // than newline-delimited. BufferedReader.readLine() would hide all
            // intermediate steps, presenting a false "stuck on 1/x" state.
            fun acceptFrame(line: String) {
                lastOutputMs = SystemClock.elapsedRealtime()
                if (tail.size >= 15) tail.removeFirst()
                tail.addLast(line.take(300))
                // Shader compilation failures cannot recover by waiting for another diffusion step.
                if (gpuRequested && api == "vulkan" && (line.contains("Compute pipeline creation failed", ignoreCase = true) ||
                    line.contains("createComputePipeline ErrorUnknown", ignoreCase = true))) {
                    shaderFailed.set(true)
                    phase = "Vulkan shader compilation failed"
                    proc.destroyForcibly()
                }
                AtlasImageProgress.stage(line)?.let { phase = it }
                val step = AtlasImageProgress.parseStep(line, steps)
                if (step != null && step > reportedStep) {
                    lastStepMs = lastOutputMs
                    reportedStep = step
                    phase = "Running diffusion"
                    progress(step, steps)
                }
            }
            try {
                proc.inputStream.bufferedReader().use { reader ->
                    val frame = StringBuilder()
                    while (true) {
                        val next = reader.read()
                        if (next < 0) {
                            if (frame.isNotEmpty()) acceptFrame(frame.toString())
                            break
                        }
                        when (next.toChar()) {
                            '\r', '\n' -> {
                                if (frame.isNotEmpty()) {
                                    acceptFrame(frame.toString())
                                    frame.setLength(0)
                                }
                            }
                            else -> if (frame.length < 4096) frame.append(next.toChar())
                        }
                    }
                }
            } catch (e: IOException) {
                // Killing a stalled/cancelled process can close its stdout pipe
                // during a blocking read. Surface the watchdog/cancel reason
                // below rather than an unhelpful "stream closed" error.
                if (!watchdogTimedOut.get() && !cancelled()) throw e
            }
            val code = proc.waitFor()
            if (cancelled()) throw IOException("Generation cancelled")
            if (shaderFailed.get()) {
                throw IOException("The Vulkan driver rejected a diffusion compute pipeline. " +
                    "Device: " + deviceLabel.takeLast(250) + ". " +
                    "Try compatible F16 or quantized weights, or another backend. " +
                    "Native log: " + tail.joinToString(" | ").takeLast(600))
            }
            if (watchdogTimedOut.get()) {
                val elapsedSinceStep = (SystemClock.elapsedRealtime() -
                    (if (lastStepMs > startedMs) lastStepMs else startedMs)) / 1000L
                throw IOException("Image generation stopped after $elapsedSinceStep seconds without a completed diffusion step " +
                    "on " + (if (gpuRequested) "requested $apiName GPU" else "CPU") +
                    ". Native output may extend the stall window, but cannot extend it indefinitely. " +
                    "Try a smaller quantized checkpoint or resolution.")
            }
            if (code != 0 || !output.isFile || output.length() == 0L) {
                if (output.exists()) output.delete()
                val logTail = tail.joinToString(" | ").takeLast(900)
                val bf16Error = logTail.contains("mul_mat_vec_bf16") ||
                    logTail.contains("bf16", ignoreCase = true) &&
                    logTail.contains("createComputePipeline")
                val hint = when {
                    bf16Error && gpuRequested ->
                        "The Vulkan driver rejected a BF16 compute shader. " +
                        "Precision: $weightPrecision. Use an F16 or quantized " +
                        "Anima checkpoint if this compatibility conversion still fails. "
                    gpuRequested ->
                        "$apiName backend could not generate an image. Device probe: " +
                        deviceLabel.takeLast(380) + ". "
                    else -> "CPU image generation failed. "
                }
                throw IOException(hint + "Native engine exit " + code + ": " + logTail)
            }
            phase = "Finalizing image"
            if (!params.hasKey("skipUpscaler") || !params.getBoolean("skipUpscaler")) {
                attachments["upscaler"]?.let { upscale(executable, it, output, cancelled, api) }
            }
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(output.absolutePath, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
                output.delete()
                throw IOException("Native image engine produced an invalid or undecodable image")
            }
            return Arguments.createMap().apply {
                putString("id", id)
                putString("imagePath", output.absolutePath)
                putInt("width", bounds.outWidth)
                putInt("height", bounds.outHeight)
                putDouble("seed", seed.toDouble())
            }.also { completed = true }
        } finally {
            watchdogActive.set(false)
            watchdog.interrupt()
            if (running === proc) running = null
            phase = if (cancelled()) "Cancelled"
                else if (watchdogTimedOut.get()) "Timed out" else "Finished"
            if (proc.isAlive) proc.destroyForcibly()
            if (!completed && output.exists()) output.delete()
        }
    }

    private fun upscale(executable: File, upscaler: File, original: File, cancelled: () -> Boolean,
                        api: String) {
        val result = File(original.parentFile, original.nameWithoutExtension + ".upscaled.png")
        val args = listOf(executable.absolutePath, "-M", "upscale", "-i", original.absolutePath,
            "--upscale-model", upscaler.absolutePath, "-o", result.absolutePath)
        val process = ProcessBuilder(args).apply {
            directory(executable.parentFile)
            redirectErrorStream(true)
            configureNativeEnvironment(this, api)
        }.start()
        running = process
        try {
            val log = process.inputStream.bufferedReader().use { it.readText().takeLast(800) }
            val code = process.waitFor()
            if (cancelled()) throw IOException("Image upscaling cancelled")
            if (code != 0 || !result.isFile || result.length() <= 0L) {
                throw IOException("Image upscaling failed (exit $code). $log")
            }
            if (!original.delete() || !result.renameTo(original)) {
                throw IOException("Cannot save upscaled image")
            }
        } finally {
            if (running === process) running = null
            if (process.isAlive) process.destroyForcibly()
            if (result.exists()) result.delete()
        }
    }
}
