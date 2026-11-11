package ai.offgridmobile.atlastts

import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.k2fsa.sherpa.onnx.FastClusteringConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerDiarization
import com.k2fsa.sherpa.onnx.OfflineSpeakerDiarizationConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerSegmentationModelConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerSegmentationPyannoteModelConfig
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractorConfig
import com.k2fsa.sherpa.onnx.WaveReader
import java.io.File

/**
 * Speaker labels for recordings, on the phone (sherpa-onnx speaker diarization: pyannote
 * segmentation + a speaker-embedding model, downloaded once as "atlas-speakers").
 * Emits AtlasSpeakersProgress {progress} while downloading or labelling.
 */
class AtlasSpeakersModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    override fun getName() = "AtlasSpeakers"

    @Volatile private var cancelled = false

    private fun root() = File(ctx.filesDir, "speaker-models").apply { mkdirs() }
    private fun dir() = File(root(), PACK)

    @ReactMethod
    fun modelsReady(promise: Promise) { promise.resolve(SpeakerLabels.modelsIn(dir()) != null) }

    @ReactMethod
    fun downloadModels(url: String, promise: Promise) {
        cancelled = false
        Thread {
            try {
                ModelPack.download(url, root(), PACK, { cancelled }) { p -> progress(p) }
                if (SpeakerLabels.modelsIn(dir()) == null) throw IllegalStateException("The speaker-label download is incomplete")
                promise.resolve(true)
            } catch (e: Throwable) { promise.reject("SPEAKERS_DOWNLOAD", if (cancelled) "cancelled" else (e.message ?: e.toString())) }
        }.start()
    }

    @ReactMethod
    fun cancel(promise: Promise) { cancelled = true; promise.resolve(true) }

    /**
     * Finds who spoke when in a recording. `speakers` is the number of people if the user
     * knows it, or 0 to let Atlas decide. Resolves [{start, end, speaker}] in seconds.
     */
    @ReactMethod
    fun diarize(wavPath: String, speakers: Int, promise: Promise) {
        cancelled = false
        Thread {
            var sd: OfflineSpeakerDiarization? = null
            try {
                val models = SpeakerLabels.modelsIn(dir()) ?: throw IllegalStateException("Download the speaker-label models first")
                val threads = Runtime.getRuntime().availableProcessors().coerceIn(2, 4)
                val config = OfflineSpeakerDiarizationConfig(
                    segmentation = OfflineSpeakerSegmentationModelConfig(
                        pyannote = OfflineSpeakerSegmentationPyannoteModelConfig(models.first.path), numThreads = threads),
                    embedding = SpeakerEmbeddingExtractorConfig(models.second.path, numThreads = threads),
                    clustering = FastClusteringConfig(numClusters = if (speakers > 0) speakers else -1, threshold = SpeakerLabels.THRESHOLD),
                    minDurationOn = 0.3f, minDurationOff = 0.5f,
                )
                sd = OfflineSpeakerDiarization(null, config)
                val wave = WaveReader.readWave(wavPath.removePrefix("file://"))
                val samples = SpeakerLabels.resample(wave.samples, wave.sampleRate, sd.sampleRate())
                val segs = sd.processWithCallback(samples, { done: Int, total: Int, _: Long ->
                    if (total > 0) progress(done.toDouble() / total)
                    if (cancelled) 1 else 0
                }, 0L)
                if (cancelled) throw InterruptedException("cancelled")
                val out = Arguments.createArray()
                segs.sortedBy { it.start }.forEach { s ->
                    out.pushMap(Arguments.createMap().apply {
                        putDouble("start", s.start.toDouble()); putDouble("end", s.end.toDouble()); putInt("speaker", s.speaker)
                    })
                }
                promise.resolve(out)
            } catch (e: Throwable) {
                promise.reject("SPEAKERS", if (cancelled) "cancelled" else (e.message ?: e.toString()))
            } finally { try { sd?.release() } catch (_: Throwable) {} }
        }.start()
    }

    /**
     * Turns an audio or video file (a content:// or file path) into a 16 kHz mono WAV at
     * `outPath`, for transcription and speaker labels. Resolves the length in seconds.
     */
    @ReactMethod
    fun decodeToWav(source: String, outPath: String, promise: Promise) {
        cancelled = false
        Thread {
            try {
                val uri = if (source.startsWith("/")) Uri.fromFile(File(source)) else Uri.parse(source)
                val seconds = AudioDecoder.decode(ctx, uri, File(outPath.removePrefix("file://")), { cancelled }) { p -> progress(p) }
                promise.resolve(seconds)
            } catch (e: Throwable) {
                promise.reject("DECODE", if (cancelled) "cancelled" else (e.message ?: e.toString()))
            }
        }.start()
    }

    private fun progress(p: Double) {
        try {
            val m = Arguments.createMap(); m.putDouble("progress", p)
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("AtlasSpeakersProgress", m)
        } catch (_: Exception) {}
    }

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    companion object { const val PACK = "atlas-speakers" }
}

/** Pure helpers for speaker labelling (unit-tested on the JVM). */
object SpeakerLabels {
    /** Cosine-distance threshold for "a new speaker" when the number of people is not given. */
    const val THRESHOLD = 0.5f

    /** The segmentation and embedding models in a downloaded pack, or null when missing. */
    fun modelsIn(dir: File): Pair<File, File>? {
        val seg = File(dir, "segmentation.onnx")
        val emb = File(dir, "embedding.onnx")
        return if (seg.isFile && emb.isFile) Pair(seg, emb) else null
    }

    /** Linear resampling to the model's rate (recordings are already 16 kHz, so usually a no-op). */
    fun resample(x: FloatArray, from: Int, to: Int): FloatArray {
        if (from == to || from <= 0 || x.isEmpty()) return x
        val n = (x.size.toLong() * to / from).toInt()
        return FloatArray(n) { i ->
            val pos = i.toDouble() * from / to
            val k = pos.toInt().coerceAtMost(x.size - 1)
            val f = (pos - k).toFloat()
            if (k + 1 < x.size) x[k] * (1 - f) + x[k + 1] * f else x[k]
        }
    }
}
