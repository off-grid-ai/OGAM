# Hardware Acceleration Strategy: all accelerators, all modalities (RN mobile + Electron desktop)

**Status:** proposal / architecture reference (evidence-verified)
**Owner:** mobile + desktop
**Scope:** how the two Off Grid AI consumer apps - **Off Grid Mobile (React Native)** and **Off Grid Desktop (Electron/Node)** - run every modality (embedding, text, vision, image-gen, STT, TTS) on every class of on-device accelerator (CPU / GPU / NPU / TPU), by routing across on-device runtimes behind one shared seam. The seam is common; the engine bindings differ per platform (RN bindings on mobile, sibling Node bindings on desktop) and are chosen as capability-data, not forked code.

Related: `ARCHITECTURE.md`, `GPU-ACCELERATION-INVESTIGATION.md`, `LITERT_TODO.md`, `CODEX_HTP_LLAMA_FIX.md`, `TTS_ENGINE_INTERFACE.md`.

---

## 1. Goal

**Whatever accelerator a user's device exposes, the app should already be using it for every modality we ship, and support the widest possible set of models, with zero configuration by the user.**

**Why this exists:** the only goal is the best possible experience for the Off Grid AI consumer - faster, cooler, longer-battery on-device AI - across our two consumer products, Off Grid Desktop and Off Grid Mobile. This is **plumbing in service of that experience**, nothing more. We are not building an inference engine, a model-conversion pipeline, or a general-purpose SDK for other developers, and we are not entering the runtime business. We reuse existing, maintained on-device runtimes and route across them under the hood; the value we own is the thin routing + capability layer inside our own apps. **This is a cross-platform plan: mobile (React Native) and desktop (Electron) share one routing layer and differ only in engine bindings.** The two breadth engines map 1:1 across platforms via sibling bindings, so the same model files flow to both (Section 4a).

---

## 2. Two hard gates every option must pass

1. **React Native binding is mandatory.** Our app is React Native. A runtime with no RN binding (native-only, Python, C++) is disqualified as a primary path regardless of how good it is. This single gate eliminates the strongest-looking "does everything" competitor (see Section 9).
2. **Only shipping capabilities count, not roadmap.** "The underlying engine supports backend X" does not mean "the RN wrapper exposes backend X today." We verified this per-runtime with primary sources (Section 9) because it is exactly where the strategy would otherwise be built on sand.

---

## 3. Five truths that shape the design

These are load-bearing and evidence-verified. The architecture follows from them.

1. **GGUF is a CPU/GPU format. It cannot run on the NPU/TPU.** GGUF (llama.cpp) has no shipping mobile NPU backend; the HTP/QNN path is experimental and is disabled in our codebase. Since we support GGUF widely today (via llama.rn) and want to "horizontally support the most models," this defines two separate axes that **cannot be satisfied by the same model file**:
   - **Axis A - model breadth (horizontal):** GGUF via llama.rn. Enormous zoo, any quant, any text/VLM model on Hugging Face. Runs **CPU + GPU only.** We already max this out.
   - **Axis B - hardware depth (NPU/TPU):** requires a *different, pre-converted format per vendor* (`.tflite` + QNN context-binary on Android, CoreML `.mlpackage`/`.pte` on iOS). Narrow: only models someone already converted for that silicon.
   You cannot get both for one model without a conversion pipeline (ruled out). This lines up perfectly: the modality that needs the widest breadth (text) is exactly the one where GGUF-on-GPU is already correct and the NPU is irrelevant.

2. **NPUs/TPUs win big on fixed-shape models and poorly on LLM text.** NPUs are built for static, dense, ahead-of-time-compiled graphs: embeddings, vision (CNN/ViT), STT (Whisper encoder), TTS vocoders, diffusion UNets. There the NPU is ~10x over GPU and up to ~9x more power-efficient. Autoregressive LLM decode is dynamic-shape and memory-bandwidth-bound; NPUs are worse at it (re-compiling a graph per prompt length can cost seconds). **Therefore LLM text stays on the GPU (GGUF/llama.rn); the NPU push is for the other five modalities.**

