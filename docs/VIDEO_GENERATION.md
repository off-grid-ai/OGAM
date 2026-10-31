# Video generation

## Current engine

Local generation uses stable-diffusion.cpp at the revision in
`scripts/video/revision`. Models uses the shared Hugging Face search, catalog,
and architecture-specific pack resolver. The catalog currently includes Wan 2.1,
Wan 2.2, LTX-2.3, LTX-2.5, and HunyuanVideo 1.5. Each pack must include every
required weight, encoder, VAE, and connector file. Catalog availability is not
proof that a model fits or has completed generation on a particular phone.

Video request validation and settings keys live in `@offgrid/models`. Mobile's
video generation service owns local and OGAD jobs, progress, cancellation,
recovery, and completed chat/gallery records. The native bridges share the C++
runtime lifecycle. Pro owns sync and model transfer through existing extension
points.

## Build setup

CocoaPods builds the pinned iOS framework during `pod install`. Gradle prepares the Android runtime before CMake configuration. Both paths reuse their build cache. For explicit setup, run from the mobile repository after installing JavaScript dependencies:

```sh
bash scripts/prepare-video-runtime.sh
OFFGRID_IOS_DEVICE_ONLY=1 bash scripts/build-video-ios.sh
(cd ios && pod install)
```

The command above builds the physical arm64 iPhone framework only. Pass
`OFFGRID_IOS_DEVICE_ONLY=1` to the physical Xcode build as well. Building requires
an Xcode SDK with the iOS 26 background task APIs. Deployment remains iOS 17.

For Android, install CMake, Make, Python 3, and the project's Android SDK/NDK:

```sh
bash scripts/prepare-video-runtime.sh --android
(cd android && ./gradlew assembleDebug)
```

Android preparation builds a pinned host shader compiler. The NDK compiler is
not sufficient for this engine's Vulkan shaders. Generated sources, libraries,
and compiler tools stay in `.video-build` and are not committed. The small
Vulkan patch uses the engine's dynamic dispatcher so linking remains compatible
with the app's Android API 24 minimum.

## Device limits and recovery

Model download does not guarantee that a device has enough memory to generate.
The residency manager checks the pack and clip size before loading. Default
clips are 320 × 192, 17 frames, at 8 FPS. Speed and peak memory still need manual
checks on physical iOS and Android devices.

On iOS 26, continued background GPU work requires OS support and admission.
If admission is not available, generation stops when the app enters the
background. Android uses a foreground service with a Stop action; an OS timeout
also cancels the job. Partial output is removed on failure or cancellation.

After restart, interrupted jobs appear with Retry. Local Retry restarts the
clip. Remote Retry uses the same OGAD job ID, so a lost connection does not start
a second job. Settings and model selection can change while a saved request
retains its resolved generation parameters.

Only OGAD remote video servers are supported. REST and MCP share OGAD's video
job owner. Model transfer sends and checks every file in the selected pack
before registration. Cancel and retry use the shared package transaction and
rollback. Local download resume preserves complete files; an incomplete file can
restart after process death.

## Integration audit (2026-09-29)

- Storage reads actual sizes for all installed video pack files, including old
  records whose catalog size is missing. Download completion stores actual sizes.
- Auto Configure includes video only when the native runtime, complete catalog
  pack, RAM minimum, and existing memory budget allow it. Models below these
  limits remain manually selectable; automatic setup does not use Run Anyway.
- iOS excludes downloaded/transferred video model folders from device backups,
  as it does for text and image models. SD image packs use `image_models` and its
  existing exclusion. Android disables app backup in its manifest. Generated
  videos and user content are not excluded by this model-cache policy.
- Remote video requires OGAD. Local and remote labels use the shared catalog,
  while model IDs and per-model settings keys remain unchanged.
- Native progress changes and background admission details enter the app debug
  log. A heartbeat alone is not proof that a sampling step advanced.

Source checks cover these integrations. Device checks for the latest backup
exclusion and Auto Configure changes remain pending. Complete video quality and
all-model coverage are not established by successful builds or partial sampling.
No automated tests were added or run for this audit.
