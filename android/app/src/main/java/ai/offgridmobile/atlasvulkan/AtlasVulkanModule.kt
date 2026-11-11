package ai.offgridmobile.atlasvulkan

import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.io.File
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Proxy
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** Isolated llama.kt Vulkan bridge. Classes are loaded reflectively so a build without llama.kt still starts. */
class AtlasVulkanModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    private val worker = Executors.newSingleThreadExecutor()
    @Volatile private var engine: Any? = null
    private val sessionId = AtomicReference<String?>(null)
    private val cancelled = AtomicBoolean(false)
    // Keep admission and cancellation flag changes in the same critical section.
    private val sessionLock = Any()
    @Volatile private var unloading = false
    override fun getName(): String = "AtlasVulkan"

    @ReactMethod
    fun addListener(eventName: String) { /* Events are emitted only during inference. */ }

    @ReactMethod
    fun removeListeners(count: Int) { /* No native observer is retained. */ }

    /** Classifies why the engine cannot start, so "not in this APK" is never shown as "unsupported GPU". */
    private class RuntimeUnavailable(val code: String, message: String) : Exception(message)

    private fun newEngine(): Any {
        if (Build.VERSION.SDK_INT < MIN_SDK) {
            throw RuntimeUnavailable(SDK_UNSUPPORTED,
                "Vulkan text engine needs Android 10 or newer (this device runs API ${Build.VERSION.SDK_INT})")
        }
        // Load without static init: System.loadLibrary runs in the constructor branch below.
        val engineClass = try { Class.forName(ENGINE_CLASS, false, javaClass.classLoader) }
        catch (_: ClassNotFoundException) {
            throw RuntimeUnavailable(NOT_PACKAGED, "The llama.kt Vulkan engine is not packaged in this APK")
        }
        return try { engineClass.getDeclaredConstructor().newInstance() }
        catch (e: Throwable) {
            // UnsatisfiedLinkError / ExceptionInInitializerError while loading libllamakt.so.
            val cause = (e as? InvocationTargetException)?.targetException ?: e.cause ?: e
            throw RuntimeUnavailable(NATIVE_LOAD_FAILED,
                "The llama.kt native library could not be loaded: ${cause.message ?: cause.javaClass.simpleName}")
        }
    }

    private fun listBackendMaps(instance: Any): List<Map<String, String>> =
        (call(instance, "availableBackends") as List<*>).filterNotNull().map { backend ->
            mapOf(
                "name" to (call(backend, "getName") as? String ?: ""),
                "description" to (call(backend, "getDescription") as? String ?: ""),
                "type" to (call(backend, "getType") as? String ?: ""),
            )
        }

    /** GGUF block count (repeating layers) or -1 when the header cannot be read. */
    private fun readBlockCount(path: String): Long = try {
        val companion = Class.forName(ENGINE_CLASS).getField("Companion").get(null)
        val metadata = call(companion!!, "readMetadata", path)
        (metadata?.let { call(it, "getBlockCount") } as? Long) ?: -1L
    } catch (_: Throwable) { -1L }

    private fun call(target: Any, name: String, vararg args: Any?): Any? {
        val method = target.javaClass.methods.firstOrNull { it.name == name && it.parameterCount == args.size }
            ?: throw NoSuchMethodException(name)
        try { return method.invoke(target, *args) }
        catch (e: InvocationTargetException) { throw e.targetException ?: e }
    }

    private fun emit(name: String, id: String, value: String = "") {
        val data = Arguments.createMap()
        data.putString("sessionId", id)
        data.putString("text", value)
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, data)
    }

    @ReactMethod
    fun listBackends(promise: Promise) {
        worker.execute {
            try {
                val out = Arguments.createArray()
                for (backend in listBackendMaps(newEngine())) {
                    val map = Arguments.createMap()
                    backend.forEach { (key, value) -> map.putString(key, value) }
                    out.pushMap(map)
                }
                promise.resolve(out)
            } catch (e: RuntimeUnavailable) { promise.reject(e.code, e.message)
            } catch (e: Throwable) { promise.reject(PROBE_FAILED, e.message ?: "Vulkan device probe failed") }
        }
    }

    /**
     * Diagnostic status that never rejects. `status` separates a missing native engine
     * (not_packaged, native_load_failed, sdk_unsupported) from hardware without a Vulkan
     * GPU (no_vulkan_device), so diagnostics can say which one applies.
     */
    @ReactMethod
    fun runtimeStatus(promise: Promise) {
        worker.execute {
            val result = Arguments.createMap()
            result.putInt("sdkInt", Build.VERSION.SDK_INT)
            val devices = Arguments.createArray()
            try {
                val backends = listBackendMaps(newEngine())
                var gpuCount = 0
                for (backend in backends) {
                    val map = Arguments.createMap()
                    backend.forEach { (key, value) -> map.putString(key, value) }
                    devices.pushMap(map)
                    if (isVulkanGpu(backend)) gpuCount++
                }
                result.putBoolean("packaged", true)
                result.putString("status", if (gpuCount > 0) "ok" else "no_vulkan_device")
                result.putString("message",
                    if (gpuCount > 0) "Vulkan GPU detected" else "The engine is installed, but no Vulkan GPU was reported by this device's driver")
            } catch (e: RuntimeUnavailable) {
                result.putBoolean("packaged", e.code != NOT_PACKAGED)
                result.putString("status", when (e.code) {
                    NOT_PACKAGED -> "not_packaged"
                    SDK_UNSUPPORTED -> "sdk_unsupported"
                    else -> "native_load_failed"
                })
                result.putString("message", e.message)
            } catch (e: Throwable) {
                result.putBoolean("packaged", true)
                result.putString("status", "probe_failed")
                result.putString("message", e.message ?: "Vulkan device probe failed")
            }
            result.putArray("devices", devices)
            promise.resolve(result)
        }
    }

    @ReactMethod
    fun loadModel(path: String, gpuLayers: Int, context: Int, threads: Int, promise: Promise) {
        if (sessionId.get() != null) {
            promise.reject("VULKAN_BUSY", "Cannot replace a model while generating")
            return
        }
        worker.execute {
            try {
                check(sessionId.get() == null) { "Cannot replace a model while generating" }
                require(File(path).isFile && path.lowercase().endsWith(".gguf")) { "GGUF file not found" }
                require(gpuLayers in 0..99 && context in 256..32768 && threads in 0..16) { "Unsafe inference parameters" }
                cancelled.set(true)
                engine?.let { call(it, "free") }
                engine = null
                sessionId.set(null)
                val candidate = newEngine()
                try {
                    // LoadProgressCallback, kvCacheType and flashAttn are deliberately null.
                    call(candidate, "load", path, gpuLayers, context, threads, null, null, null)
                    engine = candidate
                    cancelled.set(false)
                    val backend = call(candidate, "activeBackend") as? String ?: "unknown"
                    val blockCount = readBlockCount(path)
                    val result = Arguments.createMap()
                    result.putString("backend", backend)
                    result.putInt("requestedGpuLayers", gpuLayers)
                    result.putInt("offloadedGpuLayers",
                        offloadedLayers(gpuLayers, blockCount, backend.startsWith("Vulkan", ignoreCase = true)))
                    result.putInt("totalLayers", if (blockCount > 0) (blockCount + 1).toInt() else -1)
                    promise.resolve(result)
                } catch (failure: Throwable) {
                    try { call(candidate, "free") } catch (_: Throwable) {}
                    throw failure
                }
            } catch (e: RuntimeUnavailable) { promise.reject(e.code, e.message)
            } catch (e: Throwable) { promise.reject("VULKAN_LOAD_FAILED", e.message ?: "Load failed") }
        }
    }

    @ReactMethod
    fun tokenize(text: String, promise: Promise) {
        worker.execute {
            try {
                val current = engine ?: throw IllegalStateException("Load a GGUF model first")
                val ids = call(current, "tokenize", text) as IntArray
                val result = Arguments.createArray()
                ids.forEach { result.pushInt(it) }
                promise.resolve(result)
            } catch (e: Throwable) { promise.reject("VULKAN_TOKENIZE_FAILED", e.message ?: "Tokenization failed") }
        }
    }

    @ReactMethod
    fun formatChat(messagesJson: String, promise: Promise) {
        worker.execute {
            try {
                val current = engine ?: throw IllegalStateException("Load a GGUF model first")
                val json = org.json.JSONArray(messagesJson)
                val chatClass = Class.forName("com.tensai.llamakt.ChatMessage")
                val constructor = chatClass.getConstructor(String::class.java, String::class.java)
                val messages = (0 until json.length()).map { index ->
                    val item = json.getJSONObject(index)
                    constructor.newInstance(item.getString("role"), item.getString("content"))
                }
                promise.resolve(call(current, "formatChat", messages, false) as String)
            } catch (e: Throwable) { promise.reject("VULKAN_CHAT_FORMAT_FAILED", e.message ?: "Unable to format model chat") }
        }
    }

    @ReactMethod
    fun activeBackend(promise: Promise) {
        worker.execute {
            try { promise.resolve(engine?.let { call(it, "activeBackend") as? String } ?: "unloaded") }
            catch (e: Throwable) { promise.reject("VULKAN_STATUS_FAILED", e.message ?: "Status failed") }
        }
    }

    @ReactMethod
    fun generate(prompt: String, maxTokens: Int, id: String, samplingJson: String, promise: Promise) {
        if (id.isBlank() || maxTokens !in 1..4096 || prompt.isBlank()) {
            promise.reject("VULKAN_INVALID_REQUEST", "Invalid session or generation parameters")
            return
        }
        // Reserve and clear the cancellation flag together: an interrupt must not
        // get overwritten by a concurrent generate() call after session admission.
        val admitted = synchronized(sessionLock) {
            if (unloading || sessionId.get() != null) false
            else {
                cancelled.set(false)
                sessionId.set(id)
                true
            }
        }
        if (!admitted) {
            promise.reject("VULKAN_BUSY", "Generation is already active")
            return
        }
        worker.execute {
            if (cancelled.get()) { promise.resolve(false); sessionId.compareAndSet(id, null); return@execute }
            val current = engine
            if (current == null) { promise.reject("VULKAN_NOT_LOADED", "Load a GGUF model first"); sessionId.compareAndSet(id, null); return@execute }
            try {
                val opts = org.json.JSONObject(samplingJson)
                val temperature = opts.optDouble("temperature", 0.8).toFloat().coerceIn(0f, 2f)
                val topK = opts.optInt("topK", 40).coerceIn(1, 200)
                val topP = opts.optDouble("topP", 0.95).toFloat().coerceIn(0.01f, 1f)
                val minP = opts.optDouble("minP", 0.05).toFloat().coerceIn(0f, 1f)
                val repeatPenalty = opts.optDouble("repeatPenalty", 1.0).toFloat().coerceIn(1f, 2f)
                val stopJson = opts.optJSONArray("stop")
                val stops = if (stopJson == null) emptyList<String>() else
                    (0 until stopJson.length()).mapNotNull { stopJson.optString(it).takeIf { s -> s.isNotBlank() } }.take(16)
                val paramsClass = Class.forName("com.tensai.llamakt.SamplingParams")
                val ctor = paramsClass.constructors.first { it.parameterCount == 9 }
                val params = ctor.newInstance(maxTokens, temperature, topK, topP, minP,
                    stops, -1, repeatPenalty, 64)
                val callbackClass = Class.forName("com.tensai.llamakt.TokenCallback")
                val callback = Proxy.newProxyInstance(callbackClass.classLoader, arrayOf(callbackClass)) { _, method, args ->
                    if (method.name == "onToken" && !cancelled.get() && sessionId.get() == id) {
                        emit("AtlasVulkanToken", id, args?.firstOrNull() as? String ?: "")
                    }
                    null
                }
                // chatParseCallback is optional.
                // Pinned llama.kt returns a signed decode count; negative signals a native failure.
                // Never report completion success for a failed decode with partial token output.
                val decodedTokens = call(current, "completion", prompt, params, callback, null) as? Int
                    ?: throw IllegalStateException("Native completion did not return a token count")
                if (decodedTokens < 0) throw IllegalStateException("Native Vulkan decode failed (code $decodedTokens)")
                if (sessionId.get() == id) emit("AtlasVulkanEnd", id)
                promise.resolve(true)
            } catch (e: Throwable) {
                if (sessionId.get() == id) emit("AtlasVulkanError", id, e.message ?: "Generation failed")
                promise.reject("VULKAN_GENERATION_FAILED", e.message ?: "Generation failed")
            } finally { sessionId.compareAndSet(id, null) }
        }
    }

    @ReactMethod
    fun interrupt(id: String, promise: Promise) {
        try {
            // Queued generation may not have acquired an engine yet. Still cancel
            // its reserved session, so the worker does not start it later.
            val matched = synchronized(sessionLock) {
                if (sessionId.get() != id) false
                else { cancelled.set(true); true }
            }
            if (matched) engine?.let { call(it, "interrupt") }
            promise.resolve(matched)
        } catch (e: Throwable) { promise.reject("VULKAN_INTERRUPT_FAILED", e.message ?: "Interrupt failed") }
    }

    @ReactMethod
    fun unload(promise: Promise) {
        val admitted = synchronized(sessionLock) {
            if (unloading) false
            else {
                unloading = true
                cancelled.set(true)
                true
            }
        }
        if (!admitted) { promise.reject("VULKAN_BUSY", "Unload already in progress"); return }
        engine?.let { try { call(it, "interrupt") } catch (_: Throwable) {} }
        try {
            worker.execute {
                try {
                    engine?.let { call(it, "free") }
                    engine = null
                    sessionId.set(null)
                    promise.resolve(true)
                } catch (e: Throwable) { promise.reject("VULKAN_UNLOAD_FAILED", e.message ?: "Unload failed") }
                finally { synchronized(sessionLock) { unloading = false } }
            }
        } catch (e: Throwable) {
            synchronized(sessionLock) { unloading = false }
            promise.reject("VULKAN_UNLOAD_FAILED", e.message ?: "Unload could not be queued")
        }
    }

    override fun invalidate() {
        cancelled.set(true)
        engine?.let { try { call(it, "interrupt") } catch (_: Throwable) {} }
        worker.execute { engine?.let { try { call(it, "free") } catch (_: Throwable) {} }; engine = null }
        worker.shutdown()
        super.invalidate()
    }

    companion object {
        const val MIN_SDK = 29
        const val ENGINE_CLASS = "com.tensai.llamakt.LlamaEngine"
        const val NOT_PACKAGED = "VULKAN_NOT_PACKAGED"
        const val SDK_UNSUPPORTED = "VULKAN_SDK_UNSUPPORTED"
        const val NATIVE_LOAD_FAILED = "VULKAN_NATIVE_LOAD_FAILED"
        const val PROBE_FAILED = "VULKAN_PROBE_FAILED"

        fun isVulkanGpu(backend: Map<String, String>): Boolean =
            backend["type"].orEmpty().contains("gpu", ignoreCase = true) &&
                "${backend["description"]} ${backend["name"]}".contains("vulkan", ignoreCase = true)

        /**
         * llama.cpp offloads min(n_gpu_layers, n_block + 1) layers (repeating blocks plus the
         * output layer) to the selected GPU. -1 means the model header could not be read.
         */
        fun offloadedLayers(requested: Int, blockCount: Long, onVulkan: Boolean): Int = when {
            !onVulkan || requested <= 0 -> 0
            blockCount <= 0 -> -1
            else -> minOf(requested.toLong(), blockCount + 1).toInt()
        }
    }
}