3. **"TPU" on a consumer device is an NPU-class accelerator reached through a vendor-specific path, and until recently the Pixel one was closed to third parties.** The "TPU" in a Pixel (Google Tensor), the NPU in a Snapdragon (Hexagon), and the Apple Neural Engine are all NPU-class accelerators. Apple opened the ANE to third parties in 2017 (CoreML); Qualcomm exposes Hexagon via QNN. The Pixel TPU was historically reserved for Google's own features + Gemini Nano/AICore, and Android's cross-vendor path (NNAPI) was deprecated in Android 15. As of 2026 there is finally a third-party path - the **Google Tensor ML SDK (Beta), integrated with LiteRT** - but it is **Pixel 10 family only** (older Tensor G2/G3/G4 remain closed), Beta/access-gated, and requires per-model TPU compilation. So on-device "TPU" folds into the NPU strategy: reached via the Tensor delegate under LiteRT where available (Pixel 10), otherwise GPU/CPU fallback. The datacenter Cloud TPU (what vLLM targets) is a different thing and enters only as an optional remote/bring-your-own-server tier (Section 8).

4. **Accelerator selection happens at model-export time and NPU landing is best-effort at runtime - so we must measure, never assume.** The backend is baked into the artifact (a CoreML `.pte`, a QNN `.tflite`). At runtime, dispatch is opportunistic: CoreML decides ANE-vs-GPU-vs-CPU itself (no API to force ANE; FP16-only), and QNN delegates only the ops it supports (64 of 72 canonical models fully delegate; the rest partially fall back to CPU; operator support even differs across Snapdragon generations). **The router must record whether execution actually landed on the NPU (telemetry), not assume it did.**

5. **The decision belongs behind an abstraction, never in a caller.** No screen, store, or hook may branch on `Platform.OS`, `engine === 'litert'`, or a capability flag to decide *how* to run something. A single capability + routing service decides once; callers dispatch an intent. Genuine gaps (a modality that reaches the NPU on iOS but only CPU on Android) are modelled as capability-as-data (like the existing `DownloadCapabilities` pattern), not scattered `if (ios)` branches. We already prove this pattern in TTS (`EngineRegistry<TTSEngine>`), image-gen (`localDreamGeneratorService`), and remote LLMs (`LLMProvider` registry). The one modality that skipped it is local text (callers branch on `model.engine`); closing that is Phase 1.

---

## 4. The runtime set (all React-Native-bindable, all verified)

| Runtime | RN binding | Role | Accelerators actually reached (verified) |
|---|---|---|---|
| **llama.rn** (llama.cpp) | yes (in app) | **text/VLM breadth engine (GGUF)** | CPU, GPU (Metal iOS / OpenCL Android). No NPU (GGUF is CPU/GPU-only by nature). |
| **onnxruntime-react-native** (ONNX Runtime) | yes (MS, MIT, JSI/New-Arch, iOS 15.1+, v1.24.3) | **fixed-shape breadth engine (ONNX) + cross-platform NPU** | CPU; **iOS ANE via CoreML EP (drop-in)**; **Android Hexagon via QNN EP (config-flag rebuild + per-SoC binaries)**. Widest fixed-shape zoo. |
| **LiteRT** (TFLite) | yes (in app, `cpu/gpu/npu` backend) | **fixed-shape NPU (alt/wired), image-gen-adjacent** | CPU; GPU (Adreno/Metal); **ANE via CoreML delegate (iOS); Hexagon via QNN delegate (Android)** |
| **whisper.rn** (GGML) | yes (in app) | STT (CPU/GPU fallback) | CPU, GPU |
| **CoreML** (direct) | yes (in app) | image-gen (iOS) | GPU, **ANE** |
| **LocalDream** | yes (in app) | image-gen (Android) | MNN (GPU), **QNN (Hexagon NPU)** |
| **TTS EngineRegistry** | yes (in app, Pro) | TTS orchestration over engines below | CPU, GPU, ANE (via Kokoro/executorch) |
| **react-native-executorch** (ExecuTorch) | **yes - ALREADY in app (`^0.8.1`), powers Kokoro TTS** | iOS ANE for fixed-shape (extend to embed/STT/vision) | **iOS: CoreML->ANE (opportunistic, proven via Kokoro).** **Android: XNNPACK/CPU only - NOT an NPU path (verified, Section 9).** |
| **vLLM** (remote) | n/a (server) | optional BYO-server tier | Cloud TPU / GPU |

