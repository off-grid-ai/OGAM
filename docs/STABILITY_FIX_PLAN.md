# Stability & Performance Fix Plan — iOS + Android (branch `fix/llm-stability-and-perf`)

Status: Phases 0–2 implemented + tested (see commits). Phase 3 (Android native), Phase 4 (crash reporting), and the tail remain.
Owner: TBD. Branch: `fix/llm-stability-and-perf`.

### Progress
- [x] **F1 (R1)** — removed MCP context auto-boost + un-stick migration (the slowness/crash regression).
- [x] **F2 (R2)** — embedding model registered as a budgeted sidecar resident.
- [x] **F5 (R5)** — embedding load bounded by a timeout so it can't wedge the global load lock.
- [x] **F3/F4 (R3,R4)** — corrected KV estimate; memory guard now downgrades context (or blocks) instead of warning-then-crashing.
- [x] **F6 (R6)** — tool-embedding cache persisted (content-hashed) so the first-message embedding burst happens once ever.
- [x] **F8 (R7)** — Android LiteRT hardening: RAM-aware token clamp + vision delegate follows backend tier. Verified locally (compile/lint/unit test).
- [x] **F10** — iOS background-downloader event emission marshalled to main thread (patch-package).
- [ ] **F9 (R8)** — crash reporting. DROPPED per product decision (privacy posture) — rely on Organizer/Play Console.
- [x] **DEFER-1** — Deferred-load (commit d1d59f24) first-message crash. Resolved by F1+F4/F8: the on-send load no longer hits the 32k-boost OOM; it downgrades/clamps instead of crashing. Deferred loading KEPT (product decision).
- [x] **DEFER-2** — "Can't switch models in chat" under deferred loading. The selector keyed its switcher off the loaded path (null until first send). Now reflects the SELECTED model (activeModelId); switching loads on tap (product decision). Deferred loading unchanged.
- [ ] **F11** — Android `TextLayoutManager` JS exception / `dispatchDraw` NPE. Needs a repro.
- [ ] **IMG** — iOS Core ML image-gen load fails instantly ("Failed to load model") on iPhone 15 Pro / iOS 26.5. NOT the residency memory gate: 7.5 GB RAM (~4.6 GB budget), image load evicts the text model first, and SD 1.5 (~3 GB est) fits — yet BOTH SD 1.5 and SDXL fail instantly. Points to the native Core ML load (`CoreMLDiffusionModule.swift` `ERR_LOAD_FAILED`): an iOS-26.5 compute-unit/ANE regression or incompatible/missing compiled `.mlmodelc` assets. The actual hard-crash signature in Organizer is `OffgridMobile: Unet.latentSampleShape.getter + 768` — a force-unwrap in Apple's StableDiffusion pipeline reading the UNet input shape descriptor (so it BYPASSES the `catch`/`ERR_LOAD_FAILED`). Needs reproduction on iOS 26.5 to confirm; do NOT lower the memory estimate (would risk OOM without fixing this).
- [x] **STT-SYNC** — Download Manager vs Transcriptions tab disagreed (one "failed", one "downloading"). Dual source of truth: `useDownloadStore` (Download Manager) vs `whisperStore.downloadProgressById` (Transcriptions tab). Fixed: Transcriptions tab now derives in-flight STT state from `useDownloadStore` (filtered `'stt'`); a failed entry shows the model as downloadable again. `whisperStore.downloadProgressById` kept only as the RNFS URL-import fallback. Committed (`c2173e65`) + tested.

## Session 2 — device-testing findings (iPhone 12, 4 GB; running from Xcode). NOT yet fixed.

