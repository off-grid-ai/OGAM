# On-device diarization (sherpa-onnx) — integration guide

The whole app side is done and wired: the engine resolver (`speakerEngineFactory`) already prefers an
on-device sherpa engine (diarize + embed, one vector space) and falls back to the Mac offload, then to
per-segment identification. What remains is the native binding — the same JS contract on both platforms:

```
NativeModules.SherpaOnnxDiarization
  prepare({ id, segmentationUrl, embeddingUrl }) -> { ready }
  diarize({ audioPath, modelId })               -> { turns: [{ startMs, endMs, cluster, embedding }] }
  embed({ audioPath, modelId })                 -> { embedding: number[] }
```

Model bundle (from `@offgrid/models` DIARIZATION_MODELS): pyannote-segmentation-3.0 + a speaker
embedding, both ready ONNX from sherpa-onnx releases — `prepare` downloads + unpacks them.

## iOS
1. Podfile: `pod 'sherpa-onnx'` (or add the prebuilt xcframework from k2-fsa releases). `pod install`.
2. In `ios/OffgridMobile/SherpaDiarizationModule.swift`: `import SherpaOnnx`, replace the TODO blocks
   with the real wrapper calls (OfflineSpeakerDiarization + SpeakerEmbeddingExtractor), and add the
   WAV->[Float] reader (`SherpaAudio.readMono16k`) + downloader (`SherpaModelStore`).
3. Add `SherpaDiarizationModule.swift` + `.m` to the app target. Build.

## Android
1. `android/app/build.gradle`: add the sherpa-onnx AAR / prebuilt libs (arm64-v8a). Sync.
2. In `SherpaDiarizationModule.kt`: `import com.k2fsa.sherpa.onnx.*`, replace the TODO blocks, add
   `SherpaAudio.readMono16k` + `SherpaModelStore`.
3. Register `SherpaDiarizationPackage()` in `MainApplication`'s package list. Build.

## Verify
Enroll a voice (Manage Voices), record a Day session with 2+ speakers with the Mac unpaired — the
engine resolver picks the on-device sherpa engine, segments get named / "Speaker N" labels. Symbol
names track the sherpa-onnx version; verify against the one you install.
