package ai.offgridmobile.atlastts

import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.Locale

/**
 * Speaks text with the phone's own text-to-speech engine (works offline when the
 * engine's voice data is installed - Google TTS / Samsung TTS normally are).
 * Long text is split into chunks; "AtlasTtsDone" fires once the LAST chunk of an
 * utterance has finished, "AtlasTtsStopped" when speech is cancelled.
 */
class AtlasTtsModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    @Volatile private var tts: TextToSpeech? = null
    @Volatile private var ready = false
    @Volatile private var lastErrored = ""
    private var rate = 1.0f
    private var pitch = 1.0f
    private var voiceName = ""
    private val pending = mutableListOf<Triple<String, String, String>>()

    // ---- natural (neural) voices ----
    private val neural by lazy { NeuralTts { e, id -> emit(e, id) } }
    @Volatile private var neuralDir = ""
    @Volatile private var neuralSid = 0
    @Volatile private var voiceGen = 0
    /** Phone-call style output: play through the earpiece instead of the loudspeaker. */
    @Volatile private var earpiece = false

    private fun audioAttrs(): android.media.AudioAttributes = android.media.AudioAttributes.Builder()
        .setUsage(if (earpiece) android.media.AudioAttributes.USAGE_VOICE_COMMUNICATION else android.media.AudioAttributes.USAGE_MEDIA)
        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH).build()

    private fun routeAudio(on: Boolean) {
        val am = ctx.getSystemService(android.content.Context.AUDIO_SERVICE) as android.media.AudioManager
        if (on) {
            am.mode = android.media.AudioManager.MODE_IN_COMMUNICATION
            if (android.os.Build.VERSION.SDK_INT >= 31) {
                am.availableCommunicationDevices.firstOrNull { it.type == android.media.AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }?.let { am.setCommunicationDevice(it) }
            } else {
                @Suppress("DEPRECATION")
                am.isSpeakerphoneOn = false
            }
        } else {
            if (android.os.Build.VERSION.SDK_INT >= 31) am.clearCommunicationDevice()
            am.mode = android.media.AudioManager.MODE_NORMAL
        }
    }

    /** true = earpiece (hold the phone to your ear like a call), false = normal speaker / headphones. */
    @ReactMethod
    fun setEarpiece(on: Boolean, promise: Promise) {
        try {
            if (on == earpiece) { promise.resolve(true); return }
            earpiece = on
            neural.earpiece = on
            try { tts?.setAudioAttributes(audioAttrs()) } catch (_: Exception) {}
            routeAudio(on)
            promise.resolve(true)
        } catch (e: Exception) { promise.reject("AUDIO_ROUTE", e) }
    }
    /** synthesizeToFile jobs waiting for the engine: utterance id -> finished(ok). */
    private val fileJobs = java.util.concurrent.ConcurrentHashMap<String, (Boolean) -> Unit>()
    @Volatile private var fileCancel = false
    private val cancelled = java.util.Collections.synchronizedSet(mutableSetOf<String>())
    /** Where new voices are saved: the phone (default) or an SD card folder chosen in Settings. */
    @Volatile private var voicesBase = ""
    private fun voicesRoot() = (if (voicesBase.isNotBlank()) java.io.File(voicesBase, "voices") else java.io.File(ctx.filesDir, "voices")).apply { mkdirs() }
    private fun allVoiceRoots(): List<java.io.File> = listOfNotNull(java.io.File(ctx.filesDir, "voices"), if (voicesBase.isNotBlank()) java.io.File(voicesBase, "voices") else null).distinct()
    private fun findVoice(id: String): java.io.File? = allVoiceRoots().map { java.io.File(it, id) }.firstOrNull { it.isDirectory }

    @ReactMethod
    fun setVoicesBase(path: String, promise: Promise) { voicesBase = path; promise.resolve(true) }
    private fun useNeural(lang: String) = neuralDir.isNotEmpty() && neural.ready && (lang.isBlank() || lang.lowercase().startsWith("en"))

    override fun getName(): String = "AtlasTts"

    private fun emit(event: String, id: String) {
        try {
            val map = Arguments.createMap()
            map.putString("utteranceId", id)
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(event, map)
        } catch (_: Exception) {}
    }

    @Synchronized
    private fun ensure() {
        if (tts != null) return
        val holder = arrayOfNulls<TextToSpeech>(1)
        val early = arrayOfNulls<Int>(1)
        val e = TextToSpeech(ctx.applicationContext) { status ->
            val eng = synchronized(holder) { holder[0] ?: run { early[0] = status; null } }
            if (eng != null) onInit(eng, status)
        }
        tts = e
        val st = synchronized(holder) { holder[0] = e; early[0] }
        if (st != null) onInit(e, st) // the engine answered inside its constructor (e.g. no TTS engine installed)
    }

    private fun onInit(engine: TextToSpeech, status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            try { engine.language = Locale.getDefault() } catch (_: Exception) {}
            try { engine.setAudioAttributes(audioAttrs()) } catch (_: Exception) {}
            engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {
                    if (utteranceId != null && utteranceId.endsWith("#0")) emit("AtlasTtsStart", utteranceId.substringBefore("#"))
                }
                override fun onDone(utteranceId: String?) {
                    if (utteranceId != null && fileJobs.remove(utteranceId)?.invoke(true) != null) return
                    if (utteranceId != null && utteranceId.endsWith("#last")) emit("AtlasTtsDone", utteranceId.substringBefore("#"))
                }
                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) {
                    if (utteranceId != null && fileJobs.remove(utteranceId)?.invoke(false) != null) return
                    val id = utteranceId?.substringBefore("#") ?: return
                    if (id == lastErrored) return
                    lastErrored = id
                    try { engine.stop() } catch (_: Exception) {}
                    emit("AtlasTtsDone", id)
                }
                override fun onStop(utteranceId: String?, interrupted: Boolean) {
                    if (utteranceId != null && fileJobs.remove(utteranceId)?.invoke(false) != null) return
                    if (utteranceId != null) emit("AtlasTtsStopped", utteranceId.substringBefore("#"))
                }
            })
            synchronized(pending) {
                ready = true
                for ((text, id, lang) in pending) doSpeak(text, id, lang)
                pending.clear()
            }
        } else {
            synchronized(pending) {
                ready = false
                for ((_, id, _) in pending) emit("AtlasTtsDone", id)
                pending.clear()
                if (tts === engine) tts = null // try again next time instead of staying broken
            }
            try { engine.shutdown() } catch (_: Exception) {}
        }
    }

    private fun chunks(text: String, max: Int): List<String> = SpeechChunks.chunks(text, max)

    private fun doSpeak(text: String, id: String, lang: String = "") {
        val engine = tts ?: return
        engine.setSpeechRate(rate)
        engine.setPitch(pitch)
        try {
            val loc = if (lang.isBlank()) Locale.getDefault() else Locale.forLanguageTag(lang)
            val r = engine.setLanguage(loc)
            if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) emit("AtlasTtsNoLanguage", lang)
            if (voiceName.isNotBlank()) engine.voices?.firstOrNull { it.name == voiceName }?.let { engine.voice = it }
        } catch (_: Exception) {}
        val max = (TextToSpeech.getMaxSpeechInputLength() - 100).coerceAtLeast(500)
        val parts = chunks(text, max)
        if (parts.isEmpty()) { emit("AtlasTtsDone", id); return }
        engine.stop()
        parts.forEachIndexed { i, p ->
            val uid = if (i == parts.size - 1) "$id#last" else "$id#$i"
            val uidFirst = if (i == 0 && parts.size > 1) "$id#0" else uid
            engine.speak(p, TextToSpeech.QUEUE_ADD, Bundle(), uidFirst)
        }
    }

    @ReactMethod
    fun speak(text: String, utteranceId: String, promise: Promise) = speakIn(text, utteranceId, "", promise)

    /** Speak in a given language (BCP-47 tag like "es-ES"); "" = phone default. */
    @ReactMethod
    fun speakIn(text: String, utteranceId: String, lang: String, promise: Promise) {
        try {
            if (useNeural(lang)) {
                try { tts?.stop() } catch (_: Exception) {}
                val sid = if (voiceName.startsWith("sid:")) voiceName.removePrefix("sid:").toIntOrNull() ?: neuralSid else neuralSid
                // The first piece is one sentence, so the voice starts speaking sooner.
                val parts = SpeechChunks.speechParts(text, 380)
                if (parts.isEmpty()) emit("AtlasTtsDone", utteranceId) else neural.speak(parts, utteranceId, sid, rate)
                promise.resolve(true); return
            }
            ensure()
            val now = synchronized(pending) {
                if (tts == null) null else if (!ready) { pending.add(Triple(text, utteranceId, lang)); false } else true
            }
            if (now == null) { promise.reject("NO_TTS_ENGINE", "No text-to-speech engine is installed on this phone. Install Google Speech Services, or download a natural voice in Models > Voice."); return }
            if (now) doSpeak(text, utteranceId, lang)
            promise.resolve(true)
        } catch (e: Exception) { promise.reject("TTS_ERROR", e) }
    }

    private fun writeWav(file: java.io.File, pcm: ShortArray, rate: Int) {
        val data = pcm.size * 2
        val b = java.nio.ByteBuffer.allocate(44 + data).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        b.put("RIFF".toByteArray()); b.putInt(36 + data); b.put("WAVE".toByteArray())
        b.put("fmt ".toByteArray()); b.putInt(16); b.putShort(1); b.putShort(1); b.putInt(rate); b.putInt(rate * 2); b.putShort(2); b.putShort(16)
        b.put("data".toByteArray()); b.putInt(data)
        for (v in pcm) b.putShort(v)
        file.writeBytes(b.array())
    }

    /**
     * Saves the spoken text as a WAV file using the voice chosen in Settings (natural voice or the
     * phone's own), without playing it. Used by "Save as video". Resolves the file path.
     */
    @ReactMethod
    fun synthesizeToFile(text: String, outPath: String, lang: String, promise: Promise) {
        Thread {
            try {
                fileCancel = false
                val out = java.io.File(outPath)
                out.parentFile?.mkdirs()
                if (useNeural(lang)) {
                    val sid = if (voiceName.startsWith("sid:")) voiceName.removePrefix("sid:").toIntOrNull() ?: neuralSid else neuralSid
                    val r = neural.synthesize(chunks(text, 380), sid, rate) { fileCancel }
                    if (r == null) { if (fileCancel) promise.reject("CANCELLED", "Stopped") else promise.reject("NO_VOICE", "The natural voice is not loaded yet. Open Settings > Voice and try again."); return@Thread }
                    writeWav(out, r.first, r.second)
                    promise.resolve(out.path); return@Thread
                }
                ensure()
                val waitUntil = System.currentTimeMillis() + 8000
                while (!ready && tts != null && System.currentTimeMillis() < waitUntil) Thread.sleep(50)
                val engine = tts
                if (engine == null || !ready) { promise.reject("NO_TTS_ENGINE", "No text-to-speech engine is installed on this phone."); return@Thread }
                synchronized(engine) {
                    engine.setSpeechRate(rate)
                    engine.setPitch(1.0f)
                    try {
                        val loc = if (lang.isBlank()) Locale.getDefault() else Locale.forLanguageTag(lang)
                        engine.setLanguage(loc)
                        if (voiceName.isNotBlank() && !voiceName.startsWith("sid:")) engine.voices?.firstOrNull { it.name == voiceName }?.let { engine.voice = it }
                    } catch (_: Exception) {}
                }
                val parts = chunks(text, (TextToSpeech.getMaxSpeechInputLength() - 100).coerceAtLeast(500))
                if (parts.isEmpty()) { promise.reject("EMPTY", "Nothing to say"); return@Thread }
                // The engine writes one file per call; join the pieces into one WAV.
                val pieces = mutableListOf<java.io.File>()
                for ((i, part) in parts.withIndex()) {
                    if (fileCancel) { pieces.forEach { it.delete() }; promise.reject("CANCELLED", "Stopped"); return@Thread }
                    val piece = java.io.File(out.path + ".$i.part")
                    val id = "file~${System.nanoTime()}"
                    val latch = java.util.concurrent.CountDownLatch(1)
                    var ok = false
                    fileJobs[id] = { v -> ok = v; latch.countDown() }
                    val q = engine.synthesizeToFile(part, Bundle(), piece, id)
                    if (q != TextToSpeech.SUCCESS) { fileJobs.remove(id); pieces.forEach { it.delete() }; promise.reject("TTS_ERROR", "The voice engine refused the text"); return@Thread }
                    if (!latch.await(120, java.util.concurrent.TimeUnit.SECONDS)) { fileJobs.remove(id) }
                    pieces.add(piece)
                    if (!ok || piece.length() <= 44) { pieces.forEach { it.delete() }; promise.reject("TTS_ERROR", "The voice engine could not save the speech"); return@Thread }
                }
                if (pieces.size == 1) { pieces[0].renameTo(out) } else {
                    // Same engine, same format: keep the first header and append the others' samples.
                    val first = pieces[0].readBytes()
                    val all = java.io.ByteArrayOutputStream()
                    all.write(first)
                    for (k in 1 until pieces.size) { val b = pieces[k].readBytes(); all.write(b, 44, b.size - 44) }
                    val bytes = all.toByteArray()
                    val bb = java.nio.ByteBuffer.wrap(bytes).order(java.nio.ByteOrder.LITTLE_ENDIAN)
                    bb.putInt(4, bytes.size - 8); bb.putInt(40, bytes.size - 44)
                    out.writeBytes(bytes)
                    pieces.forEach { it.delete() }
                }
                promise.resolve(out.path)
            } catch (e: Throwable) { promise.reject("TTS_ERROR", e.message ?: e.toString()) }
        }.start()
    }

    /**
     * Speaks a reply while it is still being written (natural voice only; resolves false for the
     * phone's own voice, which cannot take text this way). Add sentences with speakStreamAppend and
     * finish with speakStreamEnd.
     */
    @ReactMethod
    fun speakStreamStart(utteranceId: String, promise: Promise) {
        try {
            if (!useNeural("")) { promise.resolve(false); return }
            try { tts?.stop() } catch (_: Exception) {}
            val sid = if (voiceName.startsWith("sid:")) voiceName.removePrefix("sid:").toIntOrNull() ?: neuralSid else neuralSid
            neural.speakStreamStart(utteranceId, sid, rate)
            promise.resolve(true)
        } catch (e: Exception) { promise.reject("TTS_ERROR", e) }
    }

    @ReactMethod
    fun speakStreamAppend(text: String, promise: Promise) {
        try { neural.speakStreamAppend(SpeechChunks.chunks(text, 380)); promise.resolve(true) }
        catch (e: Exception) { promise.reject("TTS_ERROR", e) }
    }

    @ReactMethod
    fun speakStreamEnd(promise: Promise) {
        try { neural.speakStreamEnd(); promise.resolve(true) } catch (e: Exception) { promise.reject("TTS_ERROR", e) }
    }

    @ReactMethod
    fun cancelSynthesis(promise: Promise) { fileCancel = true; promise.resolve(true) }

    @ReactMethod
    fun stop(promise: Promise) {
        try { synchronized(pending) { pending.clear() }; tts?.stop(); if (neuralDir.isNotEmpty()) neural.stop(); promise.resolve(true) } catch (e: Exception) { promise.reject("TTS_ERROR", e) }
    }

    @ReactMethod
    fun setRate(r: Double, promise: Promise) { rate = r.toFloat(); promise.resolve(true) }

    /** Installed (offline) voices for a language, e.g. "en". Network-only voices are left out. */
    @ReactMethod
    fun listVoices(lang: String, promise: Promise) {
        try {
            if (neuralDir.isNotEmpty() && neural.ready && (lang.isBlank() || lang.lowercase().startsWith("en"))) {
                val out = Arguments.createArray()
                val n = neural.numSpeakers()
                for (i in 0 until maxOf(1, n)) out.pushMap(Arguments.createMap().apply { putString("name", "sid:$i"); putString("locale", "en-US"); putInt("quality", 500) })
                promise.resolve(out); return
            }
            ensure()
            val engine = tts
            if (engine == null || !ready) { promise.resolve(Arguments.createArray()); return }
            val out = Arguments.createArray()
            val voices = try { engine.voices } catch (_: Exception) { null } ?: emptySet()
            voices.filter { v ->
                !v.isNetworkConnectionRequired &&
                !(v.features?.contains(android.speech.tts.TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) ?: false) &&
                (lang.isBlank() || v.locale.language.equals(Locale.forLanguageTag(lang).language, ignoreCase = true))
            }.sortedBy { it.name }.forEach { v ->
                out.pushMap(Arguments.createMap().apply {
                    putString("name", v.name); putString("locale", v.locale.toLanguageTag()); putInt("quality", v.quality)
                })
            }
            promise.resolve(out)
        } catch (e: Exception) { promise.reject("TTS_VOICES", e) }
    }

    /** Use a specific voice by name for the next utterances ("" = default voice). */
    @ReactMethod
    fun setVoice(name: String, promise: Promise) { voiceName = name; promise.resolve(true) }

    /** Voice pitch (1.0 normal). Used to give the two podcast hosts different voices. */
    @ReactMethod
    fun setPitch(p: Double, promise: Promise) { pitch = p.toFloat(); promise.resolve(true) }

    @ReactMethod
    fun warmUp(promise: Promise) { try { ensure(); promise.resolve(true) } catch (e: Exception) { promise.reject("TTS_ERROR", e) } }

    @ReactMethod
    fun isSpeaking(promise: Promise) { promise.resolve(tts?.isSpeaking ?: false) }

    /**
     * Use a downloaded natural voice (folder name under voices/), or "" for the phone's voice.
     * `style` may hold `accent` ("gb"/"us": pronunciation dictionary of multi-accent Kokoro) and
     * `depth` (1 = as recorded, lower = deeper). Resolves the number of speakers.
     */
    @ReactMethod
    fun setNeuralVoice(id: String, sid: Int, style: ReadableMap?, promise: Promise) {
        neuralSid = sid
        val accent = if (style?.hasKey("accent") == true) style.getString("accent") ?: "" else ""
        neural.depth = if (style?.hasKey("depth") == true) style.getDouble("depth").toFloat() else 1f
        val g = ++voiceGen
        if (id.isBlank()) { neuralDir = ""; neural.releaseAsync(); promise.resolve(0); return }
        val dir = findVoice(id)
        if (dir == null) { neuralDir = ""; promise.reject("NO_VOICE", "Voice not downloaded (if it was on an SD card, put the card back)"); return }
        Thread {
            try {
                neural.load(dir.path, accent)
                if (g == voiceGen) { neuralDir = dir.path; promise.resolve(neural.numSpeakers()) }
                else promise.resolve(0) // a newer choice was made while this one loaded
            } catch (e: Throwable) { if (g == voiceGen) neuralDir = ""; promise.reject("VOICE_LOAD", e.message ?: e.toString()) }
        }.start()
    }

    @ReactMethod
    fun setNeuralSpeaker(sid: Int, promise: Promise) { neuralSid = sid; promise.resolve(true) }

    @ReactMethod
    fun installedNeuralVoices(promise: Promise) {
        val out = Arguments.createArray()
        allVoiceRoots().flatMap { r -> r.listFiles()?.toList() ?: emptyList() }.filter { it.isDirectory && !it.name.endsWith(".part") }.distinctBy { it.name }.forEach { d ->
            out.pushMap(Arguments.createMap().apply { putString("id", d.name); putDouble("bytes", d.walkTopDown().filter { it.isFile }.sumOf { it.length() }.toDouble()) })
        }
        promise.resolve(out)
    }

    @ReactMethod
    fun deleteNeuralVoice(id: String, promise: Promise) {
        if (id.isBlank() || id.contains('/') || id.contains("..")) { promise.reject("BAD_ID", "Invalid voice"); return }
        Thread {
            val d = findVoice(id) ?: java.io.File(voicesRoot(), id)
            if (d.path == neuralDir) { neuralDir = ""; try { neural.release() } catch (_: Throwable) {} }
            else if (d.path == neural.loadedDir) { try { neural.release() } catch (_: Throwable) {} }
            d.deleteRecursively(); promise.resolve(true)
        }.start()
    }

    @ReactMethod
    fun cancelNeuralDownload(id: String, promise: Promise) { cancelled.add(id); promise.resolve(true) }

    /** Downloads a voice .zip and unpacks it into voices/<id> while downloading. Emits AtlasVoiceDownload {id, progress}. */
    @ReactMethod
    fun downloadNeuralVoice(id: String, url: String, promise: Promise) {
        cancelled.remove(id)
        Thread {
            try {
                val dest = ModelPack.download(url, voicesRoot(), id, { cancelled.contains(id) }) { p -> progress(id, p) }
                promise.resolve(dest.path)
            } catch (e: Throwable) {
                promise.reject("VOICE_DOWNLOAD", if (cancelled.contains(id)) "cancelled" else (e.message ?: e.toString()))
            }
        }.start()
    }

    /**
     * Imports a voice file the user downloaded (a sherpa-onnx .tar.bz2 or .zip of a Piper/VITS,
     * Kokoro or KittenTTS voice). Unpacks it into voices/<id>, checks it is a voice Atlas can
     * play, and resolves the new id.
     */
    @ReactMethod
    fun importNeuralVoice(uri: String, name: String, promise: Promise) {
        Thread {
            val id = VoiceImport.idFor(name)
            val root = voicesRoot()
            val tmp = java.io.File(root, "$id.part")
            try {
                tmp.deleteRecursively(); tmp.mkdirs()
                val input = ctx.contentResolver.openInputStream(android.net.Uri.parse(uri))
                    ?: throw IllegalStateException("Could not open the file")
                input.use { VoiceImport.unpack(it, tmp) }
                val kids = tmp.listFiles() ?: emptyArray()
                val src = if (kids.size == 1 && kids[0].isDirectory) kids[0] else tmp
                VoiceImport.problem(src)?.let { throw IllegalArgumentException(it) }
                val dest = java.io.File(root, id)
                if (dest.path == neuralDir || dest.path == neural.loadedDir) { neuralDir = ""; try { neural.release() } catch (_: Throwable) {} }
                dest.deleteRecursively()
                if (!src.renameTo(dest)) throw IllegalStateException("Could not move voice files")
                tmp.deleteRecursively()
                promise.resolve(id)
            } catch (e: Throwable) {
                tmp.deleteRecursively()
                promise.reject("VOICE_IMPORT", e.message ?: e.toString())
            }
        }.start()
    }

    private fun progress(id: String, p: Double) {
        try {
            val m = Arguments.createMap(); m.putString("id", id); m.putDouble("progress", p)
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("AtlasVoiceDownload", m)
        } catch (_: Exception) {}
    }

    /** Keep the screen on (used while learning mode runs, so Android does not pause the app). */
    @ReactMethod
    fun keepScreenOn(on: Boolean, promise: Promise) {
        val activity = ctx.currentActivity
        if (activity == null) { promise.resolve(false); return }
        activity.runOnUiThread {
            if (on) activity.window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else activity.window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        promise.resolve(true)
    }

    // Required by NativeEventEmitter on Android.
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    override fun invalidate() {
        try { if (earpiece) routeAudio(false) } catch (_: Exception) {}
        try { tts?.stop(); tts?.shutdown() } catch (_: Exception) {}
        tts = null
        try { neural.shutdown() } catch (_: Throwable) {}
        super.invalidate()
    }
}