**Ground truth - what is already wired (verified in code, 2026-07-06):**
- **llama.rn** = text/VLM (GGUF) **and** the OuteTTS + Qwen3 TTS engines (`pro/audio/engine/tts/engines/{outetts,qwen3}` run on llama.rn). CPU/GPU.
- **react-native-executorch `^0.8.1`** = **already a dependency**, powering **Kokoro TTS** (`pro/audio/engine/tts/engines/kokoro`, `useTextToSpeech` + `KOKORO_MEDIUM`). On iOS this already routes through CoreML (ANE-capable). Its embeddings/STT/vision hooks exist in the package but are not yet imported - extending to them is a small lift, iOS-NPU-only.
- **whisper.rn** = STT. **CoreMLDiffusionModule.swift** (iOS) + **LocalDreamModule.kt** (Android) = image-gen. The `ONNXImageModel` type / `onnxImageGeneratorService` name refers to the source model *format*; the runtimes are CoreML/LocalDream, **not** ONNX Runtime.
- **onnxruntime-react-native is NOT in the app** - it is the one net-new engine this plan proposes, for fixed-shape breadth + the Android Hexagon path executorch cannot provide.

**Two breadth engines, verified as the spine:**
- **GGUF via llama.rn** = text/VLM breadth (CPU/GPU). Widest text zoo. NPU N/A and unneeded.
- **ONNX via onnxruntime-react-native** = fixed-shape breadth (embedding/vision/STT/TTS) with the widest fixed-shape zoo (MiniLM, BGE, Whisper, Kokoro, Piper, vision) AND a real cross-platform NPU path: **iOS ANE is drop-in** (CoreML EP compiled unconditionally); **Android Hexagon is real but heavy** (QNN EP behind a native-rebuild flag + per-SoC context binaries).

**Key correction from research:** the cross-platform fixed-shape NPU path is **ONNX Runtime and/or LiteRT** (both reach ANE on iOS and Hexagon on Android). `react-native-executorch` reaches the NPU on **iOS only** (Android is CPU-only, verified), so it is a tactical iOS supplement, never the Android NPU path.

---

## 4a. Cross-platform: one router, platform adapters (RN mobile + Electron desktop)

The two breadth engines are also the two most cross-platform engines that exist, mapping 1:1 across mobile and desktop via sibling bindings (verified):

| Engine family | Mobile (React Native) | Desktop (Electron/Node) | Shared model files |
|---|---|---|---|
| **GGUF / llama.cpp** | `llama.rn` *(in app)* | `node-llama-cpp` (Metal/CUDA/Vulkan, prebuilt, Electron-supported) | identical `.gguf` |
| **ONNX / ONNX Runtime** | `onnxruntime-react-native` | `onnxruntime-node` (macOS CoreML->ANE; Windows DirectML+WebGPU, Copilot+ NPU; Linux CUDA/TensorRT) | identical `.onnx` / `.ort` |

**Architecture:**
- **Shared, once:** an `@offgrid/inference-router` package (per the monorepo `@offgrid/*` philosophy) owning the pure capability-detection + selection logic + the modality API. Consumed by both apps.
- **Platform adapters behind one interface:** mobile calls the RN bindings; desktop calls the Node bindings. Adding a platform = a new adapter, zero router changes.
- **Backends as capability-data:** mobile NPU = ANE / Hexagon / Pixel-Tensor; desktop = ANE (mac), DirectML + Copilot+ NPU (Windows), CUDA (Linux/NVIDIA). Desktop leans GPU far harder for text (big VRAM); mobile leans NPU for fixed-shape (battery). Same router, different data.
- **Desktop caveat (to-verify, not assumed):** `onnxruntime-node`'s GPU/NPU execution providers have reported packaging quirks inside Electron - the desktop ONNX-on-NPU path gets the same "prototype before commit" treatment as mobile Hexagon.

## 5. The capability matrix (the showcase)

Legend: **primary** path in bold; *(exists)* already wired; `+add` new adoption; `CPU-only` = no NPU artifact/path, honest fallback.

### iOS (Apple Silicon A/M: NPU = Apple Neural Engine; no separate TPU)