### TTS / memory (HIGH — "Kokoro keeps crashing the app", "kills the device")
- **Root cause = jetsam memory kill, NOT a code crash.** Pulled device logs: `JetsamEvent` with `largestProcess: OffgridMobile`, `reason: per-process-limit`, ~2200 MB resident. The Xcode console just ends at `Scheduler::~Scheduler() was called` with no exception backtrace — classic jetsam SIGKILL (that's why no `.ips`/stack appears when debugging attached). The `increased-memory-limit` entitlement IS present (`ios/OffgridMobile/OffgridMobile.entitlements`), but the iPhone 12 (4 GB) is still hard-capped ~2.2 GB.
- **Why footprint is huge even with a 360–500 MB model:** the crash-time console showed the app doing a LOT concurrently — SmolVLM2-500M f16 (820 MB)+mmproj, then Q8_0 (436 MB)+mmproj, a Core ML SD 2.1 zip (1.1 GB), THREE Whisper models (base 148 MB / tiny 78 MB / small 488 MB), AND a ~500-connection LAN discovery scan (`C1`…`C520`) for Ollama/LM Studio — plus the resident text model + Kokoro. The 2.2 GB is the SUM; TTS is the straw. (This also explains "downloads are super slow" — bandwidth split across ~6 concurrent transfers + connection storm.)
- **Concrete defects found (the fix, consolidated on the existing 60% residency budget):**
  1. `pro/audio/engine/tts/engines/kokoro/KokoroEngine.ts:68` `peakRamMB: 82` is set to the FILE size, not runtime footprint → residency UNDER-budgets TTS. Set to a realistic measured value.
  2. On-demand TTS load `pro/audio/ttsStore.ts:208 initializeEngine()` takes the global lock via `runExclusive('load:tts', ...)` but **never calls `makeRoomFor` / budget-checks** (unlike text/image loads). Route it through the budget; when it won't fit → show the agreed message: "Not enough memory to use voice with this model loaded. Try a smaller text model." (product decision: message, do NOT auto-evict the chat model). NOTE: the boot-preload path `pro/audio/index.ts:198` DOES gate on `canLoadWithoutEviction` + `register` — only the on-demand path is unguarded.
  3. Cap concurrent downloads (queue, ~1–2 at a time) — biggest transient-memory amplifier + fixes slowness. (`src/services/backgroundDownloadService.ts` / `DownloadManagerModule`.)
  4. Throttle the LAN discovery scan (currently ~500 simultaneous connections) — `[Discovery]` in the network-scan service.

### "Kokoro isn't playing" (separate from the crash — NOT YET INVESTIGATED)
- New symptom after the memory work: TTS audio not audible. Possibly related to the recent iOS audio-session commits in the pro submodule (`6db30a2c fix(kokoro): make TTS audible on iOS (activate playback session + resume context)`, `483b8f81 bind AudioContext to a local ctx before resume`). Check `KokoroTTSBridge.tsx` playback path + AVAudioSession activation. Needs device verification.

### Import local file scope (LOW — UX clarity)
- `src/screens/ModelsScreen/useModelsScreen.ts:129 handleImportLocalModel` accepts `.gguf` (text), `.litertlm` (LiteRT), and `.zip` (image) — NOT STT/TTS. Picker uses `types.allFiles` then rejects post-pick. User wants this made explicit (up-front helper text listing supported formats). Decision pending on exact wording.

### Download Manager has stale failed STT rows
- Log showed `#4`/`#5 ggml-base.en.bin status=failed bytes=32/32` persisting. `whisperService.downloadModel` finally calls `useDownloadStore.remove(modelKey)` but if the background promise hangs on failure the entry isn't removed. STT-SYNC fix makes both screens AGREE; auto-clearing stale failed rows is a separate follow-up.

## 1. Evidence

### Crash data
- **iOS (Xcode Organizer, all versions, last 2 weeks)** — ranked by devices:
  - `rnllama: lm_ggml_backend_metal_buffer_type_alloc_buffer` — **34 devices** (Metal GPU buffer alloc failure on load/inference). #1 by a wide margin.
  - `OffgridMobile: condition_variable::wait < ThreadPool::startWorkers >` — **19 devices** (thread parked at termination — watchdog hang or jetsam).
  - `rnwhisper` — 6, `rnllama: lm_ggml_mul_mat_aux` — 5, `hermesvm` — 3, `RCTJSThreadManager runRunLoop` — 3, `rnllama metal_rsets_init` — 2, `CFNetwork setupBackgroundSession` — 1, `google::LogMessage::Fail()` — 1.
- **Android (Play Console, v0.0.100)** — by share:
  - `liblitertlm_jni.so` SIGSEGV — **65.2%** (inference).
  - `liblitertlm_jni.so Java_..._nativeCreateEngine` SIGABRT — engine create/load (×2 issues).
  - `libGLES_mali.so` SIGSEGV — Mali GPU delegate.
  - `libc++_shared istream::read` SIGSEGV — stream/model parse.
  - `TextLayoutManager.createLayout` JavascriptException — 13.0%.
  - `ReactViewGroup.dispatchDraw` NPE — 4.3%.
- **No crash-reporting SDK in the app** (no Sentry/Crashlytics/Bugsnag/analytics). Production is otherwise blind; Organizer + Play Console are the only sources, both opt-in/partial.

### User reports
- Crashes + "performance tanked compared to the previous version" **after updating and activating Pro**, on **flagship** hardware: iPhone 17 Pro Max 2TB; Samsung S25 Ultra, Snapdragon 8 Elite, 12 GB RAM, Qwen 3.5 2B q4_k_s.
- "Unusable" / "unstable" relative to the prior release → points to a **recent regression**, not pure low-RAM OOM.

## 2. Root causes (ranked)

### R1 — PRIMARY REGRESSION: MCP context boost forces 32k context + reload, never restores
`src/services/mcpContextBoost.ts` + wired live via `pro/index.ts:54` (`watchMcpContextBoost`).
- On the MCP-enabled `0 → >0` transition, `applyMcpContextBoost()`:
  - llama models: `contextLength → 32768` (8× the 4096 default), `maxTokens → 8192`, then **unload + reload** the active model.
  - litert on `>8 GB` devices: `liteRTMaxTokens → 32768`.
- Policy (by design today): turning MCP **off does not restore** — maxed settings persist permanently.
- Consequence: ~8× KV-cache growth on the exact flagship devices in the reports. Directly explains iOS `metal_buffer_type_alloc_buffer` (#1, 34 devices), Android litert OOM (SIGABRT/SIGSEGV on create), the tok/s collapse, and the "never recovers" degraded state.
- It also **conflicts with R-context**: commit `ea127b1b` later added the embedding tool-router that thins ~60 schemas to 12 (`MCP_TOOL_ROUTE_TOPK`). The boost's stated purpose ("so schemas fit, skip routing entirely") is now redundant with — and additive to — the router, so Pro users pay **both** costs.

### R2 — Embedding (MiniLM) model is loaded untracked and never unloaded
`src/services/rag/embedding.ts:32` loads `all-MiniLM-L6-v2-Q8_0.gguf` via `modelResidencyManager.runExclusive('load:embedding', …)` but **never `register()`s** with the residency manager.
- Its footprint is invisible to the RAM budget (`modelResidency/index.ts` `getBudgetMB` sums only registered residents), so the manager loads a full-size chat model believing it has more free RAM than it does.
- `ResidentType` has no `'embedding'` entry (`modelResidency/policy.ts`); it is never an eviction candidate and there is no `unload()` in the normal flow.
- Triggered for **every** MCP-tools user since `ea127b1b` (previously RAG-only). Co-resident with the chat LLM → OOM contributor.

### R3 — iOS never caps `n_gpu_layers` by device memory
`src/services/llmHelpers.ts` (`getGpuLayersForDevice` / `initWithAutoContext`): only Android Adreno is RAM-tiered; **iOS passes the full requested layers (default 99)**. With a large model + boosted context, Metal working set is exceeded → `metal_buffer_type_alloc_buffer` failure.

### R4 — Memory guards are advisory only and the KV estimate is wrong
- `src/services/llmSafetyChecks.ts checkMemoryForModel` result is only `logger.warn`-ed in `llm.ts`; load proceeds regardless.
- `modelResidency/index.ts makeRoomFor` returns `{ fits: false }` but the caller (`activeModelService.doLoadTextModelLocked`) does not check it.
- KV-cache estimate `(contextLength/1024) * 0.5` MB ≈ 2 MB @ 4096 — off by orders of magnitude vs real per-layer KV (hundreds of MB to GBs), so the guard cannot catch oversized loads (especially the R1 32k case).

### R5 — Embedding load inside the global lock → watchdog hangs (the 19-device crash)
`toolEmbeddingRouter.ts:112` → `embeddingService.load()` runs **inside** `modelResidencyManager.runExclusive`. If native threadpool/Metal init stalls while the lock is held, other operations block; threads park in `ThreadPool::startWorkers → condition_variable::wait` and the OS watchdog kills the app.

### R6 — First MCP message does ~60 sequential CPU embeddings (TTFT regression)
`toolEmbeddingRouter.ts:116-117` embeds every uncached tool sequentially over a CPU-only context before the chat model starts. First message of a session with several MCP servers connected (~60 tools) → a visible time-to-first-token stall.

### R7 — Android Mali vision delegate + uncatchable native aborts
`android/.../litert/LiteRTModule.kt:139`: vision backend is **always `Backend.GPU()`** when vision is enabled (even if main backend is CPU) → `libGLES_mali` SIGSEGV on devices with weak/low-VRAM GPUs. Native `Engine()` `CHECK()` failures abort (SIGABRT) before the Kotlin try/catch at the JNI boundary. No pre-create native memory check (`getMemoryInfo()` exists but is unused before `Engine()`).

### R8 — No production crash reporting
No SDK → "very buggy" reports cannot be triaged with stacks. Going forward this is the difference between guessing and knowing.

### Tail (lower priority, real)
- iOS `react-native-background-downloader` race: `safeEmitEvent` touches a JSI `unordered_map<…IAsyncEventEmitter>` from a CFNetwork background queue (EXC_BAD_ACCESS). 1 device in aggregate; pulled from a connected device earlier.
- Android `TextLayoutManager.createLayout` JS exception (13%) and `ReactViewGroup.dispatchDraw` NPE — RN UI bugs, investigate separately.

## 3. Fix plan

### Phase 0 — Stop the bleeding (the regression)
- **F1 (R1): Neutralize the 32k context boost.** Options, pick one:
  - (a) Remove `watchMcpContextBoost()` / the auto-boost entirely and rely on the embedding tool-router (`ea127b1b`) to fit tools — the router is the newer, cheaper strategy and already lands the schemas in a 4096 window.
  - (b) If a boost is kept, cap target context to a **memory-aware** ceiling (function of free RAM, model size, quant), never an unconditional 32768, and **restore the prior context on MCP-off**.
  - Recommended: (a) remove the auto-boost; keep router. Smallest, safest, directly reverses the regression.
  - Add a **one-time migration** that resets users already stuck at `contextLength: 32768 / liteRTMaxTokens: 32768` (persisted) back to the device-appropriate default, so existing Pro users recover without reinstall.
  - Tests: unit on `applyMcpContextBoost` no-op/removal; integration that enabling MCP does **not** change `contextLength`; migration test that a stuck setting is reset.

### Phase 1 — Memory correctness (the crash clusters)
- **F2 (R2): Register the embedding model as a residency-tracked sidecar.** Add `'embedding'` to `ResidentType`, register on load with its real size, make it an eviction candidate (or pin + explicit `unload()` after routing). Ensures the budget accounts for it.
  - Tests: unit that load registers + size counted in `getBudgetMB`; integration that loading a chat model after embeddings triggers correct eviction/fit.
- **F3 (R3): RAM-tier `n_gpu_layers` on iOS** (mirror the Android Adreno tiers using total/available memory + model size). Cap layers so Metal working set is not exceeded.
  - Tests: unit on `getGpuLayersForDevice` for iOS tiers.
- **F4 (R4): Make guards blocking + fix the KV estimate.**
  - `checkMemoryForModel` unsafe result should **block or downgrade** (reduce ctx/gpu layers) rather than warn.
  - Honor `makeRoomFor().fits === false` in the caller (reduce ctx, drop gpu layers, or surface a clear error instead of crashing).
  - Replace the KV formula with a per-layer estimate (layers × kv-heads × head-dim × bytes(cache_type) × ctx × 2), even if approximate.
  - Tests: unit on new KV estimate; integration that an oversized load is downgraded, not crashed.
- **F5 (R5): Don't hold the global load lock across embedding init.** Load the embedding model outside `runExclusive`, or give it its own lock, or warm it at idle (not on the hot path) so a stalled native init can't park the chat-load lock. Add a timeout that releases cleanly.
  - Tests: integration that a slow embedding load does not block a concurrent chat-model load past a bound.

### Phase 2 — Performance
- **F6 (R6): Fix first-message embedding burst.** Precompute/persist tool embeddings (cache to disk keyed by tool name+hash), warm the embedding model at idle, and/or batch the embedding calls. Goal: no ~60-call synchronous stall before TTFT.
  - Tests: unit that cached tools skip re-embedding; perf assertion that first-message routing issues 0 embeds when cache warm.
- **F7: Verify boost removal restores tok/s.** Bench Qwen 3.5 2B q4_k_s on a flagship before/after F1 (ctx 4096 vs 32768) to confirm the regression is gone.

### Phase 3 — Android engine hardening
- **F8 (R7):**
  - Pre-`Engine()` native memory check via existing `getMemoryInfo()`; refuse/downgrade if `lowMemory` or below threshold.
  - Gate the vision `Backend.GPU()` behind a GPU/VRAM capability check; fall back to CPU vision on weak GPUs instead of failing the whole load.
  - Where possible, validate model file/format before `Engine()` to avoid native `CHECK()` SIGABRT; ensure the JS-side timeout maps to a clean user-facing error.
  - Tests: Kotlin unit on backend-chain selection + low-memory refusal; integration on JS load-timeout → error path.

### Phase 4 — Observability (so we are never blind again)
- **F9 (R8): Add a crash reporter** (Sentry RN + native iOS/Android) behind the existing privacy posture — opt-in, scrub PII/prompts, local-first where feasible. Wire a JS global error handler + React error boundary (none exist today). This is what turns the next "it's buggy" into a stack trace.

### Tail (separate small PRs)
- **F10:** iOS background-downloader: marshal `safeEmitEvent` onto a consistent thread / serialize the JSI emitter access, or upgrade/patch `@kesha-antonov/react-native-background-downloader`.
- **F11:** Android `TextLayoutManager` JS exception (13%) and `ReactViewGroup` NPE — reproduce and fix in the RN UI layer.

## 4. Sequencing
1. Phase 0 (F1 + migration) — ships the regression fix fastest; biggest user impact.
2. Phase 1 (F2–F5) — kills the OOM + watchdog crash clusters on both platforms.
3. Phase 2 (F6–F7) — restores performance.
4. Phase 3 (F8) — Android engine robustness.
5. Phase 4 (F9) — crash reporting (can run in parallel; independent).
6. Tail (F10–F11) — opportunistic.

## 5. Verification
- Unit + integration tests per fix (repo requires both).
- Device bench: Qwen 3.5 2B q4_k_s on a >8 GB device, MCP on/off, measure TTFT + tok/s + peak memory before/after F1.
- Memory: confirm embedding model appears in residency budget after F2; confirm no chat-model load proceeds when it cannot fit after F4.
- Soak: enable/disable MCP repeatedly; confirm no stuck 32k state and no watchdog hang.
- After F9 ships: watch Organizer + Play Console for the `metal_buffer_type_alloc_buffer`, `nativeCreateEngine`, and `condition_variable::wait` buckets to fall.

## 6. Open questions / decisions needed
- F1: remove the auto-boost outright, or keep a memory-aware capped boost? (Recommend remove.)
- F1 migration: acceptable to silently reset persisted 32k context for existing Pro users? (Recommend yes.)
- F9: which crash reporter, and is opt-in telemetry acceptable given the privacy positioning? (Product decision.)
</content>
</invoke>
