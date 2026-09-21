package ai.offgridmobile.sherpa

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.Arguments

/**
 * On-device speaker diarization + voiceprints via sherpa-onnx (Android). Mirrors the iOS module and the
 * JS contract (prepare/diarize/embed) so react-native-sherpa is unnecessary.
 *
 * INTEGRATION (see docs/SHERPA_ONDEVICE.md):
 *   1. Add sherpa-onnx to android/app/build.gradle (the k2-fsa AAR / prebuilt .so for arm64-v8a), then
 *      import com.k2fsa.sherpa.onnx.* and replace the TODO calls with the real API — verify symbol
 *      names against the installed version.
 *   2. Register SherpaDiarizationPackage() in MainApplication's package list. Until then it is unused.
 *
 * Audio in = mono 16 kHz FloatArray (decode the WAV with MediaExtractor/AudioTrack or a small reader).
 */
class SherpaDiarizationModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "SherpaOnnxDiarization"

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
      // TODO(sherpa): OfflineSpeakerDiarization(config).process(samples) -> segments {start,end,speaker}
      //   + SpeakerEmbeddingExtractor(config).compute(samples[range]) per segment.
      val turns = Arguments.createArray() // replace with mapped segments {startMs,endMs,cluster,embedding}
      promise.resolve(Arguments.createMap().apply { putArray("turns", turns) })
    } catch (e: Exception) {
      promise.reject("sherpa_diarize_failed", e.message, e)
    }
  }

  @ReactMethod
  fun embed(input: ReadableMap, promise: Promise) {
    try {
      val samples = SherpaAudio.readMono16k(input.getString("audioPath") ?: "")
      // TODO(sherpa): val embedding = SpeakerEmbeddingExtractor(config).compute(samples)
      val embedding = Arguments.createArray()
      promise.resolve(Arguments.createMap().apply { putArray("embedding", embedding) })
    } catch (e: Exception) {
      promise.reject("sherpa_embed_failed", e.message, e)
    }
  }
}
