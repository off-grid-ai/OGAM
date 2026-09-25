import Foundation
import React

/**
 * On-device speaker diarization + voiceprints via sherpa-onnx (iOS). Implements the JS contract used by
 * sherpaDiarizerFactory / sherpaEmbedderFactory: prepare/diarize/embed. Models (pyannote segmentation +
 * CAM++ embedding) are bundled in the app for now; diarization + fbank + clustering all run in
 * sherpa-onnx's tested native code, so recognition matches the Mac-offload path — but fully on-device.
 */
@objc(SherpaOnnxDiarization)
class SherpaDiarizationModule: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { false }

  private let sampleRate = 16000

  private func segPath() -> String? { Bundle.main.path(forResource: "segmentation", ofType: "onnx") }
  private func embPath() -> String? { Bundle.main.path(forResource: "embedding", ofType: "onnx") }

  /// Resolve the embedding model: a downloaded file passed from JS if it exists, else the bundled default.
  private func resolveEmb(_ input: NSDictionary) -> String? {
    if let p = input["embeddingPath"] as? String {
      let c = clean(p)
      if FileManager.default.fileExists(atPath: c) { return c }
    }
    return embPath()
  }

  private func clean(_ path: String) -> String {
    return path.hasPrefix("file://") ? String(path.dropFirst(7)) : path
  }

  private func readSamples(_ path: String) -> [Float]? {
    let w = SherpaOnnxWaveWrapper.readWave(filename: clean(path))
    let s = w.samples
    return s.isEmpty ? nil : s
  }

  private func makeExtractor(_ emb: String?) -> SherpaOnnxSpeakerEmbeddingExtractorWrapper? {
    guard let emb = emb else { return nil }
    var cfg = sherpaOnnxSpeakerEmbeddingExtractorConfig(model: emb)
    return withUnsafePointer(to: &cfg) { SherpaOnnxSpeakerEmbeddingExtractorWrapper(config: $0) }
  }

  private func embed(_ ext: SherpaOnnxSpeakerEmbeddingExtractorWrapper, _ samples: [Float]) -> [Float] {
    let stream = ext.createStream()
    stream.acceptWaveform(samples: samples, sampleRate: sampleRate)
    stream.inputFinished()
    return ext.compute(stream: stream)
  }

  // MARK: - prepare
  @objc(prepare:resolver:rejecter:)
  func prepare(_ model: NSDictionary,
               resolver resolve: @escaping RCTPromiseResolveBlock,
               rejecter reject: @escaping RCTPromiseRejectBlock) {
    if segPath() != nil && embPath() != nil {
      resolve(["ready": true])
    } else {
      reject("sherpa_models_missing", "bundled sherpa models not found", nil)
    }
  }

  // MARK: - diarize (whole recording -> turns, each with a voiceprint)
  @objc(diarize:resolver:rejecter:)
  func diarize(_ input: NSDictionary,
               resolver resolve: @escaping RCTPromiseResolveBlock,
               rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      guard let path = input["audioPath"] as? String,
            let seg = self.segPath(), let emb = self.resolveEmb(input) else {
        reject("sherpa_diarize_failed", "missing audio or models", nil); return
      }
      guard let samples = self.readSamples(path) else {
        reject("sherpa_diarize_failed", "could not read audio", nil); return
      }
      var pyannote = sherpaOnnxOfflineSpeakerSegmentationPyannoteModelConfig(model: seg)
      var segCfg = sherpaOnnxOfflineSpeakerSegmentationModelConfig(pyannote: pyannote)
      var embCfg = sherpaOnnxSpeakerEmbeddingExtractorConfig(model: emb)
      var clustering = sherpaOnnxFastClusteringConfig(numClusters: -1, threshold: 0.5)
      var config = sherpaOnnxOfflineSpeakerDiarizationConfig(
        segmentation: segCfg, embedding: embCfg, clustering: clustering,
        minDurationOn: 0.3, minDurationOff: 0.5)
      let sd = withUnsafePointer(to: &config) {
        SherpaOnnxOfflineSpeakerDiarizationWrapper(config: $0)
      }
      let segments = sd.process(samples: samples)
      let ext = self.makeExtractor(emb)

      var turns: [[String: Any]] = []
      for s in segments {
        let s0 = max(0, Int(s.start * Float(self.sampleRate)))
        let s1 = min(samples.count, Int(s.end * Float(self.sampleRate)))
        var embedding: [Float] = []
        if let ext = ext, s1 - s0 >= self.sampleRate / 4 {
          embedding = self.embed(ext, Array(samples[s0..<s1]))
        }
        turns.append([
          "startMs": Int(s.start * 1000),
          "endMs": Int(s.end * 1000),
          "cluster": "spk\(s.speaker)",
          "embedding": embedding,
        ])
      }
      _ = pyannote; _ = segCfg; _ = embCfg; _ = clustering  // keep configs alive through process()
      resolve(["turns": turns])
    }
  }

  // MARK: - embed (one clip -> one voiceprint)
  @objc(embed:resolver:rejecter:)
  func embed(_ input: NSDictionary,
             resolver resolve: @escaping RCTPromiseResolveBlock,
             rejecter reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      guard let path = input["audioPath"] as? String,
            let samples = self.readSamples(path), let ext = self.makeExtractor(self.resolveEmb(input)) else {
        reject("sherpa_embed_failed", "missing audio or models", nil); return
      }
      let e = self.embed(ext, samples)
      if e.isEmpty { reject("sherpa_embed_failed", "no embedding produced", nil); return }
      resolve(["embedding": e])
    }
  }
}