| Modality | CPU | GPU (Metal) | NPU (ANE) |
|---|---|---|---|
| **Embedding** | ONNX / llama.rn | llama.rn | **ONNX CoreML EP -> ANE** `+add` (drop-in) / LiteRT alt |
| **Text (LLM/VLM)** | llama.rn *(exists)* | **llama.rn Metal** *(exists)* | not used (truth #2) |
| **Vision** | ONNX / LiteRT | LiteRT (Metal) | **ONNX CoreML EP -> ANE** `+add` / LiteRT CoreML `+add` |
| **Image generation** | CoreML CPU | CoreML GPU *(exists)* | **CoreML -> ANE** *(exists, `preferGpu=false`)* |
| **STT (Whisper)** | whisper.rn *(exists)* | whisper.rn Metal *(exists)* | **executorch Whisper CoreML -> ANE** `+extend` / ONNX CoreML EP alt |
| **TTS (Kokoro / Oute / Qwen3)** | llama.rn (Oute/Qwen3) *(exists)* | TTS registry | **Kokoro -> executorch CoreML -> ANE** *(exists)* |

### Android (Snapdragon / MediaTek / Tensor / Exynos: NPU = Hexagon etc.; "TPU" = Pixel Tensor, via Tensor ML SDK on Pixel 10)

| Modality | CPU | GPU | NPU (Hexagon / MediaTek) | TPU (Tensor) |
|---|---|---|---|---|
| **Embedding** | llama.rn / LiteRT | LiteRT (Adreno) | **LiteRT QNN -> Hexagon** *(exists, verify model)* | Pixel 10 · Tensor SDK (Beta)* |
| **Text (LLM/VLM)** | llama.rn *(exists)* | **llama.rn OpenCL** *(exists)* | not used (truth #2) | not used |
| **Vision** | LiteRT *(exists)* | LiteRT (Adreno) *(exists)* | **LiteRT QNN -> Hexagon** *(exists)* | Pixel 10 · Tensor SDK (Beta)* |
| **Image generation** | LocalDream CPU | **LocalDream MNN (GPU)** *(exists)* | **LocalDream QNN -> Hexagon** *(exists)* | Pixel 10 · Tensor SDK (Beta)* |
| **STT (Whisper)** | whisper.rn *(exists)* | whisper.rn | **ONNX Whisper QNN EP -> Hexagon** `+add` (heavy) / LiteRT QNN alt — else `CPU-only` | Pixel 10 · Tensor SDK (Beta)* |
| **TTS (Kokoro/Oute/Qwen3)** | Kokoro=executorch, Oute/Qwen3=llama.rn *(exists)* | TTS registry | **ONNX Kokoro/Piper QNN EP -> Hexagon** `+add` (heavy) — else `CPU-only` (executorch/llama.rn) | Pixel 10 · Tensor SDK (Beta)* |

\* **Google Tensor "TPU" (updated 2026):** now reachable by third parties via the **Google Tensor ML SDK (Beta), integrated with LiteRT** - but **Pixel 10 family only** (older Tensor G2/G3/G4 remain closed), Beta/access-gated, with per-model TPU compilation + Play Feature Delivery / AI Packs plumbing. Modelled as a **Tensor delegate under the LiteRT adapter**, alongside the QNN (Hexagon) delegate - same capability-as-data and same "measure it landed" telemetry. Same risk/effort profile as the Android Hexagon workstream; shares its plumbing. Fall back to GPU/CPU on all other Pixels/devices. We do not claim coverage beyond what a device actually exposes.

**Note the honest asymmetry, modelled as data:** STT/TTS reach the ANE on iOS (executorch/ONNX CoreML) but on Android reach Hexagon only if a QNN export + per-SoC context binary exists, otherwise they stay on CPU/GPU. This is a capability flag per (modality, platform), not a leaked branch.

### 5a. Completeness verdict - "will all of it be solved?"

Honest answer: **CPU and GPU - yes, all six modalities, both platforms. NPU - yes for the five fixed-shape modalities where a converted model + (on Android) a per-SoC binary exists; text-on-NPU is a deliberate never. TPU - folded into NPU, best-effort.** Precisely:

| | CPU | GPU | NPU | TPU |
|---|---|---|---|---|
| **Embedding** | ✅ | ✅ | ✅ iOS ANE (drop-in) · ⚠️ Android Hexagon (heavy) | ⚠️ Pixel 10 only (Tensor SDK Beta) |
| **Text/VLM** | ✅ | ✅ | ❌ **by design** (NPU doesn't help LLM decode) | ❌ by design |
| **Vision** | ✅ | ✅ | ✅ iOS ANE · ⚠️ Android Hexagon (heavy) | ⚠️ Pixel 10 only (Tensor SDK Beta) |
| **Image-gen** | ✅ | ✅ *(wired)* | ✅ iOS ANE *(wired)* · ✅ Android Hexagon *(LocalDream QNN, wired)* | ⚠️ Pixel 10 only (Tensor SDK Beta) |
| **STT** | ✅ *(wired)* | ✅ *(wired)* | ✅ iOS ANE · ⚠️ Android Hexagon (heavy) | ⚠️ Pixel 10 only (Tensor SDK Beta) |
| **TTS** | ✅ *(wired)* | ✅ | ✅ iOS ANE *(Kokoro/executorch, wired)* · ⚠️ Android Hexagon (heavy) | ⚠️ Pixel 10 only (Tensor SDK Beta) |

Legend: ✅ solved · ⚠️ conditional (needs a converted/per-SoC model, or a delegate that exposes it) · ❌ not applicable by design. "heavy" = requires a native-rebuild flag + per-SoC QNN context binary (inherent to Qualcomm QNN, affects any runtime).

So: **not literally every cell is a free win, and that is the honest truth.** The universal floor (CPU) and GPU are fully covered. The NPU is covered for exactly the modalities where it physically wins, gated only by model availability - which is precisely why ONNX is added (widest fixed-shape zoo). The single hard "no" (text-on-NPU) is correct, not a gap.

---

## 6. The central architectural fork (decided)

Grounded in what is already wired (executorch powers Kokoro TTS; llama.rn powers text + OuteTTS/Qwen3; whisper.rn STT; CoreML/LocalDream image-gen), the fixed-shape-NPU options are:

- **react-native-executorch (already in app).** iOS ANE only - Android is CPU (QNN not compiled in, no models, not on roadmap; verified Section 9). Great for the **iOS ANE** win, useless for Android NPU.
- **LiteRT (already in app, `cpu/gpu/npu`).** Reaches ANE (iOS CoreML delegate) and Hexagon (Android QNN delegate); official Google+Qualcomm path (64/72 canonical models NPU-delegated). TFLite format - narrower zoo.
- **ONNX Runtime / onnxruntime-react-native (net-new).** Reaches ANE (iOS CoreML EP, drop-in) and Hexagon (Android QNN EP, heavy: rebuild flag + per-SoC binary). **Widest fixed-shape zoo** (MiniLM, BGE, Whisper, Kokoro, Piper, vision) - the reason to add it.

**Decision (multiple adapters behind one router, chosen per modality/device/model-availability):**
- **iOS ANE:** use **executorch** where a model is already wired or in its zoo (Kokoro TTS is done); use **ONNX CoreML EP** for the rest (embeddings/STT/vision) - both drop-in.
- **Android Hexagon:** **ONNX QNN EP** is primary (widest zoo incl. Kokoro/Piper/Whisper), **LiteRT QNN** the alternative where a `.tflite` exists. Both need per-SoC context binaries (inherent to QNN). Where neither exists -> honest CPU/GPU fallback (executorch/whisper.rn/llama.rn).
- **Text/VLM:** stays **llama.rn/GGUF/GPU** (widest text zoo; NPU N/A).
- **Image-gen:** stays **CoreML (iOS ANE) + LocalDream-QNN (Android Hexagon)** - already wired.

ONNX Runtime is the one net-new engine; it earns its place as the **fixed-shape breadth engine** (mirroring GGUF's role for text) and the widest Android-Hexagon path.

---

## 6a. Prior art - who has solved this, and the gap (field survey)

We surveyed the field (consumer apps, engines, mobile SDKs) before committing. Findings, cited to primary sources:

**No consumer local-AI app delivers general NPU acceleration today.** LM Studio, Ollama, Jan, GPT4All, koboldcpp, Msty, LocalAI are all **GPU+CPU only** (Metal/CUDA/Vulkan/ROCm/SYCL). For LLM decode the NPU is often *slower* (memory-bandwidth-bound; a Surface Pro 11 ran an LLM ~10x slower on NPU than CPU). Research converges on **hybrid** (GPU decode + NPU-assisted prefill), never NPU-only. This directly validates our call: **text on GPU; NPU only for curated fixed-shape models.**

**No one ships "all modalities + all silicon incl. NPU + cross-platform" as one open thing.** Closest: Cactus (RN + multimodal shape, but own *closed* kernels, source-available-restricted license - free only under $2M funding AND revenue - NPU = ANE-prefill on a few flagships, no image-gen) and LiteRT-Next (real cross-silicon NPU, Apache-2.0, but **no first-party RN binding**). Neither is both. MLX = GPU+CPU, maintainer confirms **no ANE ever**. MediaPipe LLM = GPU+CPU, now maintenance-only. Nexa's `nexa-sdk` now redirects to `qualcomm/GenieX` (Qualcomm-only); its meta-router is closed + no-RN.

**The two consistent gaps (our opportunity):**
1. **NPU-from-React-Native is the universal hole.** Real NPU lives in native runtimes (LiteRT-QNN, ORT-QNN, ExecuTorch-QNN) but no mature RN binding surfaces it easily. From RN today the practical ceiling is **GPU everywhere + ANE via CoreML on iOS**; genuine Android NPU means opting into the heavy QNN path.
2. **Nobody routes across engines on-device.** The market ships single-runtime multi-backend engines; the meta-router (one contract, adapters over multiple runtimes, dispatch per modality+hardware) is genuinely unoccupied. Nexa's is the nearest analog and it's closed + no-RN.

**The canonical engineering pattern to copy (from ONNX Runtime EPs, LiteRT delegates, ggml-backend, MNN, OpenVINO, Windows ML):** a **registry of capability-declaring backends**, **priority/policy-ordered partitioning**, and a **guaranteed-complete CPU fallback**. Two rules everyone learned the hard way, adopted into Section 7: *make the fallback loud* and *bind hardware behind one interface the caller never sees the concretes of*. The mature APIs converge on **policy-based selection** (ORT `SetEpSelectionPolicy(PREFER_NPU / MAX_EFFICIENCY)`, LiteRT `CompiledModel(Accelerator.NPU, GPU)`, OpenVINO `AUTO`) - a declared *intent* the engine resolves against live device inventory. MNN has the broadest mobile-NPU-across-vendors + multimodal story but needs a hand-written native module (no RN binding) - a fallback option if the ONNX/LiteRT paths stall.

## 7. Routing and capability detection (the layer we own)

The router is the only place that knows about concrete runtimes and silicon.

- **Startup capability detection, cached as data:** SoC/GPU/NPU availability + RAM tier, once. Android: detect Snapdragon (QNN) vs MediaTek vs Tensor vs none; iOS: ANE assumed on supported devices.
- **Pure selection function:** `route(modality, deviceCapabilities, availableArtifacts) -> { runtime, backend, artifact }`. Zero-IO, unit-testable, single source of truth for "how to run X here." Never duplicated into a caller.
- **Capability-as-data, not branches:** each runtime adapter declares its modalities, backends, cancel-ability, memory cost, and per-(modality,platform) NPU reach as data. UI renders from the data.
- **Measure NPU landing (from truth #4):** record real outcomes per (SoC, model, backend) -> tokens/s, latency, thermals, and whether it actually delegated to NPU vs fell back. The router then prefers the empirically best path per device class. This telemetry is the only asset that compounds under a reuse-only strategy, and it is free (we run the models anyway).
- **Uniform adapter interface:** every runtime wrapped in `load / run / release / capabilities` so adding one is additive (OCP) and callers never change. Closing the local-text gap (llama.rn + LiteRT getting the same adapter shape the TTS engines already have) is Phase 1.

---

**Three design rules adopted from the field survey (Section 6a) - the patterns everyone converged on or got burned by:**
1. **Callers declare intent/policy; the router resolves it against live devices.** Model each engine behind one capability-queried interface; callers pass an ordered preference or a policy (`PREFER_NPU`, `MAX_EFFICIENCY`), never branch on a concrete engine (matches ORT `SetEpSelectionPolicy` / LiteRT `Accelerator` list / OpenVINO `AUTO`, and our own DIP rule).
2. **Make fallback loud, never silent.** A guaranteed-complete CPU backend is the terminal fallback, but every fall-back off the NPU/GPU is logged, surfaced in state, and testable. Silent CPU spill is the field's #1 footgun (ORT partition-boundary thrash, TFLite hard-erroring instead of falling back).
3. **Separate coarse placement from fine per-op dispatch, both in one owning service.** ggml is the reference: `n_gpu_layers` (coarse offload policy) is distinct from the scheduler's per-op assignment, and the coarse decision feeds the fine one. The router owns both (residency/offload + per-request dispatch); the reactive store is a thin read-only projection of what the router chose - never the decider.

## 8. Cloud TPU / bring-your-own-server (optional, not on-device)

The existing remote `LLMProvider` registry already models this. A self-hosted vLLM server on Cloud TPU or a GPU box exposes an OpenAI-compatible endpoint; we add it as one more provider. This is the only place vLLM / Cloud TPU appears. No new abstraction, just a provider entry.

---

## 9. Evidence log (why the disqualifications are airtight)

**react-native-executorch - Android NPU is NOT a shipping path (primary-source verified, v0.9.2, 2026-06-17):**
- FAQ: Android acceleration is Vulkan-only and *"often inferior to XNNPACK ... most of the models use XNNPACK"* (CPU). No QNN/Hexagon mention.
- Their GPU/NPU tracking issue #556 backend matrix has three columns - XNNPACK, CoreML, Vulkan - **no QNN column**.
- PR #1028 (build Android with Qualcomm backend) was **closed unmerged** ("experimental ... I'm closing this PR").
- Android native `CMakeLists.txt` links no Qualcomm/QNN/Hexagon library; `grep -ril qnn|qualcomm|hexagon` over the Android tree = 0 files.
- `qnn` is a dead string in the `Backend` TS enum; platform default on Android is XNNPACK; no model accessor accepts `qnn`.
- HF zoo (65 repos): every LLM/embedding/TTS is XNNPACK; Whisper + a few vision ship CoreML; **zero `qnn/` exports anywhere**.
- iOS CoreML/ANE is real but opportunistic (compute-units=all, FP16, no force-ANE knob; Whisper can land on GPU not ANE).
- Verdict: adopt for **iOS ANE only**; it is not an Android NPU path.

**NexaSDK - disqualified by the RN gate:** no React Native binding (native Kotlin/Swift/Python/C++ only); its GenieX NPU runtime is Qualcomm-exclusive with no Apple Neural Engine. Despite being the closest "does-everything, routes-to-best-backend" product (now under Qualcomm), it cannot be a primary path for an RN app.

**Cactus - benchmark reference only:** has an RN SDK and iOS ANE via CoreML, but **Android NPU is not yet implemented** and it has no image generation. Good to benchmark llama.rn/LiteRT against; not a foundation.

**LiteRT QNN - the strong Android path (verified):** official Google+Qualcomm accelerator, graduated to production, GA targeted Google I/O May 2026; benchmarked on 72 canonical vision/audio/NLP models, 64 fully NPU-delegated, ~100x over CPU / ~10x over GPU. Requires per-SoC vendor context binaries (fragmentation -> capability-as-data). TFLite format, not GGUF.

**onnxruntime-react-native - verified from the shipping 1.24.3 tarball:** JSI/New-Arch, iOS 15.1+, runs `.onnx` and `.ort`. **iOS: `USE_COREML` compiled unconditionally -> `coreml` EP exposed in JS with `onlyEnableDeviceWithANE` -> real drop-in ANE path.** **Android: default is CPU + NNAPI; QNN EP is off by default -> enabling it needs `onnxruntimeUseQnn:"true"` (native rebuild, pulls `onnxruntime-android-qnn` AAR from Maven Central, disables NNAPI) PLUS per-SoC precompiled QNN context binaries (`ctx.onnx`) or a slow first-load compile.** The `qnn`/`coreml` EPs are typed and dispatched in the shipping binding; Android QNN is a Microsoft-supported flag, not a fork - but "custom build + per-SoC assets," and not independently battle-tested via the RN package end-to-end (prototype-verify on a real Snapdragon before committing Android-NPU to it). ONNX zoo is the widest fixed-shape source (MiniLM/BGE embeddings, Whisper, Kokoro/Piper TTS, vision).

**Google Tensor ML SDK - the Pixel TPU path (verified 2026):** graduated from Experimental Access to **Beta**, integrated with LiteRT; convert/compile PyTorch or TFLite models to Tensor-optimized binaries, 100+ precompiled models (incl. Gemma 3 1B). **Pixel 10 family only** (Pixel 10 / 10 Pro / 10 Pro XL / Fold); older Tensor G2/G3/G4 have no third-party TPU access (open, unfulfilled request). Delivery via Play Feature Delivery (TPU driver/compiler libs) + AI Packs (compiled models). Historically the Pixel TPU was reserved for Google's own features + Gemini Nano/AICore - this is the first real third-party door, and it is narrow + Beta. Fits our plan as a Tensor delegate under the LiteRT adapter.

**Already-wired ground truth (verified in code):** `react-native-executorch@^0.8.1` powers Kokoro TTS (iOS CoreML/ANE-capable); llama.rn powers text + OuteTTS + Qwen3 TTS; whisper.rn = STT; CoreMLDiffusionModule (iOS) + LocalDreamModule (Android) = image-gen. `onnxruntime-react-native` is NOT present (the one net-new engine). OuteTTS is llama.rn, not ONNX.

---

## 10. Honest limitations

- **NPU coverage is bounded by upstream exports.** No conversion pipeline means NPU coverage = the intersection of what upstream already exported to `.tflite`-QNN / CoreML. Popular fixed-shape models (Whisper, embeddings, common vision): covered. Long tail: CPU/GPU fallback. Accepted.
- **GGUF stays CPU/GPU by nature.** Our widest model breadth (text/VLM) does not get NPU - and does not need it (truth #2).
- **ANE and QNN are best-effort.** Models can silently fall back off the NPU; we detect this via telemetry rather than assuming the win.
- **Android NPU is fragmented and per-SoC.** Snapdragon vs MediaTek vs Tensor, and even Snapdragon generations, differ in operator support. Modelled as data, not branches.
- **Tensor "TPU" is Pixel 10 + Beta only.** Reachable via the Tensor ML SDK (Beta) under LiteRT, but only on the Pixel 10 family (older Pixels remain closed) and with per-model compilation. Real but narrow; we route to it where exposed and fall back otherwise.
- **Binary size grows per runtime.** Ship only the backends we route to; stream models on demand.
- **LLM on NPU is out of scope on purpose.** Research frontier, not a shippable win. Text stays GGUF-on-GPU.

---

## 11. Phased adoption (each additive, behind the router, device-verified, rippable)

1. **Foundation.** Build the Backend Router + Capability Service + uniform adapter interface. Wrap existing runtimes (llama.rn, LiteRT, whisper.rn, CoreML/LocalDream, TTS registry) in the adapter shape. No behaviour change; closes the local-text abstraction gap; gives every modality one entry point. Contract tests for the router guard both platforms at once.
2. **First NPU win, iOS-first (cheapest): embeddings + vision on ANE.** iOS is a drop-in via executorch (already in app) or ONNX CoreML EP - no rebuild. Route embeddings + vision to ANE, capture NPU-landing telemetry, Provit journey per modality as the regression guard. Kokoro TTS already proves the iOS-ANE path.
3. **Add ONNX Runtime as the fixed-shape breadth engine + Android NPU prototype.** Wire `onnxruntime-react-native` behind the router (iOS CoreML EP first). Then prototype the vendor-NPU paths on real devices to de-risk them before committing STT/embeddings: the Android QNN EP flag on a Snapdragon (rebuild + one per-SoC `ctx.onnx`), and - since it shares this plumbing - the **Tensor ML SDK (Beta) delegate under LiteRT on a Pixel 10**. Both are "heavy, prove-on-one-device-first"; fall back to CPU/GPU everywhere else.
4. **Image-gen through the router.** Move the CoreML/LocalDream NPU-vs-GPU choice out of UI flags and behind the router as a capability decision. No new runtime.
5. **Telemetry-driven routing.** Turn on per-device outcome logging; router prefers the empirically best path per SoC class (also catches NPU fall-backs).
6. **Optional remote tier.** Add self-hosted vLLM (Cloud TPU/GPU) as an `LLMProvider`.

---

## 12. One-paragraph summary

We are a React Native app, so every runtime must have an RN binding - which disqualifies NexaSDK outright and relegates Cactus to a benchmark. We support the most models horizontally with **two breadth engines**: **GGUF via llama.rn** for text/VLM on CPU/GPU (widest text zoo; also runs OuteTTS + Qwen3 TTS today; NPU does not help LLM decode), and **ONNX via onnxruntime-react-native** for the fixed-shape modalities (widest fixed-shape zoo: embeddings, Whisper, Kokoro, Piper, vision). NPU/TPU depth is added only for the fixed-shape five, reached through adapters behind one router: on iOS the ANE is a **drop-in** (executorch - already wired for Kokoro TTS - and ONNX CoreML EP, both verified); on Android the Hexagon NPU is **real but heavy** (ONNX QNN EP or LiteRT QNN, each needing a native-rebuild flag + a per-SoC context binary - inherent to Qualcomm QNN, not a runtime quirk), with honest CPU/GPU fallback where no per-SoC binary exists. Image-gen stays on the already-wired CoreML (iOS ANE) + LocalDream-QNN (Android Hexagon). "TPU" on device folds into the NPU strategy - the Pixel Tensor TPU is now reachable via the Tensor ML SDK (Beta) under LiteRT, but only on the Pixel 10 family, so it is a narrow Tensor-delegate that shares the heavy Android-NPU plumbing; Cloud TPU is an optional remote tier via the existing provider registry. The router selects the runtime per (modality, device) from capability-data and **measures** whether execution actually landed on the NPU rather than assuming it - because ANE and QNN dispatch are best-effort. Completeness is honest (Section 5a): CPU + GPU solved for all six modalities; NPU solved for the fixed-shape five wherever a converted model exists; text-on-NPU is a deliberate never. We build no conversion pipeline and no external SDK, so NPU coverage is bounded by upstream exports - the accepted price of reuse - and the only asset that compounds is the on-device routing telemetry, collected for free.
