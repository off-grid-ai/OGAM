import Foundation
import React

/**
 * On-device speaker diarization + voiceprints via sherpa-onnx (iOS). Implements the JS contract used by
 * sherpaDiarizerFactory / sherpaEmbedderFactory: prepare(model) downloads+unpacks the ONNX bundle;
 * diarize(audioPath) returns speaker turns; embed(audioPath) returns one voiceprint.
 *
 * INTEGRATION (see docs/SHERPA_ONDEVICE.md):
 *   1. Add sherpa-onnx to the Podfile (pod 'sherpa-onnx') or the prebuilt xcframework, then
 *      `import SherpaOnnx` below and replace the TODO calls with the real wrapper API. The exact
 *      symbol names track the sherpa-onnx version — verify against the installed one.
 *   2. Add this file + the .m to the app target and build. Until then it is not compiled.
 *
 * Audio in = mono 16 kHz Float samples (decode the WAV with AVAudioFile/AVAudioConverter).
 */
@objc(SherpaOnnxDiarization)
class SherpaDiarizationModule: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { false }

  // MARK: - prepare: ensure the bundle's model files are on disk
  @objc(prepare:resolver:rejecter:)
  func prepare(_ model: NSDictionary,
               resolver resolve: @escaping RCTPromiseResolveBlock,
               rejecter reject: @escaping RCTPromiseRejectBlock) {
    Task {
      do {
        _ = try await SherpaModelStore.ensure(
          id: model["id"] as? String ?? "",
          segmentationUrl: model["segmentationUrl"] as? String ?? "",
          embeddingUrl: model["embeddingUrl"] as? String ?? ""
        )
        resolve(["ready": true])
      } catch {
        reject("sherpa_prepare_failed", error.localizedDescription, error)
      }
    }
  }

  // MARK: - diarize: whole recording -> speaker turns (+ voiceprint per turn)
  @objc(diarize:resolver:rejecter:)
  func diarize(_ input: NSDictionary,
               resolver resolve: @escaping RCTPromiseResolveBlock,
               rejecter reject: @escaping RCTPromiseRejectBlock) {
    Task {
      do {
        let audioPath = input["audioPath"] as? String ?? ""
        let modelId = input["modelId"] as? String ?? ""
        let samples = try SherpaAudio.readMono16k(audioPath)   // [Float]
        let paths = try SherpaModelStore.paths(for: modelId)

        // TODO(sherpa): construct the wrappers with `paths.segmentation` / `paths.embedding`
        //   let diar = SherpaOnnxOfflineSpeakerDiarizationWrapper(config: ...)
        //   let segments = diar.process(samples: samples)  // [(start, end, speaker)]
        //   let extractor = SherpaOnnxSpeakerEmbeddingExtractorWrapper(config: ...)
        //   for each segment: embedding = extractor.compute(samples[segmentRange])
        // Map to the JS turn shape:
        let turns: [[String: Any]] = []  // replace with mapped segments
        resolve(["turns": turns])
      } catch {
        reject("sherpa_diarize_failed", error.localizedDescription, error)
      }
    }
  }

  // MARK: - embed: one clip -> one voiceprint (enrollment)
  @objc(embed:resolver:rejecter:)
  func embed(_ input: NSDictionary,
             resolver resolve: @escaping RCTPromiseResolveBlock,
             rejecter reject: @escaping RCTPromiseRejectBlock) {
    Task {
      do {
        let audioPath = input["audioPath"] as? String ?? ""
        let samples = try SherpaAudio.readMono16k(audioPath)
        // TODO(sherpa): let embedding = extractor.compute(samples)
        let embedding: [Float] = []  // replace with extractor output
        resolve(["embedding": embedding])
      } catch {
        reject("sherpa_embed_failed", error.localizedDescription, error)
      }
    }
  }
}
