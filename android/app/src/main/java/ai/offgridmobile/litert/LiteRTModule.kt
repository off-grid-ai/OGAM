package ai.offgridmobile.litert

import android.util.Log
import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.Debug
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import ai.offgridmobile.SafePromise
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.BenchmarkInfo
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Content
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.ExperimentalApi
import com.google.ai.edge.litertlm.SamplerConfig
import com.google.ai.edge.litertlm.OpenApiTool
import com.google.ai.edge.litertlm.ToolProvider
import com.google.ai.edge.litertlm.tool
import com.google.ai.edge.litertlm.Message as LiteRTMessage
import com.google.gson.JsonParser
import kotlinx.coroutines.*
import java.io.File
import java.io.InputStream
import java.io.ByteArrayOutputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import android.net.Uri
import android.graphics.Bitmap
import android.graphics.BitmapFactory

class LiteRTModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "LiteRTModule"

        // Streaming events sent to JS
        const val EVENT_TOKEN     = "litert_token"
        const val EVENT_THINKING  = "litert_thinking"
        const val EVENT_COMPLETE  = "litert_complete"
        const val EVENT_ERROR     = "litert_error"
        const val EVENT_TOOL_CALL = "litert_tool_call"
        const val EVENT_DEBUG_LOG = "litert_debug_log"

        // Base timeouts per backend tier (for default 4096-token context).
        // Actual timeout scales up proportionally for larger context windows
        // because KV-cache allocation takes longer at higher token counts.
        private const val NPU_BASE_TIMEOUT_MS = 90_000L
        private const val GPU_BASE_TIMEOUT_MS = 90_000L
        private const val CPU_BASE_TIMEOUT_MS = 90_000L
        private const val DEFAULT_CONTEXT_TOKENS = 4096

        fun initTimeoutMs(backend: Backend, maxNumTokens: Int): Long {
            val base = when (backend) {
                is Backend.NPU -> NPU_BASE_TIMEOUT_MS
                is Backend.GPU -> GPU_BASE_TIMEOUT_MS
                else           -> CPU_BASE_TIMEOUT_MS
            }
            // Scale linearly above the default context size, capped at 3 minutes.
            val scalar = maxOf(1.0, maxNumTokens.toDouble() / DEFAULT_CONTEXT_TOKENS)
            return minOf((base * scalar).toLong(), 180_000L)
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private var engine: Engine? = null
    @Volatile private var conversation: com.google.ai.edge.litertlm.Conversation? = null
    private var activeBackend: String = "cpu"
    private var supportsVision: Boolean = false
    private var supportsAudio: Boolean = false
    private var currentJob: Job? = null

    // Pending tool calls waiting for JS to respond via respondToToolCall()
    private val pendingToolCalls = ConcurrentHashMap<String, CompletableDeferred<String>>()
    private var configuredMaxTokens: Int = 4096

    override fun getName(): String = "LiteRTModule"

    // -------------------------------------------------------------------------
    // loadModel
    // -------------------------------------------------------------------------

    @ReactMethod
    fun loadModel(modelPath: String, backendStr: String, visionEnabled: Boolean, audioEnabled: Boolean, maxNumTokens: Int, promise: Promise) {
        val safe = SafePromise(promise, TAG)
        Log.i(TAG, "loadModel — path=$modelPath backend=$backendStr vision=$visionEnabled audio=$audioEnabled maxNumTokens=$maxNumTokens")

        scope.launch {
            try {
                configuredMaxTokens = maxNumTokens
                // Unload any existing engine first
                cleanupEngine()

                val requestedBackend = parseBackend(backendStr)
                Log.i(TAG, "loadModel — attempting backend chain from $backendStr")

                val resolvedBackend = initializeWithFallback(modelPath, requestedBackend, visionEnabled, audioEnabled)
                activeBackend = backendName(resolvedBackend)
                supportsVision = visionEnabled
                supportsAudio = audioEnabled

                Log.i(TAG, "loadModel — success on backend=$activeBackend vision=$supportsVision audio=$supportsAudio")
                safe.resolve(activeBackend)
            } catch (e: Exception) {
                Log.e(TAG, "loadModel — all backends failed: ${e.message}", e)
                safe.reject("LITERT_LOAD_ERROR", "Failed to load model: ${e.message}", e)
            }
        }
    }

    // 3-tier fallback: NPU → GPU → CPU
    private fun buildBackendChain(requested: Backend): List<Backend> {
        // GPU init crashes on Pixel 10 — open LiteRT SDK bug.
        val skipGpu = Build.MODEL?.lowercase()?.contains("pixel 10") == true
        return when (requested) {
            is Backend.NPU -> listOfNotNull(
                Backend.NPU(nativeLibraryDir = reactContext.applicationInfo.nativeLibraryDir),
                if (skipGpu) null else Backend.GPU(),
                Backend.CPU(),
            )
            is Backend.GPU -> if (skipGpu) listOf(Backend.CPU()) else listOf(Backend.GPU(), Backend.CPU())
            else           -> listOf(Backend.CPU())
        }
    }

    private suspend fun tryInitBackend(modelPath: String, backend: Backend, name: String, visionEnabled: Boolean, audioEnabled: Boolean): Boolean {
        var eng: Engine? = null
        return try {
            val cfg = EngineConfig(
                modelPath = modelPath,
                backend = backend,
                maxNumTokens = configuredMaxTokens,
                cacheDir = null,
                visionBackend = if (visionEnabled) Backend.GPU() else null,
                // Audio sub-model runs on CPU — the USM conformer encoder has no
                // GPU/NPU delegate in litert-lm, and CPU keeps it off the GPU path
                // that vision/decoder use.
                audioBackend = if (audioEnabled) Backend.CPU() else null,
            )
            eng = Engine(cfg)
            withTimeout(initTimeoutMs(backend, configuredMaxTokens)) { eng.initialize() }
            engine = eng
            true
        } catch (e: Exception) {
            Log.w(TAG, "initializeWithFallback — $name failed: ${e.message}")
            // Close the local engine attempt — not the module-level `engine` field,
            // which belongs to a previous successful load and must not be touched here.
            try { eng?.close() } catch (closeEx: Exception) {
                Log.w(TAG, "initializeWithFallback — $name engine close error: ${closeEx.message}")
            }
            false
        }
    }

    private suspend fun initializeWithFallback(modelPath: String, requested: Backend, visionEnabled: Boolean, audioEnabled: Boolean): Backend {
        val chain = buildBackendChain(requested)

        // GPU/NPU failures can be transient (e.g. VRAM not yet released after a model switch).
        // Retry up to 2 extra times with backoff before giving up on a non-CPU backend.
        val gpuRetries = 2
        val gpuRetryDelayMs = 600L

        for (backend in chain) {
            val name = backendName(backend)
            val maxAttempts = if (backend is Backend.CPU) 1 else gpuRetries + 1

            for (attempt in 1..maxAttempts) {
                if (attempt > 1) {
                    Log.i(TAG, "initializeWithFallback — $name retry $attempt/$maxAttempts after ${gpuRetryDelayMs}ms")
                    delay(gpuRetryDelayMs)
                } else {
                    Log.i(TAG, "initializeWithFallback — trying $name vision=$visionEnabled audio=$audioEnabled")
                }
                if (tryInitBackend(modelPath, backend, name, visionEnabled, audioEnabled)) return backend
            }

            if (backend != chain.last()) {
                Log.i(TAG, "initializeWithFallback — $name exhausted retries, falling back to next tier")
            }
        }
        throw IllegalStateException("All backends failed")
    }

    // -------------------------------------------------------------------------
    // resetConversation — closes and recreates Conversation only, Engine stays
    // -------------------------------------------------------------------------

    @ReactMethod
    fun resetConversation(systemPrompt: String, temperature: Double, topK: Int, topP: Double, toolsJson: String, historyJson: String, promise: Promise) {
        val safe = SafePromise(promise, TAG)
        Log.i(TAG, "resetConversation — systemPrompt length=${systemPrompt.length} temperature=$temperature topK=$topK topP=$topP tools=${toolsJson.length}ch history=${historyJson.length}ch")

        scope.launch {
            try {
                val eng = engine
                if (eng == null) {
                    Log.w(TAG, "resetConversation — no engine loaded")
                    safe.reject("LITERT_NOT_LOADED", "No model loaded", null)
                    return@launch
                }

                // Close existing conversation first
                closeConversationSafely()

                // SamplerConfig is not supported on NPU
                val samplerConfig = if (activeBackend == "npu") {
                    debugLog("SamplerConfig — skipped (NPU backend does not support it)")
                    null
                } else {
                    debugLog("SamplerConfig — temperature=$temperature topK=$topK topP=$topP")
                    SamplerConfig(
                        topK = topK,
                        topP = topP,
                        temperature = temperature,
                    )
                }

                val toolProviders = buildToolProviders(toolsJson)
                val initialMessages = parseHistoryMessages(historyJson)
                debugLog("ConversationConfig — historyTurns=${initialMessages.size} tools=${toolProviders.size} maxTokenBudget=$configuredMaxTokens autoToolCalling=${toolProviders.isNotEmpty()}")
                val convConfig = ConversationConfig(
                    systemInstruction = if (systemPrompt.isNotEmpty())
                        Contents.of(systemPrompt) else null,
                    initialMessages = initialMessages,
                    tools = toolProviders,
                    samplerConfig = samplerConfig,
                    automaticToolCalling = toolProviders.isNotEmpty(),
                )

                try {
                    conversation = eng.createConversation(convConfig)
                } catch (e: Exception) {
                    if (e.message?.contains("session already exists", ignoreCase = true) == true) {
                        Log.w(TAG, "resetConversation — stale session detected, forcing teardown and retrying")
                        closeConversationSafely()
                        conversation = eng.createConversation(convConfig)
                    } else throw e
                }
                debugLog("conversation ready — historyTurns=${initialMessages.size} tools=${toolProviders.size} maxTokenBudget=$configuredMaxTokens")
                safe.resolve(null)
            } catch (e: Exception) {
                Log.e(TAG, "resetConversation — error: ${e.message}", e)
                safe.reject("LITERT_CONV_ERROR", "Failed to reset conversation: ${e.message}", e)
            }
        }
    }

    private fun dispatchStreamToken(message: LiteRTMessage) {
        val thought = message.channels["thought"]
        if (thought != null && thought.isNotEmpty()) {
            sendEvent(EVENT_THINKING, thought)
        } else {
            val token = message.contents.contents
                .filterIsInstance<Content.Text>()
                .joinToString("") { it.text }
            if (token.isNotEmpty()) sendEvent(EVENT_TOKEN, token)
        }
    }

    @OptIn(ExperimentalApi::class)
    private fun buildBenchmarkJson(conv: com.google.ai.edge.litertlm.Conversation): String {
        return try {
            val b = conv.getBenchmarkInfo()
            val contextUsed = b.lastPrefillTokenCount + b.lastDecodeTokenCount
            debugLog("context — prefill=${b.lastPrefillTokenCount} decoded=${b.lastDecodeTokenCount} total=$contextUsed/$configuredMaxTokens ttft=${b.timeToFirstTokenInSecond}s decode=${b.lastDecodeTokensPerSecond}tok/s")
            """{"ttft":${b.timeToFirstTokenInSecond},"decodeTokensPerSecond":${b.lastDecodeTokensPerSecond},"prefillTokensPerSecond":${b.lastPrefillTokensPerSecond},"prefillTokenCount":${b.lastPrefillTokenCount},"decodeTokenCount":${b.lastDecodeTokenCount},"maxNumTokens":$configuredMaxTokens,"initTimeSeconds":${b.initTimeInSecond}}"""
        } catch (e: Exception) {
            Log.w(TAG, "getBenchmarkInfo failed: ${e.message}")
            ""
        }
    }

    private fun buildSendContents(imageUris: List<String>, audioUris: List<String>, text: String, safe: SafePromise): Contents? {
        val usableImages = if (supportsVision) imageUris else emptyList()
        val usableAudio = if (supportsAudio) audioUris else emptyList()
        if (usableImages.isEmpty() && usableAudio.isEmpty()) {
            if (audioUris.isNotEmpty() && !supportsAudio) {
                Log.w(TAG, "buildSendContents — audio was provided but supportsAudio=false; " +
                    "dropping audio and sending text-only (textLen=${text.length}). " +
                    "Model was loaded without audioEnabled.")
            }
            return Contents.of(text)
        }
        return try {
            val contents = mutableListOf<Content>()
            usableImages.forEach { imageUri ->
                contents += Content.ImageBytes(readImageAsPngBytes(imageUri))
            }
            usableAudio.forEach { audioUri ->
                // litert-lm decodes Content.AudioBytes with miniaudio, which needs a
                // real audio container (WAV/MP3/FLAC with header) — NOT headerless PCM.
                // Pass the full .wav file bytes (RIFF header intact) so miniaudio can
                // decode + resample it. Stripping to raw PCM fails native init with
                // "miniaudio decoder, error code: -10" (MA_INVALID_FILE).
                val audioBytes = File(stripFileScheme(audioUri)).readBytes()
                contents += Content.AudioBytes(audioBytes)
            }
            // Text goes after media, and only when present — an empty text turn
            // alongside audio produces no reply.
            if (text.isNotEmpty()) {
                contents += Content.Text(text)
            }
            Contents.of(*contents.toTypedArray())
        } catch (e: Exception) {
            Log.e(TAG, "sendMessage — failed to read media: ${e.message}", e)
            sendEvent(EVENT_ERROR, "Failed to read media: ${e.message}")
            safe.reject("LITERT_MEDIA_ERROR", "Failed to read media: ${e.message}", e)
            null
        }
    }

    private fun stripFileScheme(uri: String): String =
        if (uri.startsWith("file://")) Uri.parse(uri).path ?: uri.removePrefix("file://") else uri

    // -------------------------------------------------------------------------
    // sendMessage — sends only the current user turn, library holds history
    // -------------------------------------------------------------------------

    @ReactMethod
    fun sendMessage(text: String, imageUri: String?, promise: Promise) {
        val safe = SafePromise(promise, TAG)
        Log.i(TAG, "sendMessage — text length=${text.length} hasImage=${imageUri != null}")
        sendMessageInternal(text, imageUri?.let { listOf(it) } ?: emptyList(), emptyList(), safe)
    }

    @ReactMethod
    fun sendMessageWithImages(text: String, imageUris: ReadableArray?, promise: Promise) {
        val safe = SafePromise(promise, TAG)
        val uris = readableArrayToStringList(imageUris)
        Log.i(TAG, "sendMessageWithImages — text length=${text.length} imageCount=${uris.size}")
        sendMessageInternal(text, uris, emptyList(), safe)
    }

    @ReactMethod
    fun sendMessageWithAudio(text: String, audioUris: ReadableArray?, promise: Promise) {
        val safe = SafePromise(promise, TAG)
        val uris = readableArrayToStringList(audioUris)
        sendMessageInternal(text, emptyList(), uris, safe)
    }

    @ReactMethod
    fun sendMessageWithMedia(text: String, imageUris: ReadableArray?, audioUris: ReadableArray?, promise: Promise) {
        val safe = SafePromise(promise, TAG)
        val imgs = readableArrayToStringList(imageUris)
        val auds = readableArrayToStringList(audioUris)
        sendMessageInternal(text, imgs, auds, safe)
    }

    private fun sendMessageInternal(text: String, imageUris: List<String>, audioUris: List<String>, safe: SafePromise) {
        scope.launch {
            currentJob?.join()

            val conv = conversation
            if (conv == null) {
                Log.w(TAG, "sendMessage — no conversation, call resetConversation first")
                safe.reject("LITERT_NO_CONV", "No conversation. Call resetConversation first.", null)
                return@launch
            }

            currentJob = launch {
                try {
                    val contents = buildSendContents(imageUris, audioUris, text, safe) ?: return@launch

                    var tokenCount = 0
                    conv.sendMessageAsync(contents)
                        .collect { message ->
                            tokenCount++
                            if (tokenCount == 1) Log.i(TAG, "sendMessage — first message from model (audio=${audioUris.size} image=${imageUris.size})")
                            dispatchStreamToken(message)
                        }

                    sendEvent(EVENT_COMPLETE, buildBenchmarkJson(conv))
                    safe.resolve(null)
                } catch (e: CancellationException) {
                    Log.i(TAG, "sendMessage — job cancelled")
                    sendEvent(EVENT_COMPLETE, "")
                    safe.resolve(null)
                } catch (e: OutOfMemoryError) {
                    Log.e(TAG, "sendMessage — OOM: ${e.message}")
                    sendEvent(EVENT_ERROR, "Out of memory processing image")
                    safe.reject("LITERT_OOM", "Out of memory processing image", null)
                } catch (e: Exception) {
                    Log.e(TAG, "sendMessage — error: ${e.message}", e)
                    sendEvent(EVENT_ERROR, e.message ?: "Unknown error")
                    safe.reject("LITERT_GEN_ERROR", "Generation failed: ${e.message}", e)
                } finally {
                    currentJob = null
                }
            }
        }
    }

    private fun readableArrayToStringList(array: ReadableArray?): List<String> {
        if (array == null) return emptyList()
        val values = mutableListOf<String>()
        for (i in 0 until array.size()) {
            val value = array.getString(i)?.trim()
            if (!value.isNullOrEmpty()) values += value
        }
        return values
    }

    // -------------------------------------------------------------------------
    // respondToToolCall — called from JS to unblock a pending tool execute()
    // -------------------------------------------------------------------------

    @ReactMethod
    fun respondToToolCall(callId: String, result: String) {
        Log.d(TAG, "respondToToolCall — callId=$callId resultLen=${result.length}")
        pendingToolCalls.remove(callId)?.complete(result)
    }

    // -------------------------------------------------------------------------
    // stopGeneration
    // -------------------------------------------------------------------------

    @ReactMethod
    fun stopGeneration(promise: Promise) {
        val safe = SafePromise(promise, TAG)
        Log.i(TAG, "stopGeneration — signalling stop")
        // Cancel the coroutine job — CancellationException propagates into sendMessageAsync
        currentJob?.cancel()
        // Signal the native inference thread to stop — safe to call from any thread
        try {
            conversation?.cancelProcess()
        } catch (e: Exception) {
            Log.w(TAG, "stopGeneration — cancelProcess error: ${e.message}")
        }
        Log.i(TAG, "stopGeneration — done")
        safe.resolve(null)
    }

    // -------------------------------------------------------------------------
    // unloadModel — conversation first, then engine (order is critical)
    // -------------------------------------------------------------------------

    @ReactMethod
    fun unloadModel(promise: Promise) {
        val safe = SafePromise(promise, TAG)
        Log.i(TAG, "unloadModel — starting cleanup")

        scope.launch {
            try {
                cleanupEngine()
                activeBackend = "cpu"
                supportsVision = false
                Log.i(TAG, "unloadModel — done")
                safe.resolve(null)
            } catch (e: Exception) {
                Log.e(TAG, "unloadModel — error: ${e.message}", e)
                safe.resolve(null) // resolve anyway
            }
        }
    }

    // -------------------------------------------------------------------------
    // getActiveBackend — returns which backend is actually running
    // -------------------------------------------------------------------------

    @ReactMethod
    fun getActiveBackend(promise: Promise) {
        SafePromise(promise, TAG).resolve(activeBackend)
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private suspend fun closeConversationSafely() {
        // Cancel and wait for any running inference job to fully stop before closing
        currentJob?.cancel()
        currentJob?.join()
        currentJob = null

        pendingToolCalls.forEach { (callId, deferred) ->
            Log.d(TAG, "closeConversationSafely — cancelling pending tool call $callId")
            deferred.cancel(CancellationException("Conversation closed"))
        }
        pendingToolCalls.clear()

        // Null first — any concurrent caller gets null and returns, preventing double-close
        val conv = conversation ?: return
        conversation = null

        // Safety net: signal stop in case stopGeneration was not called before close
        try {
            conv.cancelProcess()
        } catch (e: Exception) {
            Log.w(TAG, "closeConversationSafely — cancelProcess error: ${e.message}")
        }
        try {
            conv.close()
            Log.d(TAG, "closeConversationSafely — closed")
        } catch (e: Exception) {
            Log.w(TAG, "closeConversationSafely — error: ${e.message}")
        }
    }

    private suspend fun cleanupEngine() {
        // conversation MUST be closed before engine
        closeConversationSafely()
        try {
            engine?.close()
            Log.d(TAG, "cleanupEngine — engine closed")
        } catch (e: Exception) {
            Log.w(TAG, "cleanupEngine — engine close error (ignored): ${e.message}")
        } finally {
            engine = null
        }
    }

    // -------------------------------------------------------------------------
    // getMemoryInfo — live RAM usage + process GPU memory
    // -------------------------------------------------------------------------

    @ReactMethod
    fun getMemoryInfo(promise: Promise) {
        val safe = SafePromise(promise, TAG)
        try {
            val am = reactContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager

            // System RAM
            val ramInfo = ActivityManager.MemoryInfo()
            am.getMemoryInfo(ramInfo)
            val totalRamMb = ramInfo.totalMem / (1024 * 1024)
            val availRamMb = ramInfo.availMem / (1024 * 1024)
            val usedRamMb = totalRamMb - availRamMb

            // Process GPU memory (graphics + GL textures) via Debug.MemoryInfo
            val memInfo = Debug.MemoryInfo()
            Debug.getMemoryInfo(memInfo)
            val gpuPrivateMb = try {
                (memInfo.getMemoryStat("summary.graphics") ?: "0").toLong() / 1024
            } catch (e: Exception) { 0L }

            val result = Arguments.createMap().apply {
                putDouble("totalRamMb", totalRamMb.toDouble())
                putDouble("usedRamMb", usedRamMb.toDouble())
                putDouble("availRamMb", availRamMb.toDouble())
                putDouble("gpuPrivateMb", gpuPrivateMb.toDouble())
                putBoolean("lowMemory", ramInfo.lowMemory)
            }
            safe.resolve(result)
        } catch (e: Exception) {
            safe.reject("MEM_ERROR", "Failed to get memory info: ${e.message}", e)
        }
    }

    private fun parseBackend(s: String): Backend = when (s.lowercase()) {
        "npu", "htp" -> Backend.NPU(
            nativeLibraryDir = reactContext.applicationInfo.nativeLibraryDir
        )
        "gpu", "opencl", "metal" -> Backend.GPU()
        else -> Backend.CPU()
    }

    private fun backendName(b: Backend): String = when (b) {
        is Backend.NPU -> "npu"
        is Backend.GPU -> "gpu"
        else           -> "cpu"
    }

    /**
     * Decode image URI → Bitmap → PNG bytes.
     * Handles content:// (gallery picker) and file:// (filesystem) URIs.
     * Converting to PNG ensures the model receives a well-formed image format
     * regardless of the source (JPEG, WebP, HEIC, etc.).
     * Max dimension is capped at 1024px to avoid OOM on large photos.
     */
    private fun readImageAsPngBytes(uri: String): ByteArray {
        val inputStream: InputStream = if (uri.startsWith("content://")) {
            reactContext.contentResolver.openInputStream(Uri.parse(uri))
                ?: throw IllegalArgumentException("Cannot open content URI: $uri")
        } else {
            File(uri.removePrefix("file://")).inputStream()
        }

        val bitmap = inputStream.use { BitmapFactory.decodeStream(it) }
            ?: throw IllegalArgumentException("Failed to decode image from URI: $uri")

        // Scale down if either dimension exceeds 1024px to avoid OOM
        val scaled = scaleBitmapIfNeeded(bitmap, maxDim = 1024)

        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.PNG, 100, out)
        if (scaled !== bitmap) scaled.recycle()
        bitmap.recycle()
        return out.toByteArray()
    }

    private fun scaleBitmapIfNeeded(src: Bitmap, maxDim: Int): Bitmap {
        val w = src.width
        val h = src.height
        if (w <= maxDim && h <= maxDim) return src
        val scale = maxDim.toFloat() / maxOf(w, h)
        val newW = (w * scale).toInt()
        val newH = (h * scale).toInt()
        return Bitmap.createScaledBitmap(src, newW, newH, true)
    }

    /**
     * Convert a JSON array of prior turns into LiteRT Message objects for ConversationConfig.initialMessages.
     * Only user/assistant text turns are replayed — tool call bridge messages are skipped because
     * the native SDK doesn't need them when automaticToolCalling handles the cycle.
     * Format: [{"role":"user"|"assistant","content":"..."}]
     */
    private fun parseHistoryMessages(historyJson: String): List<LiteRTMessage> {
        if (historyJson.isBlank()) return emptyList()
        return try {
            val arr = JsonParser.parseString(historyJson).asJsonArray
            arr.mapNotNull { element ->
                val obj = element.asJsonObject
                val content = obj.get("content")?.asString?.trim() ?: return@mapNotNull null
                if (content.isEmpty()) return@mapNotNull null
                when (obj.get("role")?.asString) {
                    "user"      -> LiteRTMessage.user(content)
                    "assistant" -> LiteRTMessage.model(Contents.of(content))
                    else        -> return@mapNotNull null
                }
            }.also { Log.i(TAG, "parseHistoryMessages — replaying ${it.size} turns") }
        } catch (e: Exception) {
            Log.w(TAG, "parseHistoryMessages — failed: ${e.message}")
            emptyList()
        }
    }

    /**
     * Parse toolsJson (OpenAPI-format array) into a list of ToolProviders.
     * Each ToolProvider wraps one OpenApiTool whose execute() bridges the synchronous SDK
     * callback to async JS via CompletableDeferred:
     *   1. Emit litert_tool_call event to JS with a unique callId and the raw args JSON string
     *   2. Block on a CompletableDeferred until JS calls respondToToolCall(callId, result)
     *   3. Return the result string to the SDK
     */
    private fun buildToolProviders(toolsJson: String): List<ToolProvider> {
        if (toolsJson.isBlank()) return emptyList()
        return try {
            val toolsArray = JsonParser.parseString(toolsJson).asJsonArray
            if (toolsArray.size() == 0) return emptyList()

            val providers = toolsArray.mapNotNull { element ->
                val wrapper = element.asJsonObject

                // JS sends OpenAI format: { type: "function", function: { name, description, parameters } }
                // LiteRT SDK expects the unwrapped OpenAPI object: { name, description, parameters }
                val funcObj = if (wrapper.has("function"))
                    wrapper.getAsJsonObject("function")
                else
                    wrapper

                val toolName = funcObj.get("name")?.asString ?: return@mapNotNull null

                // Build clean OpenAPI JSON for the SDK
                val openApiJson = com.google.gson.JsonObject().apply {
                    addProperty("name", toolName)
                    funcObj.get("description")?.let { addProperty("description", it.asString) }
                    funcObj.get("parameters")?.let { add("parameters", it) }
                }.toString()

                debugLog("tool schema — $toolName: $openApiJson")

                val openApiTool = object : OpenApiTool {
                    override fun getToolDescriptionJsonString(): String = openApiJson

                    override fun execute(argsJson: String): String {
                        val callId = UUID.randomUUID().toString()
                        val deferred = CompletableDeferred<String>()
                        pendingToolCalls[callId] = deferred

                        val eventJson = """{"id":"$callId","name":"$toolName","arguments":$argsJson}"""
                        debugLog("tool_call — callId=$callId name=$toolName argsLen=${argsJson.length}")
                        sendEvent(EVENT_TOOL_CALL, eventJson)

                        return try {
                            runBlocking { withTimeout(30_000L) { deferred.await() } }
                        } catch (e: TimeoutCancellationException) {
                            debugLog("tool_call timed out — callId=$callId name=$toolName")
                            pendingToolCalls.remove(callId)
                            "Error: Tool call timed out"
                        } catch (e: CancellationException) {
                            pendingToolCalls.remove(callId)
                            "Error: Tool call cancelled"
                        }
                    }
                }
                tool(openApiTool)
            }

            debugLog("buildToolProviders — registered ${providers.size} tools: [${toolsArray.mapNotNull { it.asJsonObject.getAsJsonObject("function")?.get("name")?.asString }.joinToString()}]")
            providers
        } catch (e: Exception) {
            debugLog("buildToolProviders — failed to parse toolsJson: ${e.message}")
            emptyList()
        }
    }

    private fun sendEvent(eventName: String, data: String) {
        try {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, data)
        } catch (e: Exception) {
            Log.w(TAG, "sendEvent — failed to emit $eventName: ${e.message}")
        }
    }

    private fun debugLog(msg: String) {
        Log.i(TAG, msg)
        sendEvent(EVENT_DEBUG_LOG, msg)
    }

    override fun onCatalystInstanceDestroy() {
        Log.i(TAG, "onCatalystInstanceDestroy — cleaning up")
        scope.cancel()
        runBlocking { cleanupEngine() }
        super.onCatalystInstanceDestroy()
    }
}
