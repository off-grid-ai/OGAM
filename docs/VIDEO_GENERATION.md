# Video generation

## Current engine

Local generation uses stable-diffusion.cpp at the revision in
`scripts/video/revision`. The first supported architecture is Wan 2.1 T2V 1.3B.
A complete pack has the diffusion weight, Wan VAE, and UMT5 text encoder. Models
uses the shared Hugging Face search and pack resolver. LTX and Hunyuan catalog
entries state that this build does not support them.

Video request validation and settings keys live in `@offgrid/models`. Mobile's
video generation service owns local and OGAD jobs, progress, cancellation,
recovery, and completed chat/gallery records. The native bridges share the C++
runtime lifecycle. Pro owns sync and model transfer through existing extension
points.

## Build setup

Run from the mobile repository after installing JavaScript dependencies:

```sh
bash scripts/prepare-video-runtime.sh
bash scripts/build-video-ios.sh
(cd ios && pod install)
```

The iOS framework includes arm64 device and arm64 simulator slices. Use an Apple
Silicon simulator. Building requires an Xcode SDK with the iOS 26 background task
APIs. Deployment remains iOS 17; older iOS versions run video in the foreground.

For Android, install CMake, Ninja, Python 3, and the project's Android SDK/NDK:

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
job owner. Model transfer sends and checks all three pack files before
registration. Tests have not been added or run for this implementation; manual
verification comes first.
