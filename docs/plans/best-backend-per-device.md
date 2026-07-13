# Auto-default to best hardware per device

Status: **plan only — not built** (assessment requested 2026-07-06).

## Goal
A naive user gets the best-performing inference backend for their device automatically
(no Settings dive), with a safe fallback and the ability to override. Optimise the
out-of-box TTFT/throughput experience.

## Current state (seam map)
| Concern | Where | Today |
|---|---|---|
| SoC/NPU detection | `src/services/hardware.ts:308` `getSoCInfo()` | JS heuristics: chip allowlist (`FLAGSHIP_8GEN2/1`), `DeviceInfo.getHardware()`; `hasNPU` true only for Qualcomm w/ qnnVariant |
| GPU capability | `src/services/hardware.ts:436` `getOpenCLCapability()` | returns `{supported, reason}` (qcom/mali) |
| Text default | `src/stores/appStore.ts:187` `DEFAULT_SETTINGS` | **static**: iOS=Metal, **Android=CPU** |
| LiteRT default | `src/stores/appStore.ts:200` | `'gpu'` |
| Backend→engine | `src/services/llm.ts:175`, `src/services/llmHelpers.ts:58` | maps `inferenceBackend`→`n_gpu_layers`/`devices` |
| LiteRT native | `android/.../litert/LiteRTModule.kt:162` | already falls back NPU→GPU→CPU |
| HTP compile gate | `node_modules/llama.rn/.../CMakeLists.txt:147` | **compiled OUT** unless Hexagon SDK present |
| Backend UI | `src/screens/ModelSettingsScreen/TextGenerationAdvanced.tsx:18` | `HTP_UI_ENABLED = false` |

**The gap that matters:** Android defaults to **CPU even on capable GPUs** (e.g. a
Snapdragon 8 Gen 2 with a good Adreno). iOS is already optimal (Metal).

## Proposed architecture (capability-as-data + pure resolver)
Follows SOLID/DIP + platform-abstraction rules — no `Platform.OS`-mechanism branches in callers.

1. **`HardwareCapabilities` (data)** — one typed object, computed once at boot, cached:
   ```
   { platform,
     gpu: { supported, kind: 'metal' | 'adreno' | 'mali' | null },
     npu: { supported, variant },
     compiledBackends: Set<'cpu' | 'metal' | 'opencl' | 'htp'>,  // what's actually in THIS build
     ramTier }
   ```
   `compiledBackends` is read at runtime so we never default to a backend the APK
   doesn't contain (the "Hexagon SDK not found → CPU-only build" trap).

2. **`resolveBestBackend(caps, modality): InferenceBackend | LiteRTBackend`** — pure,
   unit-testable, single source of truth:
   - iOS → `metal`
   - Android text: `htp` if `compiledBackends.has('htp') && npu.supported`; else `opencl`
     if `gpu.supported`; else `cpu`
   - LiteRT: `npu`→`gpu`→`cpu` by the same caps
   - One contract test guards both platforms.

3. **Apply as the DEFAULT, not a forced value** — in `appStore` init / `migratePersistedState`:
   seed `inferenceBackend`/`liteRTBackend`/`enableGpu` from the resolver **only when the
   user has not chosen** (a `backendAutoSelected` flag). User override always wins; the
   inline backend selector stays.

4. **Safe fallback stays** — llama.rn's GPU→CPU→smaller-ctx and LiteRT's native chain
   remain the net; the resolver only improves the *starting* choice.

## Honest constraints
- **"Best capability" != "best TTFT".** GPU/NPU helps throughput but can add first-load
  compile/upload latency (NPU warm-up especially). Heuristics can't *prove* best TTFT —
  only an on-device micro-benchmark can. The heuristic default is a strong, safe
  improvement, not a guarantee.
- **NPU is not shippable yet on Android** — HTP is compiled out (`Hexagon SDK not found`).
  Auto-NPU requires bundling the SDK into the build + real per-SoC device testing. Until
  then the resolver must *exclude* htp via `compiledBackends`.
- **Per-SoC verification** — auto-GPU can crash/OOM on a bad driver. Each SoC family the
  default flips on should get an on-device Provit run; genuine gaps are modelled as
  capability data, not scattered `if`s.

## Rollout
1. **Phase 1 (safe win):** capability-as-data + resolver + Android auto-OpenCL when
   supported. Own branch/PR, pure-function tested, Provit on 1–2 Adreno + 1 Mali device.
   iOS unchanged.
2. **Phase 2:** bundle Hexagon SDK, runtime `compiledBackends` gate, expose + auto-select
   HTP/NPU on flagship Qualcomm.
3. **Phase 3 (optional):** first-launch micro-benchmark for a *measured* best-TTFT default.

## Related
- Hardware acceleration strategy memory: route existing SDKs (ONNX/GGUF breadth engines,
  LiteRT/executorch NPU, Pixel TPU via Tensor SDK), no pipeline/SDK business.
