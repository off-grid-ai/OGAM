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

## Android — DONE (native, sherpa-onnx 1.13.8)
Implemented, mirroring iOS. One manual step: fetch the native blobs (not committed, like the iOS
xcframework):

```
scripts/fetch-sherpa-android.sh      # AAR -> android/app/libs, models -> android/app/src/main/assets/sherpa
```

Then just build. What's wired:
- `android/app/build.gradle`: `flatDir` repo over `libs/` + `implementation(name: 'sherpa-onnx-1.13.8', ext: 'aar')`; `noCompress 'onnx'`.
- `ai/offgridmobile/sherpa/`: `SherpaDiarizationModule` (real `com.k2fsa.sherpa.onnx` calls — `OfflineSpeakerDiarization.process` + `SpeakerEmbeddingExtractor.compute`), `SherpaAudio.readMono16k` (WAV→float), `SherpaModelStore` (copies bundled assets to filesDir; passes through a downloaded alternate embedding), `SherpaDiarizationPackage`.
- `MainApplication`: `add(SherpaDiarizationPackage())`.

The module is built with a null `AssetManager` + file paths, so the diarizer and the downloaded
alternate embedding load uniformly. Verify on a real arm64 device (see below). If a second dependency
also ships `libonnxruntime.so`, add a `packagingOptions { pickFirst '**/libonnxruntime.so' }`.

## Verify
Enroll a voice (Manage Voices), record a Day session with 2+ speakers with the Mac unpaired — the
engine resolver picks the on-device sherpa engine, segments get named / "Speaker N" labels. Symbol
names track the sherpa-onnx version; verify against the one you install.
