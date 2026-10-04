package ai.offgridmobile.sherpa

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.k2fsa.sherpa.onnx.FastClusteringConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerDiarization
import com.k2fsa.sherpa.onnx.OfflineSpeakerDiarizationConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerSegmentationModelConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerSegmentationPyannoteModelConfig
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractor
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractorConfig

/**
 * On-device speaker diarization + voiceprints via sherpa-onnx (Android). Mirrors the iOS module and the
 * JS contract (prepare/diarize/embed) — same sherpa-onnx 1.13.8 + same ONNX models (pyannote
 * segmentation + CAM++), so a voice recognized here sits in the same vector space as the iOS on-device
 * path and the Mac offload.
 *
 * Models are bundled in the app (assets/sherpa) and copied to filesDir; the native pipeline is
 * constructed with a null AssetManager and plain file paths, so a downloaded alternate embedding
 * (passed from JS as embeddingPath) drops straight in.
 */
class SherpaDiarizationModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "SherpaOnnxDiarization"

  private val sampleRate = 16000

  @ReactMethod
  fun prepare(model: ReadableMap, promise: Promise) {
    try {
      SherpaModelStore.ensure(
        reactContext,
        model.getString("id") ?: "",
        model.getString("segmentationUrl") ?: "",
        model.getString("embeddingUrl") ?: ""
      )
      promise.resolve(Arguments.createMap().apply { putBoolean("ready", true) })
    } catch (e: Exception) {
      promise.reject("sherpa_prepare_failed", e.message, e)
    }
  }

  @ReactMethod
  fun diarize(input: ReadableMap, promise: Promise) {
    try {
      val samples = SherpaAudio.readMono16k(input.getString("audioPath") ?: "")
      val segPath = SherpaModelStore.segmentationPath(reactContext)
      val embPath = SherpaModelStore.resolveEmbeddingPath(reactContext, input.getString("embeddingPath"))

      val config = OfflineSpeakerDiarizationConfig(
        segmentation = OfflineSpeakerSegmentationModelConfig(
          pyannote = OfflineSpeakerSegmentationPyannoteModelConfig(model = segPath)
        ),
        embedding = SpeakerEmbeddingExtractorConfig(model = embPath),
        clustering = FastClusteringConfig(numClusters = -1, threshold = 0.5f),
        minDurationOn = 0.3f,
        minDurationOff = 0.5f
      )
      val sd = OfflineSpeakerDiarization(config = config)
      val extractor = SpeakerEmbeddingExtractor(
        config = SpeakerEmbeddingExtractorConfig(model = embPath)
      )

      val turns: WritableArray = Arguments.createArray()
      try {
        val segments = sd.process(samples)
        for (s in segments.sortedBy { it.start }) {
          val s0 = (s.start * sampleRate).toInt().coerceIn(0, samples.size)
          val s1 = (s.end * sampleRate).toInt().coerceIn(0, samples.size)
          val embedding = Arguments.createArray()
          if (s1 - s0 >= sampleRate / 4) {
            val vec = embed(extractor, samples.copyOfRange(s0, s1))
            for (v in vec) embedding.pushDouble(v.toDouble())
          }
          turns.pushMap(Arguments.createMap().apply {
            putInt("startMs", (s.start * 1000).toInt())
            putInt("endMs", (s.end * 1000).toInt())
            putString("cluster", "spk${s.speaker}")
            putArray("embedding", embedding)
          })
        }
      } finally {
        sd.release()
        extractor.release()
      }
      promise.resolve(Arguments.createMap().apply { putArray("turns", turns) })
    } catch (e: Exception) {
      promise.reject("sherpa_diarize_failed", e.message, e)
    }
  }

  @ReactMethod
  fun embed(input: ReadableMap, promise: Promise) {
    try {
      val samples = SherpaAudio.readMono16k(input.getString("audioPath") ?: "")
      val embPath = SherpaModelStore.resolveEmbeddingPath(reactContext, input.getString("embeddingPath"))
      val extractor = SpeakerEmbeddingExtractor(
        config = SpeakerEmbeddingExtractorConfig(model = embPath)
      )
      val vec = try {
        embed(extractor, samples)
      } finally {
        extractor.release()
      }
      if (vec.isEmpty()) {
        promise.reject("sherpa_embed_failed", "no embedding produced", null)
        return
      }
      val embedding = Arguments.createArray()
      for (v in vec) embedding.pushDouble(v.toDouble())
      promise.resolve(Arguments.createMap().apply { putArray("embedding", embedding) })
    } catch (e: Exception) {
      promise.reject("sherpa_embed_failed", e.message, e)
    }
  }

  private fun embed(extractor: SpeakerEmbeddingExtractor, samples: FloatArray): FloatArray {
    val stream = extractor.createStream()
    stream.acceptWaveform(samples, sampleRate)
    stream.inputFinished()
    val vec = extractor.compute(stream)
    stream.release()
    return vec
  }
}
