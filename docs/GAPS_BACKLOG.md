# Gaps backlog

Honest register of OPEN gaps, regressions, dead code, and "not fully done" items. Each
entry has a verdict and evidence. The standing gap agent picks these up, closes them, and
REMOVES them from this file once resolved (the record lives in git history + commit messages).
This file only ever contains work that is still open.

Verdict legend:
- **delete-safe** - unreferenced / unreachable and provably unused; remove it.
- **fix-the-guard** - the branch is SUPPOSED to fire but a condition prevents it; fix the condition (a latent bug, not litter).
- **instrument-and-revisit** - uncertain trigger; add a `[*-SM]` trace + an on-device journey to observe it live before deciding.

---

## Active Kokoro voice-model download cannot stop at Pro expiry - 2026-08-26

**Verdict: instrument-and-revisit.**

The Pro-expiry teardown stops audio, removes the voice download provider, and releases the TTS
engine. However, a Kokoro asset fetch that is already active continues inside the
`react-native-executorch` fetcher because that external API has no abort or cancel operation.
`pro/audio/ttsDownloadProvider.ts` records this boundary as `cancel: false`; expiry can prevent new
paid work, but it cannot stop the active native download or its remaining disk writes.

Revisit when the native fetcher exposes cancellation, or put voice-model transfer behind an app-owned
cancellable downloader. The acceptance case is that exact Pro expiry aborts an active voice-model
network request and no download progress or file write occurs after access closes.

---

## Android voice session can lose playback or transcription - 2026-08-24

**Verdict: instrument-and-revisit.**

A Pixel 8a user reported that voice replies showed both transcripts but produced no sound. After the
user stopped and restarted the app, playback worked, but microphone input no longer produced a
transcript. The currently attached Android device creates and plays a full-volume `AudioTrack`, so
the failure is not reproduced. Capture Pixel logs for the playback and recorder state machines before
changing audio-focus or model-lifecycle behavior. Acceptance: repeated voice turns continue to play
and transcribe before and after app restart, for the user's selected language.

---

## Projects screen does not refresh after desktop project sync - 2026-08-20

**Verdict: instrument-and-revisit.**

Observed during the attended desktop-to-mobile E2E: a project created on desktop and populated with
the four Off Grid AI fixture documents reached the sync mesh, but the already-open mobile Projects
screen did not show the new project in real time. Determine whether the project row was materialized
while the screen's query/cache failed to invalidate, or whether materialization itself was delayed.
The acceptance case is that an open Projects screen updates without navigation, rescan, or restart.

---

## Synced iPhone image is missing from the Desktop Gallery - 2026-08-20

**Verdict: instrument-and-revisit.**

Observed during the physical iPhone generated-image journey. The iPhone showed the live generation,
the final image, and the new Gallery item. Desktop received and decoded the same image in the synced
chat, and the PNG exists in Desktop's uploads directory. However, Desktop's
`listGeneratedImages()` result has no entry for that file, so the Generated Images Gallery does not
show it.

Evidence: `.artifacts/e2e-flows/generated-image-sync/ios-to-mesh-2026-08-20T05-07-45-131Z/`.
The received file id is `5579552F-121E-4228-9BB7-B9F9C7541D69.png`.

Determine whether the desktop sync importer skips Gallery metadata registration, or whether the
Gallery reads a separate index that does not refresh after a synced image arrives. The acceptance
case is that one synced generated image appears in both the receiving chat and the Desktop Gallery
without a restart or manual refresh.

---

## Tooling gates — remaining follow-ups

The tooling spine is installed + enforced (depcruise 0 violations, knip 0 issues, sonarjs wired,
untyped dead-branch rules — all hard CI gates). These three are the open follow-ups:

1. **DIP value-branch ESLint rule.** depcruise catches the IMPORT-edge half of the engine-DIP rule;
   the VALUE-branch half (`model.engine === 'litert'` comparing a store value) is not an import edge.
   Guard it with an ESLint `no-restricted-syntax` rule so a new concrete-engine branch in a caller fails.

2. **SonarJS warn→error ratchet.** These rules are at `warn` (tripped on legacy core); ratchet each to
   `error` as its count hits zero. (`no-duplicate-string` stays OFF — it fights RN style literals.)

   | Rule | Count |
   |---|---|
   | sonarjs/prefer-single-boolean-return | 9 |
   | sonarjs/no-nested-template-literals | 6 |
   | sonarjs/no-collapsible-if | 2 |
   | sonarjs/prefer-immediate-return | 1 |
   | sonarjs/no-duplicated-branches | 1 |

3. **Typed `@typescript-eslint/no-unnecessary-condition` (AI dead-branch killer).** Needs typed linting
   (`parserOptions.project: ['./tsconfig.json']` — SLOWS eslint) + the typed config. Floods on AI code.
   CAUTION: many "unnecessary" conditions are DEFENSIVE against untyped runtime data (native bridge,
   JSON) — blindly deleting them can crash at runtime. So: enable, MEASURE, fix each by hand verifying
   it's not a real runtime guard (keep + `// eslint-disable` with a reason where the type lies about
   runtime). Fix-in-waves toward `error`. Companion tsconfig flags to measure: `allowUnreachableCode:false`,
   `noUnusedLocals/Parameters:true`.

---

## Dead-code recon — open (deferred) items - 2026-07-06

Recon sweep findings that are real but deferred (changing them risks behaviour). The false-positives
(AU1, AU2, DL4, ML1, ML2 — verified USED by tests/prod) have been dropped from the register.

### Model-load / generation
| # | Location | Symbol | Verdict | Note |
|---|----------|--------|---------|------|
| ML3 | activeModelService/utils.ts:16-17 vs types.ts:48-50 | overhead multipliers (1.2/1.3 hardcoded vs 1.5/1.8 constants) | fix-the-guard | HomeScreen memory display disagrees with the load-path math; import the shared constants |
| ML5 | activeModelService/index.ts:~338 + loaders.ts | `cpuOnly: false` (always false) | delete-safe (deferred) | native CPU-only branch unreachable from TS; removing the arg changes the native call — do as a typed refactor with tests |

### Download / model-manager
| # | Location | Symbol | Verdict | Note |
|---|----------|--------|---------|------|
| DL1 | downloadHydration.ts:33 | `case 'retrying'` in mapNativeStatus | delete-safe (deferred) | native never emits 'retrying'; removing a union value risks exhaustiveness breakage — typed refactor with tests |
| DL2 | DownloadManagerScreen/items.tsx (+ downloadStatusIcon.ts, downloadErrors.ts, useDownloads.ts) | branches on `status === 'retrying'` | fix-the-guard | unreachable given DL1; remove or document the contract |
| DL3 | modelManager/types.ts:13 | `BackgroundDownloadMetadataCallback` (@deprecated no-op) | delete-safe (deferred) | author-confirmed no-op, still threaded through 3 sites; needs on-device observation |
| DL5 | modelManager/download.ts:454-462 | `isFinalizing` reset only on error | instrument-and-revisit | verify re-entrancy window on the success path |

### Audio / TTS / STT
| # | Location | Symbol | Verdict | Note |
|---|----------|--------|---------|------|
| AU4 | ChatInput/Voice.ts:136-143 | stopRecording early-return guard | fix-the-guard | inverted condition; can't be true when recording |
| AU5 | whisperService.ts:338-400 | `transcriptionFullyStopped` promise overwrite | fix-the-guard | new start replaces a promise unloadModel may await |
| AU6 | audioRecorderService.ts:12-14 | `supportsDirectAudioInput()` stub `return true` | instrument-and-revisit | placeholder; add real capability detection |

### Image-gen / tools / remote
| # | Location | Symbol | Verdict | Note |
|---|----------|--------|---------|------|
| IM2 | localDreamGenerator.ts:67 (+ loaders.ts:296) | `backend` param always `'auto'` | delete-safe (deferred) | 'mnn'/'qnn' branches never reached from TS; removing the arg changes the native call |
| IM3 | imageGenerationHelpers.ts:42-44 | iOS short-circuit ignores `backend` | fix-the-guard | 'coreml'/default 'mnn' unreachable on iOS; make explicit |
| IM4 | localDreamGenerator.ts:236-238 | `hasKernelCache()` wraps `hasOpenCLCache` (name mismatch) | fix-the-guard | rename to match native call |
| IM5 | localDreamGenerator.ts:231-239 | `clearOpenCLCache`/`hasKernelCache` silent iOS no-op | instrument-and-revisit | throw or gate at call site on iOS |

---

## Image-gen QNN over-recommendation on non-flagship Snapdragons - 2026-07-08

**Verdict: fix-the-guard (DEFERRED — needs a curated SoC allowlist + on-device rounds).**

Observed live (AC2001 / OnePlus Nord, SoC SM7250): the app recommends a QNN/NPU image model, the
user downloads + loads it, and the native local-dream process crashes: `Failed to load image model:
Server process exited with code 1. Your device (SM7250) may not support this model's backend.` So it
recommends NPU then reports NPU unsupported — a self-contradiction.

Root cause (`src/services/hardware.ts`): `classifySmNumber` buckets every non-flagship Snapdragon into
`'min'`; `hasNPU = vendor === 'qualcomm' && !!qnnVariant` → `'min'` counts as NPU-capable; `getQualcommImageRec`
returns `recommendedBackend:'qnn'` for ALL variants incl. `'min'`. So SM7250 (Hexagon that can't run
the QNN binaries) is told QNN works, passes the pre-load gate, and crashes at runtime.

Fix: QNN capability must be a narrow verified set (8gen1/8gen2 or an explicit allowlist), not "any
Snapdragon"; `hasNPU`/recommendation key off ACTUAL QNN-capability; the catch-all recommends `mnn`.
Needs device verification on affected SoCs (SM7250 + a true 8gen1/8gen2) before shipping.

## Image-gen inline preview not shown on first run - 2026-07-08

**Verdict: instrument-and-revisit (native-emission behaviour, not a JS/UI bug).**

First run (OnePlus Nord, mnn/OpenCL): the "Generating Image" card showed no inline preview. The UI IS
wired correctly (`ChatScreenComponents` renders `imagePreviewPath` fed by imageGenerationService's
onPreview → appStore). The preview only appears when the NATIVE localdream module includes `previewPath`
in its progress events — none were emitted, consistent with first-run OpenCL kernel compilation skipping
the intermediate-latent decode. Next: confirm whether previews appear on a SECOND (warmed) generation.
If yes → expected first-run behaviour (maybe show a hint). If never on mnn → native gap; JS/UI is correct.

---

## On-device test session - 2026-07-09 (Qwythos-9B vision + memory, 12GB iPhone/Android)

Surfaced live on real hardware during 0.0.103 vision/memory testing. None caught by the green suite —
the reason the on-device gate is mandatory.

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| OD1 | **Vision (mmproj) dropped on download retry** | fix-the-guard | `[DL-SM]` iPhone: main GGUF failed at 9% → auto-retry re-issued `needsMmProj:false, mmProjLocalPath:null` → finalized text-only. release/0.0.103 fix (persist metadataJson) targets this; UNVERIFIED on-device. |
| OD2 | **Repair Vision has no progress feedback** | fix-the-guard | ~900MB mmproj re-download behind an indeterminate "Repairing…" spinner. Needs determinate progress. USER-SELECTED. |
| OD3 | **Chat vs Home model-selector inconsistency** | fix-the-guard | `checkMemoryForModel` called ONLY in useChatModelActions.ts. Chat pre-checks (predictive fileSize×1.5 → gates behind "Load Anyway"); Home skips the pre-check → loads via measured makeRoomFor → succeeds. Two surfaces, one decision, divergent logic. USER-SELECTED. |
| OD4 | **UI freeze on forced heavy load (Load Anyway on 9B multimodal)** | instrument-and-revisit | RN touchables dead; debug log stopped = JS thread blocked by the synchronous native load. Root cause turned out to be threads=1 (see nThreads follow-up below). |
| OD5 | **Android download retry doesn't resume after network drop** | instrument-and-revisit | `[DL-SM]` android: errored at 75%, retry dispatched → NO further progress. Partly a real WiFi drop; retry-not-resuming is the reliability gap. |
| OD6 | **Kokoro TTS asset stuck loop** | instrument-and-revisit | `[KOKORO-DL] checkAssetStatus → downloading (phase=ready progress=1.00 genuineCompletion=false)` spamming — stuck "downloading" while phase=ready/progress=1.0. |
| OD7 | **Thinking toggle missing for Qwythos-9B in settings** | instrument-and-revisit | Model has reasoning + emits `<think>` but settings shows no toggle. Capability detection gap for community GGUF. |
| OD8 | **Voice-mode thinking not streamed (appears suddenly)** | instrument-and-revisit | Thinking renders live in text chat but batches in voice mode. Suspected in the audio-layout display path (pro/audio/ui/AudioModeLayout.tsx). USER-SELECTED. |
| OD9 | **TTS speaks tool-call content aloud (voice mode)** | fix-the-guard | DELEGATED (fix/tts-strip-tool-calls). `enqueueReadySentences` runs stripControlTokens per-SENTENCE-fragment, so a `<tool_call>…</tool_call>` spanning sentence boundaries leaks. Fix: withhold+strip whole control-token blocks before segmentation. |
| OD10 | **TTS stops mid-speak** | instrument-and-revisit | `KOKORO_SPEAK The model is currently generating` + `stream segment FAILED` — a double-speak concurrency collision. Needs speak/stream serialization checked. |
| OD11 | **Voice mode can't stream TTS alongside a large LLM** | fix-the-guard | With a big model resident, the single-model residency rule blocks the ~82MB Kokoro sidecar even with 4.4GB free; streamingSpeech loops `stream feed SKIP: engine not warm` then falls back to end-of-turn speech. Fix: allow SIDECAR types (tts/whisper/embedding) to co-reside when real free RAM fits them. |
| OD12 | **9B loads slowly on CPU + feels frozen** | instrument-and-revisit | GPU (Adreno 4.6GB) can't hold the 9.3GB model → CPU fallback; with threads=1 the load took ~1m43s (janky UI). Root cause = nThreads (below). Also: keep UI responsive during a long native load. |
| OD13 | **Qwythos output goes entirely to reasoning_content, answer undefined** | instrument-and-revisit | `content:undefined, reasoning_content:"The"`, `token:"<|channel>"` while `reasoning_format=deepseek`. Model's actual reasoning delimiters don't match the configured format. Needs per-model reasoning_format detection, or accept it's a bad-fit model. 'auto' native-first (parse-once) may fix it. |
| OD15 | **"Unable to generate parser for this template / Jinja: Conversation roles must alternate" on model switch after a tool call** | fix-the-guard | llama.rn minja compiling a chat_template that asserts strict user/assistant alternation when tools enabled / history has assistant+tool+assistant. Pre-existing. Fix: catch the LOCAL tool-parser-gen failure and retry WITHOUT tools (app already does this for REMOTE via isToolGrammarError). Separate PR. |
| OD16 | **Remote model capabilities feel flaky across Ollama / LM Studio / OGA Desktop** | instrument-and-revisit | remoteModelCapabilities has 39 unit + 4 integration tests but all FIXTURE-based. Real flakiness is response-shape variance across provider versions. Fix: capture real /props, /api/show, /v1/models from LIVE instances as fixtures; harden derivation; add a provider-abstraction contract test. Separate workstream. |

**nThreads sane-default follow-up (own PR):** OD4/OD11/OD12 shared a root cause — the 9B ran with
`threads=1` (device default nThreads:0/auto not resolving to a sane core count on an 8-core device).
Single-threaded native inference starved the iOS JS thread and crawled on Android; raising the thread
count fixed both (confirmed on device). Investigate why nThreads resolved to 1 for large models
(`[LLM] Resolved params: threads=1`) and ship a sane default. GPU/NPU are NOT viable for this model
(Adreno OpenCL 1GB max-alloc; Hexagon needs QNN-converted models; Qwythos is SSM-hybrid) — CPU-with-
proper-threads is the path.

---

## Repo-wide /hygiene audit — open items - 2026-07-09 (SOLID §A/§B + DRY §C)

Through-line: decision/capability logic derived ad-hoc at many call sites instead of owned once by a
service.

### SOLID (§A/§B)
| # | Location | Verdict | Fix |
|---|----------|---------|-----|
| SO1 | src/screens/ModelsScreen/TextModelsTab.tsx:143 handleRetryDownload | BLOCKING | Renderer re-implements download retry (Platform.OS branch, store mutation, mmproj, polling) — CLAUDE.md says this moved to ModelDownloadService. Delete; delegate to modelDownloadService.retry() like useDownloadManager. |
| SO5 | src/screens/ModelsScreen/ImageFilterBar.tsx | DEBT | Platform.OS chooses which filter DIMENSIONS exist. Data-driven filter descriptor from service. |
| SO6 | src/services/remoteServerManagerUtils.ts:122 | DEBT | `provider instanceof OpenAICompatibleProvider` to call updateCapabilities. Put on the provider interface (ISP). |
| SO7 | pro/audio/ttsStore.ts:377,385 | DEBT | `instanceof OuteTTSEngine` for cache ops. Optional getAudioCacheSizeMB?/clearAudioCache? on the TTS engine interface. |
| SO8 | src/stores/remoteServerHelpers.ts:32,188 | DEBT-low | `kind==='vision'` capability branch; fold into shared deriveRemoteCapabilities. |

### DRY (§C)
| # | Location | Verdict | Fix |
|---|----------|---------|-----|
| DR3 | src/screens/HomeScreen/components/ModelPickerSheet.tsx:63,201 (*1.8/*1.5, -1.5) | DRIFTED (live) | Third memory-fit verdict bypassing memoryBudget.ts. Can say "fits" when residency refuses — the Load-Anyway/selector bug family. Call modelMemoryBudgetMB. |
| DR4 | CHARS_PER_TOKEN=4 bare literal in llmHelpers,liteRTCompaction,litert,llm,generationServiceHelpers,providers/*,documentService | DEBT | Export CHARS_PER_TOKEN_ESTIMATE + estimateTokens(); all import. |
| DR5 | STOP_TOKENS (llmHelpers:427) + CONTROL_TOKEN_PATTERNS (messageContent:1) + tests re-hardcode | DEBT | One token registry; derive stop-list + strip-patterns; tests import. |
| DR6 | pro/audio outetts:363 + ttsService:207 '<\|im_end\|>' | DEBT-low | Shared IM_END_TOKEN. |
| DR8 | remoteModelCapabilities:202 deltaHasThinking vs openAICompatibleStream:155 | DEBT | Shared REASONING_DELTA_FIELDS + deltaHasReasoning(delta). |

### Test quality (§D)
| # | File | Verdict | Fix |
|---|------|---------|-----|
| TQ1 | __tests__/**/useDownloads.test.ts | WORST | Fakes the reducer under test (hand-sets entry.status then asserts the spy) — 37 call-asserts, 0 real-state. Drive real useDownloadStore; assert getState().downloads[key].status. |
| TQ2 | ChatScreenSpotlight (step 3→12 block) | WORST | Block ends after advanceTimersByTime with ZERO expect() — can never fail. Assert the coachmark text. |
| TQ3 | Spotlight trio (Chat/Home/ModelSettings, ~40 tests) | HIGH | Assert goTo(<int>) not the coachmark; unmock react-native-spotlight-tour, assert getByText(coachmark). |
| TQ4 | useChatGenerationActions.test.ts | HIGH | L932 tautology + mock-on-mock "message appeared"; assert store/rendered outcome. |
| TQ5 | coreMLModelUtils "downloads sequentially" | MED | Asserts order that only holds by .map push order while impl uses Promise.all. Assert real ordering w/ dynamic out-of-order mock or drop the claim. |
| TQ6 | render tests w/ no getByText: TTSButton, ModelFailureCard, ImageGenAdviceCard, ToolAccordionStreaming, ModelsManagerSheet, McpAddServerSheet, PlaybackControls, KokoroTTSBridge | MED | Assert visible content/state, not just container testID. |

---

## Pre-existing: mid-chat model switch doesn't refresh chat state until remount - 2026-07-10
**instrument-and-revisit** | Reported on-device (iOS, gemma-4 local + remote), confirmed present on the
OLD build (NOT introduced by this PR's work). Loading a new model from within the Chat screen mid-
conversation does not update the screen's derived active-model state — not a freeze; navigating Home →
back re-syncs. Suspect useChatModelStateSync / the chat's derived activeModel not re-running after an
in-chat load (the model loads fine; only the screen's projection is stale). Fix separately with its own
on-device repro — do NOT bundle into the current release PR (scope + risk).

---

## Device-verification gate before release (PR #510) — MUST pass before shipping

Unverified-on-device changes that MUST be checked on the Android dev build (ai.offgridmobile.dev) + iOS
before shipping (§H — device-gate unverified fixes). Pull `Documents/offgrid-debug.log` and grep the
state-machine traces:

- **Platform-aware override memory floor** (700MB Android / 1200MB iOS, physical-based, no swap credit) —
  confirm a tight-memory LiteRT load refuses cleanly (no OOM) via `[MEM-SM]`.
- **doUnloadTextModelLocked now unloads the ACTIVE engine** (LiteRT eviction frees native memory) —
  confirm `[MEM-SM]` on a LiteRT→llama switch under pressure.
- **Readiness change:** ensureModelReady/ensureModelLoadedFn now require isModelLoaded() (desync guard).
- **Deterministic resend** (image turn re-runs the image pipeline via recorded modality, not a
  re-classify — the Android 1★ "Resend → model cannot be loaded" fix): confirm an image resend on-device
  re-generates the image (does not try to load a text model).
- **Native-first Gemma flip** (buildThinkingCompletionParams reasoning_format 'none'→'auto') — a RUNTIME
  behavior change. Run a Gemma4 thinking + tool-call flow; grep `[GEMMA-FALLBACK]`. If it NEVER fires →
  native 'auto' works → DELETE parseGemmaNativeToolCalls + Gemma `<|channel>` hand-parser branches (dead)
  + narrow the hand-parsers to the remote-only fallback. If it fires → keep the hand-parser as fallback.
  ('auto' may also fix OD13.) Must not ship in a beta until this device check passes (TestFlight is
  distribution-signed → no container logs; verify on the dev build first).
- **iOS collapsed thinking-box width fix** — screenshot check.
- **STOP-PATH CLUSTER (device-diagnosed 2026-07-13, offgrid-debug.log 18:12–18:16 + IMG_0143/44/45): one root, four symptoms.**
  Root: a stop during PREFILL cannot interrupt llama until prefill completes (~9s on a 2.6k-token KB
  context; 74s cold on CPU), and the app's stop path lies about idleness while the native context
  unwinds. Chain + fixes (each at its owning seam):
  1. `llm.ts stopGeneration()` sets `isGenerating=false` BEFORE awaiting `activeCompletionPromise`
     → readiness says free while native is busy. FIX: declare idle only AFTER the unwind await.
  2. `generationToolLoop` is stop/interrupt-BLIND: no abortRequested check between iterations, and a
     completion result with `interrupted:true, predicted=0` flows onward as a normal empty result →
     zombie follow-up completions after a stop (these held the engine → the 'LLM service busy' error
     on the next send, log 18:12:34), and the empty result renders the WRONG "No response /
     incompatible backend (K-quant on NPU/GPU)" card (IMG_0145) — model/backend were fine. FIX:
     surface `interrupted` from `llmToolGeneration`/`generateResponseWithTools` returns; loop treats
     interrupted as STOPPED (finalize partial, no further completions, no error card).
  3. Resend/busy-error path left the send button latched as a fake STOP with phantom "..." while no
     session was live (IMG_0144; `prepareGenerationImpl` clears on readiness-throw, so the latch is in
     the RESEND caller's state) — find the resend action's generating flag + clear on error.
  4. A stale "No response" error card is not cleared when a subsequent retry succeeds (IMG_0145→next).
  Tests owed: rendered chat — send tool turn → stop mid-prefill (fake native with delayed unwind
  honoring stopCompletion) → assert stopped-partial finalization, NO busy sheet, NO "_(No response)_"
  bubble, button back to send; immediate resend then succeeds.
- **RESOLVED 2026-07-14 (reload capability drift + silent GPU→CPU): root cause was NOT a second load
  path.** Device log 18:50 proved the reload ran the ONE loadModel pipeline and detected thinking
  correctly (`Model loaded ... thinking: true` at 18:50:30.409) — but `applyLoadedContext` published
  `this.context` (the isModelLoaded readiness signal) BEFORE the multimodal probe + capability
  detection, so the 18:50:27.733 send raced into a ~3.5s window and generated with stale
  `thinkingSupported=false`. Fixed: capabilities derived on the local context, published atomically
  (396bea25; journey reloadRaceKeepsThinking.rendered.redflow). The GPU symptom was a REAL init
  timeout (18:57:19 `GPU context init timed out after 8000ms`) falling back silently — now surfaced
  as an always-on system notice (gpuFallbackNoticeVisible.rendered.redflow); the meta also stops
  claiming the uncapped layer count. `reloadWithSettings` (the drifted copy, zero callers) deleted.
  Residual gaps, still open:
  1. **Fallback notice needs a conversation.** The notice renders as a system-info chat message; a
     GPU→CPU fallback on a load with NO active conversation (fresh chat, Home-screen load) has no
     surface. Decide a surface (chat placeholder card / header chip) and add a rendered test.
  2. **CPU fallback inherits OpenCL-shaped params.** When the OpenCL attempt times out, attempts
     2/3 reuse the OpenCL-coerced params (no cache_type → f16, flash_attn off) instead of
     rebuilding CPU params (user's q8_0 + flash attn). Fix at initContextWithFallback/loadModel:
     rebuild params for the CPU attempt; assert via WIRE-LLAMA-LOAD in a journey.
  3. **8s GPU-init timeout may be too tight for this device/model** (earlier runs DID get 24/36
     layers on the same phone). Device-verify whether a longer Adreno timeout restores GPU.
- **Manager sheet = the residency surface (agreed design, 2026-07-14).** Move "In Memory" out of the
  Select Model picker into the MODELS manager sheet: each modality row shows its model + a RAM chip
  when RESIDENT + a per-row eject (power glyph, muted red, right of the fixed-width type label so all
  four align as a control column; generous hitSlop; row tap still opens the picker). "Eject All"
  stays. Needs: per-row residency projection (text/image/voice/speech), per-type eject actions via
  the owning services (no engine branching in the view), rendered journey tests per row + falsifiers.
- **Concurrent-retry race journey test (owed).** The 'No response'-card race fix (per-turn
  ToolLoopOutcome) is covered by construction + the stop journey's no-card assertions; still owed a
  rendered journey that starts a retry BEFORE the stopped turn's classifier runs and asserts no card.
- **Kokoro TTS download bypasses the 3-slot concurrency cap** (device-reported, 2026-07-13). The TTS
  (Kokoro) model download does NOT respect `backgroundDownloadService`'s `MAX_CONCURRENT_DOWNLOADS = 3`
  admission cap — it starts immediately regardless of how many downloads are already running. Likely
  cause: the TTS start path passes `isSidecar: true` (or otherwise goes through the uncounted
  `beginDownload(counted=false)` branch), which is meant only for dependent sub-downloads (a vision
  model's mmproj) that ride alongside their main. Kokoro is a standalone model, so it should be counted
  and queued like any other. Fix: route the Kokoro/TTS download through the counted path (not sidecar)
  so it occupies a slot and queues when the cap is hit; add a test that enqueues > 3 including the TTS
  model and asserts it queues rather than starting immediately.
- **Onboarding litert download-warning: rendered test for the ModelDownloadScreen caller** (2026-07-13).
  The device-aware curated-litert warning decision (`curatedLiteRTDownloadWarning`) is now a single owned
  function called by BOTH the Models tab (`TextModelsTab`) and the onboarding screen (`ModelDownloadScreen`).
  It is covered by an all-branch pure unit test + a rendered test through the Models-tab caller. The
  onboarding caller is identical thin wiring but has no dedicated rendered test yet (mounting the full
  onboarding screen with device-init + Android litert rendering is heavier). Follow-up: add a
  `ModelDownloadScreen`-mounted rendered test (Android, 12GB) that taps the E4B litert download and asserts
  no "may exceed your device's memory" sheet — the exact device-reported surface (IMG_0142).

---

## Cosmetic voice-mode label (deferred from the 0.0.103 device session)

**Verdict: instrument-and-revisit.** During the 0.0.103-beta device session, two fixes landed (Lean
per-model eject + thinking-block width). A third item — a **cosmetic label/chip in voice mode**
rendering the wrong text — was deferred: it is purely cosmetic (no functional impact) and pinning the
exact wrong value needs a device-log pull, not code reading. Next device session: pull the live tail of
`offgrid-debug.log` from the `.dev` container, grep the `[*-SM]` traces while entering voice mode, read
the actual rendered label value, then fix in `pro/audio/` UI. NOT a release hazard.

---

## #510 audit follow-ups (deferred from the load-anyway/dedup fix batch, 2026-07-15)

- **Onboarding litert download-warning unreachable** (`ModelDownloadScreen.tsx:299`): fix is code-ready
  (route the over-budget-but-warnable card through the owned `curatedLiteRTDownloadWarning`) but blocked
  by a mockist test `__tests__/rntl/screens/ModelDownloadScreen.test.tsx:607` that asserts the buggy
  pre-filter. Per doctrine: update/delete that mockist test, then land the fix.
- **`ModelSelectorModal.test.tsx` is mockist** (jest.mocks our stores/services/hardware) — 44 tests over a
  fake store. The RAM-parity fix is really proven by `pickerRamMatchesResidencyChip.rendered.redflow.test.tsx`;
  replace this file with rendered coverage post-release. Source carries a harmless `s.settings?.` to keep it green.
- **Queued-message imageMode carry** (`useChatGenerationActions`/`generationService`/`useChatScreen`): a
  force-image send that gets queued loses its force flag (re-decided at 'auto' on drain). Needs the
  QueuedMessage interface + drain handler edited together — own PR.
- **huggingface.findMatchingMMProj strict migration**: keep the generic-single-projector case, refuse a
  projector naming a DIFFERENT model (E4B for E2B). Own download-listing matcher in mmproj.ts. See the
  it.failing at `huggingfaceProjectorStrictness.test.ts`.
- **Reclaim-aware pre-load gate**: in progress on its own branch (device-verify on 12GB Android before merge).

---

## DEVICE FINDING (2026-07-15, iPhone) — false "something else is generating an image" (stale IMG-SM lock)

Symptom: image generation refused with a message that something else is generating an image ("I can't
help you right now, you can reload the model") when NOTHING else was generating. Reloading the model
cleared it and generation started.

Mechanism: `imageGenerationService.generateImage` rejects when `isInFlight(state.phase)` is true
(imageGenerationService.ts:402). The known failure paths reset the phase (`_ensureImageModelLoaded`→`_fail`;
`_runGenerationAndSave` catch→`resetState`/`_fail`), so a DIFFERENT path leaves `state.phase` stuck
in-flight ('loading'/'enhancing'/'generating') — plausibly tied to a refused/slow SDXL load or an
interrupted 120s ANE compile. Reload resets the service state → clears the false lock.

NOT fixed yet (would be a speculative guard without a red-verifiable repro). TO PIN IT: reproduce on
device, `xcrun devicectl device copy` the `.dev` container's `offgrid-debug.log`, grep `[IMG-SM]` — the
stuck transition (a `phase X → <in-flight>` with no following reset) names the exact path. Then fix at
that seam + a rendered red-flow (image mode → trigger the stuck path → next generate must NOT report
"already generating"). Candidate hardening once pinned: a top-level try/finally in generateImage so no
throw can leave the phase in-flight, and/or a self-healing staleness check on the isInFlight rejection.

---

## #510 audit — remaining PARTIAL fixes (found during the finding→code verification, 2026-07-15)

These are honestly NOT fully closed by the load-anyway batch — logged so they are not lost:

- **STT terminal-failure has no override card.** The realtime dictation now RECOVERS via
  ensureWhisperForTranscription (free the generation model → retry) — the common case. But if that retry
  ALSO fails, transcriptionOutcome.ts returns a static "Couldn't load the voice model — free some memory
  and try again" string, NOT a reportModelFailure('stt', {onLoadAnyway}) card. There is no generation
  model left to free at that point, so there is genuinely nothing more to do — but the product rule
  ("any memory refusal offers Load Anyway on any type") is only PARTIALLY met for STT: recovery yes,
  terminal override no. reportModelFailure is now called for text/image/tts but NOT stt/embedding.
- **Embedding-model load failure never surfaces a card.** modelFailureHandler reserves an 'embedding'
  type but nothing calls reportModelFailure('embedding', …). A RAG/embedding load failure is still
  silent. Low user impact (embedding is background) but it violates the "nothing is silent" promise.
- **ModelPickerSheet:216 RAM display**: the fit VERDICT uses the owned fileExceedsBudget, but the
  displayed "~X GB RAM" number is a separate 1.5x estimate — the "(may not fit)" tag and the number can
  disagree at the margin. Assessed as by-design (verdict is authoritative; number is a hint) but noted.

---

## #510 audit — STT-terminal + embedding: VERIFIED WORKING-AS-DESIGNED (not bugs, do NOT "fix")

Re-examined the two items I earlier logged as "partial fixes needed". Code inspection shows both are
correct terminal states, NOT dead-ends — surfacing failure cards would be theater or a regression:
- **Embedding load failure**: `src/services/rag/retrieval.ts:43,53` catch a failed embedding load/embed
  and RETURN `ragDatabase.getChunksByProject` (keyword/FTS chunks) — search still works (graceful
  degradation). `toolEmbeddingRouter`/`generationToolLoop:821` likewise fall back to "use all tools".
  A reportModelFailure('embedding') card would interrupt a working degraded flow → NOT added.
- **STT terminal**: `ensureWhisperForTranscription` frees the generation model and retries; if whisper
  STILL won't load, whisper-alone exceeds the device → a genuine HARD limit. The "free some memory"
  string is the honest message; a Load-Anyway there is a guaranteed-fail no-op. The recovery IS the fix.
CONCLUSION: these two need no code change. Removed from the "to fix" list.

## #26 text-half (deferred, cosmetic-low)
ModelPickerSheet text RAM hint still uses formatModelRam's 1.5 default, not the backend-aware
textOverheadMultiplier the residency chip / TextTab use — so on a GPU backend the picker number can
read lower than the chip. Verdict (fileExceedsBudget) is correct; this is a display-number nicety.
Fix = pass settings.inferenceBackend into ModelPickerSheet + formatModelRam(model, textOverheadMultiplier(backend)).
Deferred to avoid a new HomeScreen-picker dependency right before release. Image half fixed.

## M5a (marginal, logged) — exact budget boundary untested
fileExceedsBudget's boundary (size == budget: `>` vs `>=`) has no test straddling the exact equality —
the verifier's `>`↔`>=` mutant survived. Off-by-one-byte at the budget edge; no user-visible impact
(a model exactly at the budget is a measure-zero case). Add a boundary test if fileExceedsBudget is
touched again. Not fixed now (marginal, near release).

## A1 mmproj fix — possible load-immediately-after-download vision race (2026-07-24)

**Verdict: instrument-and-revisit (LOW — unconfirmed). NOT a merge blocker; PR #605 verified on both
platforms.**

A1's fix is verified on-device on BOTH iOS and Android (ggml-org SmolVLM-256M → real vision answer;
`[WIRE-VISION] initialized:true, vision:true` on both; mmproj on disk as the correct
`smolvlm-256m-instruct-mmproj-Q8_0.gguf`, `mmProjFileExists:true`). So the naming/matching fix is
correct and complete on both platforms.

Watch-item: during the FIRST Android attempt — a messy sequence right after download, on a
non-debuggable build, with a system notification-permission dialog intercepting taps — a vision send
threw "Multimodal support not enabled". It did NOT reproduce on the clean debuggable run (model
downloaded+linked, loaded fresh → vision:true → correct description). Possible unconfirmed cause: a
model loaded text-only if loaded in the window before its mmProjPath is persisted on the record
(load-immediately-after-download race), OR just the permission-dialog interference. If a real user
reports vision failing right after a first download, instrument the load path: assert the model
record's mmProjPath is set before the first load, and re-derive multimodal if a mmproj is linked after
a text-only load.

---

## Personal Mesh (sync across macOS, iOS, Android) — 2026-07-30

First entry for Personal Mesh in this doc. Found by auditing the shared state machines in
`@offgrid/sync` against what the two apps actually wire, with Android in scope as a first-class
target. The shared layer is largely complete; these are the app-side holes.

**Closed in this pass (code + wired, NOT device-verified):**

| ID | Gap | Status |
|---|---|---|
| PM1 | Public core minted a second device identity (`getOrCreateLocalDevice` persisted a random id), so op-log provenance and version vectors were keyed to an identity absent from every roster and membership. `stateSyncService` used it directly while pairing used the fingerprint. | Fixed: core exposes display facts only; `getCanonicalLocalSyncDevice` is the one place an id is attached; a one-time pure migration re-attributes persisted ops. Needs device verification (matrix rows 5-6). |
| PM2 | Backgrounding Android suspended the process: mDNS, the TCP listener and in-flight transfers stopped while the peer still showed the device connected. Only WorkManager's download service was declared. | Fixed: `MeshResidencyService` dataSync foreground service + one TS contract both platforms satisfy, with the capability gap declared as data (iOS honestly reports `survivesBackground: false`). Needs device verification (matrix rows 18-21). |
| PM3 | Dead `devHarness` was a second identity minter behind a permanently-false flag. | Deleted. |

**Open:**

| ID | Gap | Verdict |
|---|---|---|
| PM4 | ~~Android reinstall orphans a licensed seat.~~ **By design, not a gap.** Android wipes the Keystore on uninstall so a reinstall mints a new fingerprint and consumes a seat. This is the exact case auto-eviction of the least-active installation plus user-driven device management already answers: the dead entry is by definition least-active, so it is what gets replaced. Closed. |
| PM5 | ~~No license-key revocation or rotation.~~ **Out of scope by product decision (2026-07-30).** We do not support revoking or rotating a key: if a key is compromised, that is the user's loss. Device eviction remains the only removal mechanism. Do not re-open this as a gap. |
| PM6 | ~~Two shared projections have zero callers.~~ **Wrong - both are rendered** (`KnownDevicesSection.tsx:78`, `DevicesScreen.tsx:2348`); the original grep excluded `shared/`. The real defect was the COPY: the confirmation said eviction "removes the pairing from both devices", omitting that the seat is freed and what happens to the target's saved licence. Fixed in shared: the copy now splits on reachability, so an offline device is told cleanup stays queued rather than claimed already clean. Closed. |
| PM7 | **Devices UI never audited against the brief's state table.** Both platforms consume `projectSyncControlCenter`, but nobody has checked all six credential x registered x paired x connected rows render distinctly, that capacity reads "N of 5 registered", or that roster freshness is shown rather than stale data presented as authoritative. | audit. Matrix rows 39-42. |
| PM8 | **The four riskiest areas have zero verified coverage.** The iOS/macOS manual gate (`desktop/outputs/ios-macos-sync-manual-gate-20260729`) is 8/108 verified: pairing 0/9, discovery 0/9, membership 0/7, persistence 0/5. It also has no Android axis at all, and defers the five-device cap as needing real multi-device hardware. | superseded by `docs/PERSONAL_MESH_TEST_MATRIX.csv` (42 rows, macOS/iOS/Android columns). |

| PM9 | ~~No receive-side consent.~~ **Out of scope by product decision (2026-07-30).** Same-owner devices auto-accept, which is what AirDrop does between devices on one Apple ID; Personal Mesh is same-owner-only by definition, so a prompt would be friction with no threat model behind it. The `admitIncoming` gate exists in shared but stays unwired, so behaviour is accept-everything. Do not re-open as a gap; if a shared/family mesh ever ships, that is when the gate gets a policy behind it. |

| PM10 | **Android has no screenshot watcher, so automatic screenshot sharing cannot work.** `ScreenshotSyncSource` calls `nativeScreenshotBoundary.observe()` and swallows the failure with the comment "Android and older iOS builds do not expose this native watcher". iOS ships `ios/SyncScreenshotModule.swift`; there is no Kotlin counterpart (`android/.../ai/offgridmobile/` has clipboard, devicememory, directory, download, litert, localdream, pdf, sync - no screenshot). The UI therefore reports "automatic sharing is not available" on Android. This is the platform-parity rule violated exactly as rules.md describes it: a capability that exists on one platform and silently no-ops on the other. | real gap, user-reported 2026-07-30. Android CAN do this: a `ContentObserver` on `MediaStore.Images` filtered to the Screenshots bucket. Until then the gap must be declared capability DATA, not a swallowed throw. |
| PM11 | **"For your safety, share another folder" when sharing Downloads on Android is the OS refusing, not our bug.** `SyncDirectorySourceModule.kt` uses the Storage Access Framework (`DocumentsContract` tree URIs), and Android 11+ refuses to grant SAF access to the `Download` directory (and `Android/data`, `Android/obb`) - that sentence is stock Android picker copy. So the app offers Downloads as a share target and the OS then declines it, which reads to the user as our failure. | real gap, user-reported 2026-07-30. Fix is not a permission: on Android, enumerate downloads through `MediaStore.Downloads` (API 29+), which needs no SAF grant, and stop routing that category through the folder picker. Do NOT retry SAF against Download - it cannot be granted. |
| PM12 | **Late-pair full graph has service-level proof but no real Desktop-to-Mobile app journey.** Shared anti-entropy now handles more than 10,000 ops and byte-bounds large chat records. Mobile integration tests prove exact generated-image, attachment, and knowledge-document bytes across two real sync engines. Desktop separately proves exact late-pair bytes with SQLite and a temporary filesystem. | Open verification gap, 2026-08-13. Pair the actual apps only after project settings, chat text, enhanced prompt, reasoning, a completed tool, image, attachment, and knowledge document exist. Verify all records and bytes after pairing and after receiver restart, in both directions, on physical iOS and Android. |

**Verified as already correct (no code needed):**

- **Android discovery and advertise.** `react-native-zeroconf` acquires a `MulticastLock` in both its NSD and rx2dnssd backends, `CHANGE_WIFI_MULTICAST_STATE` is declared, and Android supports `registerService`, so it advertises rather than only browsing. Android reports `['lan']` while the iOS-only proximity route surfaces as route data - the capability-as-data pattern, not a `Platform.OS` branch.
- **Clipboard provenance.** Records carry immutable `provenance` plus a derived `isLocal`, so an Off Grid receipt is attributed to the sending device and an Apple Universal Clipboard pickup is recorded as a local pasteboard observation - never as an Off Grid transfer. Android has no Universal Clipboard, so that false-attribution risk does not exist there.

### RESOLVED: Forget did nothing on a licensed device this phone never paired with

Fixed. An eviction's local side may now be empty: `prepareCapacityReplacement` no longer refuses when
there is no active pairing, and `finalizeMembershipEviction` owns the rule that an empty local side is a
no-op (both the immediate and the restart-recovery path go through it). The failure is also no longer
swallowed - `KnownDevicesSection` reports it on the same error surface disconnect and reconnect use.
Covered by `licensedDevices.integration.test.tsx`, which asserts the seat comes back at the PROVIDER.

Original report follows.

**Symptom.** Sync lists a device that holds a seat on your licence but that this phone has never paired
with - a phone you replaced, say. Its row offers Forget, the button is enabled, tapping it opens the usual
confirmation sheet, and confirming "Evict device" does **nothing at all**: no error, no change, the seat
stays occupied. At the device cap this leaves you unable to pair a new device with no explanation.

**Mechanism.** `syncService.forgetDevice` -> `evictDevice` -> `PersonalMeshDeviceEvictionCoordinator.evict`
-> `membership.prepareEviction` -> `pairingSecretStore.prepareCapacityReplacement`, which requires an
active LOCAL pairing:

    const active = activePairing(installation.syncDeviceId);
    if (!active?.membershipId) throw new PersonalMeshEntitlementError('mapping_required');

There is no local pairing for such a device, so it throws `mapping_required` ("The oldest licensed
installation cannot be matched to a Sync device.") BEFORE `registry.deregisterInstallation` is reached.
The seat is therefore never released. `SyncScreen/index.tsx` then calls
`syncService.forgetDevice(deviceId).catch(() => undefined)`, so the failure never surfaces.

Note the coordinator already has a path for exactly this shape - `revokeUnregistered`, used when the
registry has no installation for the device - but it does not cover the mirror case: the registry HAS the
installation and the local device has no pairing.

**Two separable defects, worth deciding on separately:**
1. The eviction cannot release a seat without a local pairing, when releasing the seat is the entire point.
2. The failure is swallowed, so a broken action is indistinguishable from a working one. Even once (1) is
   fixed, an eviction that fails for a real reason (offline, provider error) will still look like nothing
   happened. This is the "dead button" class in the backlog: capability and handler should travel together
   so a button that cannot act is not offered as if it can.

Check whether desktop has the same hole: its own `prepareEviction` may impose the same requirement, and
the ghost-row report there ("repair asks for a pairing code") is the same underlying situation.

### WITHDRAWN (not a bug): "after a failed credential save, a device appears to pair and never does"

Reported here earlier today and WRONG. The pairing did land; entitlement reconciliation then retired it,
deliberately, because the peer held no installation on the licence. `personal-mesh-entitlement.ts` retires
any device it finds locally trusted but absent from the authoritative roster - that is the rule that stops
a device lingering in your mesh after it has been removed from your licence elsewhere.

The test was at fault: its stand-in desktop never registered, which no real licensed Mac does. Registering
it makes the whole journey pass, including the clean retry after a storage failure. The trust surviving
reconciliation is now asserted, which is the part that matters - a pairing whose trust is withdrawn a
moment later still reports success on its way past.

Worth keeping in mind when reading a device log: "paired, then gone" is the signature of a device missing
from the licence roster, not of a broken handshake.


### Open bug: evicting an OFFLINE device may not leave the eviction outstanding

Found by `__tests__/pro/sync/syncPersistence.integration.test.ts` ("keeps an offline eviction pending
across restart and completes it on rediscovery"). Two of that suite's three journeys pass; this one does
not. Held open. Not fixed.

**What should happen.** Evicting a device that is not reachable releases the licence seat immediately and
leaves a PENDING revocation, because the other device still holds trust that has to be withdrawn when it
next appears. That pending record is what survives a restart and completes on rediscovery.

**What happens.** No pending revocation is persisted, so there is nothing to restore after the restart.

**Where to look.** `PersonalMeshDeviceEvictionCoordinator.evict()` announces the registry change BEFORE it
finalises the transaction:

    await this.options.onRegistryChanged?.(installation)
    await this.options.membership.finalizeEviction(token)

On mobile that announcement runs reconciliation, and reconciliation calls `resumeCommittedEvictions()`,
which finalises every committed transaction - including the one the caller is holding. So the local trust
is retired by the recovery path rather than by the caller, and which of them stages the peer's revocation
depends on which got there first.

That ordering also made eviction report `replacement_failed` after succeeding, because the caller then
finalised a transaction that no longer existed. That half is fixed: finalising an already-finalised
transaction is a no-op rather than an error (finishing twice is not a failure; finishing something never
committed still is).

**And it is not an occasional race - it is the normal flow.** Coverage over the sync suites shows the
caller's finalize reaching only the already-finalised branch: the lines that actually retire the local
trust and complete the transaction
(`pairingEntitlementReplacementAdapter.ts` 66-75) are never executed at all, while the no-op branch
above them always is. Every eviction is therefore completed by the recovery path, and the code that
reads as the main path is dead in practice.

So the answer to "should the announcement happen before the transaction closes" is no. Until it moves,
the adapter's finalize is a formality and `resumeCommittedEvictions` is the real implementation - which
is worth knowing before anyone edits either of them.

## Deleting the mockist ChatScreen suite leaves real ChatScreen journeys uncovered

`__tests__/rntl/screens/ChatScreen.test.tsx` was deleted: 155 tests that rendered ChatScreen with FOURTEEN
of our own modules stood in for. Coverage it reported was not coverage of our behaviour - the stubs answered
most of the questions the assertions asked - so the number was inflated rather than earned. Measured before
deleting, over `src/screens/ChatScreen/**`:

|                | mockist suite (155 tests) | rendered suites (227 tests) |
|----------------|---------------------------|-----------------------------|
| statements     | 70.72%                    | 62.93%                      |
| branches       | 63.45%                    | 57.47%                      |
| functions      | 69.17%                    | 58.56%                      |
| lines          | 73.88%                    | 64.74%                      |

The 8-point statement drop is the honest number, and it is concentrated. These are the journeys that now
have NO real coverage, and each wants a rendered test through `harness/chatHarness` (real screen, native
faked) rather than a re-mocked one:

- `ChatModalSection.tsx` (70% -> 30%) - the modals reachable from a chat: which one opens from which
  affordance, and that dismissing returns the user to the conversation rather than a blank screen.
- `useChatMessageHandlers.ts` (80% -> 53%) - per-message actions: edit, retry, copy, delete, speak. A dead
  action here is invisible until a user long-presses a message and nothing happens.
- `useChatModelActions.ts` (66% -> 42%) - switching model mid-conversation, and what happens to a reply in
  flight when the user does.
- `ChatScreenComponents.tsx` (89% -> 58%), `modelReadiness.ts` (56% -> 48%), `index.tsx` (63% -> 54%).

Policy this follows: a mockist suite is deleted, not repaired, and the coverage it was claiming is logged
here as a gap instead of being carried as a green number. Lower and true beats higher and fake.

## Image-generation journeys left uncovered by deleting imageGenerationFlow.test.ts

`__tests__/integration/generation/imageGenerationFlow.test.ts` was deleted: 60 tests that stood in for
`localDreamGenerator` (the image generator itself), `activeModelService`, `llm` and `litert`. Six of its case
names end in a line number - "should call stopGeneration after successful enhancement (line 247)",
"(lines 253-255)", "(lines 290-292)" - which is what a test written to move a coverage number looks like
rather than one written to protect a user.

Already covered properly by rendered suites, so not re-created: draw-prompt routing (`imageIntentRouting`),
force/off image mode (`imageModeToggle`), the OOM card and Load Anyway (`imageOomCard`, `imageMemoryCard`),
lightbox + save-to-gallery (`imageLightbox`), voice-mode image journeys, and the enhancement rules
(`enhancementNoThinking`, `enhancementReasoningPrompt`, `enhancementStreamingProgress`).

Rewritten for real in `imageGenerationInFlight.rendered.guard.test.tsx`: STOP reaching the native generator,
progress moving on the card, and a second send not starting a second diffusion.

STILL UNCOVERED, each a real user-visible journey wanting a rendered test:

- **image backend metadata on the finished message.** The per-message details should name the backend that
  actually rendered it (QNN / MNN / Core ML). Wrong or missing backend attribution is how a user concludes
  the NPU is being used when it is not. (`gpuBackendMeta` covers the TEXT side only.)
- **enhancement conversation context rules.** The enhancement request carries recent chat context, capped at
  the last 10 messages, with system messages skipped and long messages truncated. Uncapped context is a
  silent context-window overflow on a small model; including system prompts leaks instructions into the
  rewritten image prompt.
- **image model auto-load on demand**, and reload when the thread count changed. A user who generates,
  changes threads in settings, then generates again must not silently keep the old context.
- **generating with no conversation open** saves to the gallery without trying to add a chat message.

Policy: the mockist file is gone rather than repaired, and what it was claiming is written down here instead
of carried as a green number.

## Two real-sqlite adapters for one boundary (harness DRY)

`__tests__/harness/sqliteFake.ts` exposes `installRealSqlite` / `doMockRealSqlite`, backing the op-sqlite
boundary with a real `node:sqlite` in-memory database. `__tests__/hardening/batch9-kb-roundtrip.test.ts`
hand-rolls the SAME adapter inline (`makeInMemoryDb`, its own `toParam` blob conversion, its own
transaction/DDL special-casing). Both are real sqlite and both are correct today, which is the problem: the
next schema change (or the next blob column) has to be understood twice, and a divergence between them would
show up as a knowledge-base test failing for reasons that have nothing to do with the knowledge base -
exactly the failure mode batch9's own header describes from its previous hand-rolled matcher.

Fix: batch9 requires `doMockRealSqlite` from the harness and deletes its private engine. Low risk (both
already pass over real sqlite), and it makes the harness the single definition of that boundary.

## Ejecting a model mid-reply unloads the engine WITHOUT stopping the generation

**Verdict: fix-the-guard (live bug, observed in a rendered test).**

In chat, the model chip opens `ModelsManagerSheet`, whose per-row eject (`models-row-text-eject`) calls
`ejectResident` -> `modelResidencyManager.evictByKey`. That path never touches the generation owner.

Observed with a LiteRT reply still streaming (rendered ChatScreen, native LiteRT faked, real everything else):

| native call | times called |
|---|---|
| `unloadModel` | 1 |
| `stopGeneration` | **0** |

So the engine is torn down while a generation is still running against it. On a device that is a native
generation pointed at a released context - a crash or a hang rather than a clean stop - and at best tokens
arriving for a model that no longer exists.

This is the same abstraction failure as the three `llmService.stopGeneration()` bypasses (fixed: two now go
through `generationService.stopGeneration()`, the mid-turn compaction retry through `stopAllTextEngines()`),
but in a fourth place and one layer lower. The residency manager evicts on its own authority - which is right
for an idle sidecar and wrong for the model that is mid-reply.

Likely fix: `evictByKey` (or its callers) must stop generation on the owner first when the key being evicted
is the model currently generating - not eject-then-hope. Wants a device check too: eject mid-reply on a LiteRT
model and watch for a native crash.

Related, and why the fix above is not enough on its own: `handleUnloadModelFn` - the `ModelSelectorModal`
"Unload" button - is no longer reachable from chat's model chip at all. Either that modal is dead surface
from ChatScreen (it is still mounted, and still reachable from ChatsListScreen) or the sheet should route
through it. Worth deciding which, because right now two unload affordances exist with different behaviour.

## Revoking ambient sharing does not cancel a transfer already streaming

**Verdict: fix-the-guard (needs a cancellation seam that does not exist).**

Turning ambient sharing off now revokes the grant atomically with the policy write (mobile-pro f36bf909) and
reconnect no longer resurrects it (ebdc8cd8). What is still true: a transfer whose bytes are already moving
runs to completion, so that one file arrives after consent was withdrawn.

There is no handle to cancel it with. `fileTransferService.cancel(deviceId, requestId)` exists, but the ambient
delivery lifecycle exposes only `completed()` and `failed(error)` to the scheduler, and the send happens under
an `activityId` (`sharedFileActivityId(deviceId, syncId)`) with no mapping back to the transfer's requestId.

The fix is a dependency-surface change, not a patch: add `cancelDelivery(deviceId, syncId)` to
`AmbientShareDependencies`, have `sharedFileSyncService` implement it by resolving the syncId to its in-flight
requestId and calling `fileTransferService.cancel`, and call it from the revocation path. Three call sites
supply those dependencies today (`sharedFileSyncService` plus two test harnesses), so the change is contained -
it was deferred because it widens the sync core's contract and deserves review rather than an end-of-branch
edit.

Bounded until then: the exposure is one already-streaming file, not every reconnection from then on. Raised by
Greptile on mobile-pro#47, where the thread is deliberately left open so the seam stays tracked.

---

## A tool-heavy turn's FINAL ANSWER reaches peers LONG after its tool calls do

**Verdict:** instrument-and-revisit — the delay is real and large; the trigger is unknown.

Observed 16 Aug 2026, run `iostools20260816161658`, guided six-tool journey driven from iOS.

iOS finished the turn completely: thinking block, six tool calls, and a full answer
("Off Grid AI & OGAM — Complete Overview", OGAM as a Product, Business Metrics…). macOS and
Windows both hold the same conversation and **every tool call**, read straight off each desktop:

```
messageCount: 16, hasMarker: true
tail: … read_wiki_structure Completed in 1611 ms / read_wiki_contents Completed in 3872 ms /
      ask_question Completed in 17045 ms / search_knowledge_base Completed in 550 ms /
      search_knowledge_base Completed in 758 ms / ask_question Completed in 14718 ms
hasOgamOverview: false
```

At that moment the transcript on both desktops ENDED at the last tool call, with no assistant
message after it. It did arrive later - Mac saw it appear on every device some minutes afterwards -
so this is LATENCY, not loss. The delay was long enough to read as a failure while watching.

How long, and what finally triggered it, are NOT yet measured. A first reading claimed the answer
never synced; that was wrong, and a second reading could not be compared because the desktops had
moved to a different conversation by then. Measure it properly before theorising: stamp the moment
the primary settles, then poll ONE peer on that same conversation until the answer appears, and
report the interval.

**Why it matters:** the mesh looks healthy. The conversation is there, the tool activity is there,
timings are there. A user on their Mac sees a turn that apparently did a lot of work and concluded
nothing. It reads as the model failing, not as sync dropping the last message.

**Where to start:** whatever writes tool-result/artifact events syncs; the terminal assistant
message for a long tool-using turn does not. Compare against the plain `run-normal` journey, whose
final answer DOES reach all four devices - so this is specific to the tool-heavy path or to message
size, not to sync in general.

---

## "Preparing reply" state never reaches peer devices

**Verdict:** instrument-and-revisit.

While the primary device is working, peers show nothing. There is no "preparing reply" or thinking
indicator on the other devices, so a person watching their desktop cannot tell the difference
between "my phone is mid-answer" and "nothing is happening". Reported by Mac, 16 Aug 2026, during
the guided journey.

Related to the entry above: the peers do eventually receive tool events, so SOMETHING streams -
what is missing is any signal that a turn is in flight.

---

## DeepWiki `ask_question` returns a validation error

**Verdict:** fix-the-guard.

In the guided six-tool run the model reported, in its own thinking:

```
ask_question - FAILED due to validation error, but the tool was attempted/triggered
```

The desktops show `ask_question Completed in 17045 ms` and again `Completed in 14718 ms`, so the
call is dispatched and returns - it is the arguments or the response shape that fail validation,
not the transport. Five of the six named tools (search_knowledge_base, web_search, read_url,
read_wiki_structure, read_wiki_contents) succeeded in the same turn.

Worth checking what the DeepWiki MCP server expects for `ask_question` against what is being sent.

---

## Test coverage we know we are missing (Mac's list, 16 Aug 2026)

**Verdict:** instrument-and-revisit — none of these are known failures. They are capabilities we
ship and do not exercise, which is how today's defects survived: the PDF-in-a-message bug had been
predicted from a diff for VOICE NOTES weeks earlier and was only found when someone actually sent
one.

### Models and hardware

- **Huge models — eviction and co-residency.** Run with something like Qwythos 9B (5.5 GB) and prove
  eviction and co-residency behave: what gets unloaded, what survives, and that the device does not
  die instead of evicting. iOS matters most here - a memory breach there is an uncatchable jetsam
  SIGKILL, so the engine's GPU→CPU→CPU@2048 ladder cannot save it.
- **GPU and NPU selection.** Prove the chosen backend is the one actually used, read back from
  "show generation details" rather than assumed from a setting.

### Voice

- **Voice mode end to end** - STT in, TTS out, on a real device.

### Clipboard

- **Copying OUTSIDE the app** reflects in the in-app clipboard, on both Android and iOS.

#### Android external clipboard capture is not available through Accessibility

**Verdict:** platform-limit; replace the false automatic path with an explicit Android
`ACTION_PROCESS_TEXT` selection action.

Verified on a physical Android 16 Oppo device on 2026-08-20. Clipboard Sync was enabled, the React
Native observer was active, and Android reported `SyncClipboardAccessibilityService` as both enabled
and bound. A Chrome select-all followed by the system floating-toolbar Copy still produced no local
clipboard item:

- Chrome emitted no `TYPE_VIEW_TEXT_SELECTION_CHANGED` event for the selection.
- The system floating toolbar emitted no Accessibility event for its Copy action.
- `ClipboardManager.OnPrimaryClipChangedListener` was not called while Off Grid was in the
  background.
- `flagIncludeNotImportantViews` did not change those results.

This is the Android security contract, not a permission-refresh bug. From Android 10, a background app
cannot read clipboard data unless it has focus or is the default input method. An Accessibility grant
is not an exception. The current service can help only in apps and system builds that voluntarily emit
both the selection and Copy events, so it cannot support the product claim that anything copied on
Android is captured.

The maintainable end state is an explicit `ACTION_PROCESS_TEXT` action in Android's text-selection
menu, labelled "Copy to Off Grid". The selected app sends the text directly to Off Grid under the
user's tap, so no background clipboard read, default-keyboard role, focus-stealing overlay, polling,
or broad screen traversal is required. The Android UI must describe this explicit action and must not
present Accessibility as universal clipboard access. Keep the existing native observer only as a
best-effort capability where the OS supplies the required events.

### Ambient sharing, both ways round

Each of these needs the negative case as well as the positive, because a permission that fails open
is invisible when you only test that sharing works:

- screenshots ARE synced when allowed / are NOT synced when disallowed
- downloads ARE synced when allowed / are NOT synced when disallowed

### Model transfer between devices

F6 code evidence on 2026-09-11 proves explicit capability advertisement, preservation through saved
and discovered device facts, encrypted package transfer through the real Shared engines, manifest
validation, and a stable rendered transfer sheet while peer projections refresh. The development
bundle also loads in the iOS simulator and publishes discovery. Keep the physical gate open: run a
real multi-GB transfer in both directions, interrupt and resume it, load the received model, compare
both device states, and complete the visual review. This task did not control the UI, and no physical
phone was available.

- image models send and WORK on the receiver
- vision models send and WORK on the receiver
- text models send and WORK on the receiver
- STT models send and WORK on the receiver
- the right models are offered to send, based on what the RECEIVER is

"Arrives" and "works on the receiver" are different claims, and only the second one is the feature.

### The ones Mac's list did not name, ranked by what they would cost us

Highest risk first, because these are the ones where the failure is silent or unrecoverable rather
than merely wrong.

1. **Peer-pushed model settings, with no device-fit check.** `contextLength`, `maxTokens`,
   `gpuLayers`, `nThreads` and `nBatch` are writable by a paired desktop and validated for TYPE and
   RANGE only - never against what the receiving device can actually honour. Desktop offers maxTokens
   up to 32768 and ctxSize up to 131072; a phone sitting at 4096 accepts them. The mutations are
   per-key, so a maxTokens change alone lands on a phone whose context never moved, giving
   `n_predict > n_ctx` - llama.cpp rejects the turn before inference while the settings screen still
   reads 4096. On iOS the memory case is worse than wrong: a breach is an uncatchable jetsam
   SIGKILL, so the engine's GPU→CPU→CPU@2048 fallback ladder cannot catch it. There is in-repo
   precedent - appStoreMigrations.ts documents a removed MCP auto-boost that pinned context to 32768
   and caused OOM crashes needing a repair migration. Sync can now reproduce that state from a peer,
   with no migration to undo it. **Test: push each of those keys from desktop to a phone that cannot
   honour them, and to an iPhone specifically.**

2. **`maxToolCalls` is synced as well.** A peer set to 1 turns a single-tool request into a "tool
   limit reached" notice instead of an answer. The default also moved from 3/5 to 25.

3. **"Arrives" and "works on the receiver" are different claims.** Worth stating explicitly against
   every transfer item above: only the second one is the feature. A model that lands and will not
   load is a failure that a transfer test scores as a pass.

4. **Every non-image attachment kind except PDF.** describeAttachment now classifies audio and video,
   but only PDF has been SEEN working end to end. The voice note is the exact case this defect was
   predicted for in the v0.0.103 review and it remains unproven on desktop.

5. **A receiver that does not already have the model** - the download-on-demand path, as distinct
   from transfer between two devices that both happen to have it.

6. **Interrupted transfers** - background the app, drop wifi, lock the phone mid-send, then resume.

7. **Offline behaviour.** Entitlement reconciliation reports "License service unavailable" with no
   network. Prove offline access genuinely stays usable rather than degrading into a lock-out - the
   home screen already had one of those, where a card that was still loading had no way into Sync.

8. **The five-device replacement flow** at the licence limit, including the failure mode where the
   oldest membership cannot be removed (`replacement_incomplete`).

9. **The vision journeys still only run from Android.** vision-image-sync and vision-answer-sync are
   Android-hardcoded. The iOS system photo picker exposes no addressable cells - only PXG* layout
   groups and one concatenated label - so the iOS path needs the geometric-tap approach now used in
   multi-attachment-sync.

---

## Model memory: the estimate is unscientific, inconsistent, and fails silently

**Verdict:** fix-the-guard — three defects in one decision, found together on 16 Aug 2026 when
Qwythos 9B (5.5 GB) would not load on an iPhone and the chat sat unusable with no explanation.

### 1. The estimate ignores context length, which is the term that actually varies

```ts
estimateModelRam(model, multiplier = 1.5) {
  return this.getModelTotalSize(model) * multiplier   // file size only
}
```

Observed: `[MEM-SM] makeRoomFor text sizeMB=12387 budgetMB=9121 os_procAvailMB=5189 fits=false`.
That 12387 is 5632 MB x 2.2. Reducing the context length to ~1k made the same model load
immediately - the gate never saw the change, because context is not an input to it.

Real memory decomposes as:

```
total = weights + KV cache + compute buffer + slack
KV_bytes = 2 x n_layers x n_kv_heads x head_dim x n_ctx x bytes_per_element
```

Only WEIGHTS scale with file size. For a 9B with ~48 layers and GQA (8 KV heads x 128), f16 KV is
roughly 196 KB per token: ~0.2 GB at 1k context, ~1.5 GB at 8k, ~6.3 GB at 32k, ~25 GB at 128k. A
single file-size multiplier is being asked to hide a 100x spread, so it must be wrong in one
direction or the other - it refuses big models that would fit at small context, and admits small
models at 131072 context that will not. On iOS the second case is an uncatchable jetsam kill.

Everything needed is already available: the GGUF header carries block_count,
attention.head_count_kv, attention.key_length/value_length and context_length; llama.cpp prints its
own tensor, KV and compute buffer sizes at load; and `[WIRE-RAM] footprintBytes` is already logged
after every load, so predicted-vs-real can be calibrated per backend from real runs. This is how
Ollama's scheduler decides layer offload, and what the HF/LM Studio calculators do.

### 2. The multipliers are not derived from anything

`TEXT_MODEL_OVERHEAD_MULTIPLIER = 1.5` is commented only "CPU: KV cache, activations, etc."
`TEXT_MODEL_GPU_OVERHEAD_MULTIPLIER = 2.2` was chosen to "mirror the image estimator's
ANE(1.8)->GPU(2.5) bump" after ONE device incident (2026-07-14, 8.2 GB estimated against 11.4 GB
real). The file above them records that flat percentages were removed because they "wrongly treated
a 12GB iPhone like a 6GB one" - a flat multiplier makes the same mistake one level down, treating
every model's runtime shape as proportional to its file.

### 3. Two owners compute it differently, and one of them fails silently

```ts
// modelPreloader.ts - default 1.5x, and a bare return
const sizeMB = toMB(hardwareService.estimateModelRam(model));
if (!modelResidencyManager.canLoadWithoutEviction({ key: 'text', sizeMB })) return;

// activeModelService/index.ts - backend-aware 2.2x on GPU
estimateModelRam(model, textOverheadMultiplier(store.settings.inferenceBackend))
```

For Qwythos that is 8448 MB versus 12387 MB - the preloader believes it fits and the authoritative
gate refuses. Two answers to "how much memory does this model need", kept in step by hand.

**No silent drops.** A refusal is a decision the user has to be told about. Today the only trace was
`fits=false` in a debug log, while the chat still said "Type a message below to begin chatting with
Qwythos" - a model that was never coming. Whatever the gate decides, the surface must say so, name
the numbers (needs X, budget Y, free Z), and offer the actionable next step - lower the context
length, choose a smaller model, or free memory - rather than leaving a chat that looks ready and is
not.

### How to fix it: one owner, a real formula, and a card that tells the user

**One owner.** memoryBudget.ts is already documented as "the single memory-budget owner ... so
residency, the pre-load check, and the model lists all agree". The ESTIMATE needs the same
treatment: one `estimateModelMemory({ model, contextSettings, backend })` that modelPreloader,
activeModelService, the model lists and the UI all call. Today modelPreloader answers 8448 MB and
activeModelService answers 12387 MB for the same model.

**A real formula.** PocketPal (github.com/a-ghorbani/pocketpal-ai, src/utils/memoryEstimator.ts)
does exactly the decomposition, and it is worth copying:

```
total = (weights + KV cache + compute buffer) * 1.1        // 1.1 on a COMPUTED number
KV    = n_layers * effectiveCtx * n_embd_head_k * n_head_kv * bytesPerK
      + n_layers * effectiveCtx * n_embd_head_v * n_head_kv * bytesPerV
compute = (n_vocab + n_embd) * n_ubatch * 4
fallback when GGUF metadata is missing = size * 1.2
```

Details they get right that a multiplier cannot express:

- KV cache quantisation is exact, not assumed: f16 2.0, q8_0 1.0625 (34/32), q4_0 0.5625 bytes per
  element, and K and V are computed separately because they can be quantised differently.
- Sliding-window attention: `effectiveCtx = min(n_ctx, sliding_window)`, so a Gemma-style model is
  not charged for KV it will never allocate.
- The mmproj (vision projector) is added separately rather than folded into a multiplier.
- Metadata is validated first (NaN / non-positive / missing), falling back to size * 1.2 rather than
  silently computing nonsense.

Their BUDGET side is calibrated rather than assumed:

```
ceiling  = max(largestSuccessfulLoad, availableMemoryCeiling)
fallback = min(totalMemory * 0.6, totalMemory - 1.2GB)
status   = fits | warning (fits in total but not in ceiling) | will not fit
```

They learn the ceiling from the largest model that has actually loaded on that device. We already
log `[WIRE-RAM] footprintBytes` after every load, so the same calibration is available to us - the
difference is we throw the measurement away and they keep it.

**A card that tells the user.** MtpAdviceCard is the existing in-chat pattern: dismissible, a title,
and ONE action ("Turn on speculative decoding and reload the model"), rendered from ChatMessageArea.
A memory refusal belongs there, naming the numbers and the way out:

  "Qwythos 9B needs about 12.4 GB at 32k context. This device has 12 GB."
  -> Reduce context to 8k and load  /  Choose a smaller model

Silence is the defect. Today the only trace of the refusal was `fits=false` in a debug log while the
chat said "Type a message below to begin chatting with Qwythos" - a model that was never coming.

---

## A synced file can deadlock: bytes arrive, control never re-applies (16 Aug 2026)

**Symptom, from the device.** An image generated on iPhone rendered on macOS, Windows and iOS but
stayed a spinner on Android. The gallery counted it (`1`) while the grid showed nothing - the file was
staged but never imported.

**The evidence (Android logcat, 21:02:33):**

```
[StateSync] ops from=9d25c24e received=1 applied=0 shared_file:1
transfer_offer_accepted  resumeOffset=504593  delivered=true      <- already had every byte
shared_file_decided      result=waiting_for_control  reason=control_missing
transfer_settled         status=completed  bytes=504593
```

`received=1 applied=0` repeats. Per `state-sync.ts:102`, that means the op was ALREADY KNOWN.

**The loop.** It is self-sustaining and silent:

1. Android holds the bytes AND holds the `shared_file` control op in its oplog.
2. `ControlledFileSync.controls` (an in-memory `Map`, `controlled-file-sync.ts:204`) has no entry for
   that syncId, so reconcile answers `control_missing`.
3. `sharedFileSyncService.ts:337` correctly asks the peer to repair the `control`.
4. The peer answers by re-announcing (`shared-file-repair.ts:320`). `OpLog.record` returns the
   already-recorded op unchanged, so it carries the SAME opId.
5. Android dedups it by opId -> `applied=0` -> the materializer never fires -> `applyControlPut` is
   never called -> the map stays empty. Back to 2, forever.

**This is the SSOT failure `shared/CLAUDE.md` describes.** Two sources answer "does a control exist for
this file": the durable oplog (yes) and the in-memory `controls` map (no). They are kept in step by
hand - the map is only ever written by an op that APPLIES - so any op already in the log leaves the map
cold, and version vectors then stop the peer from ever helping. `oplog.ts:198-200` names this exact
hazard: "an ephemeral materializer cannot recover and peers correctly decline to resend already-seen
ops."

**Not mobile-specific.** `controlled-file-sync.ts`, `oplog.ts` and `shared-file-repair.ts` are all in
`@offgrid/sync`. Every host shares the defect; Android is the device that hit the cold-map condition.

**Still open - why the map was cold.** `stateSyncService.ts:217` DOES call `rematerializeAll()` on
start, which should rebuild it. Two untested candidates:
- `parseControl` returned null on replay, so `applyControlPut` returned `"ignored"` and never set the
  map (`controlled-file-sync.ts:222`) - a silent drop by itself.
- `compact()` (`stateSyncService.ts:221`) dropped the superseded control op while the version vector
  kept claiming it, so there is nothing left to replay but peers still refuse to resend.

**The fix shape (do not implement yet).** Make the durable log the only source: rebuild `controls` by
replaying the log, and make a `control` repair request force re-materialisation of that syncId rather
than re-broadcasting an op the peer will discard. A repair that cannot make progress must surface -
a file waiting on a control that will never come is exactly the silent drop we said we cannot afford.

**Cover it.** No test asserts a control arriving BEFORE its bytes and then the app restarting, which is
the shape of this bug.

---

## The selected text model is never resident on a 3-model device (16 Aug 2026, iPhone)

Found by `scripts/e2e/model-eviction-journey.mjs`, which walks residency up one model at a time and
reads the app's own Models sheet between each step.

```
1. at rest                             image + voice + speech
2. after a typed turn                  image + voice + speech
3. after a spoken turn                 image + voice + speech
4. after an image request              image + voice + speech

never resident at any stage: text
  text    Qwythos-9B-v2-GGUF                (selected, never loaded)
* image   3.6 GB  SD 1.5 Palettized (Core ML)
* voice   0.3 GB  Kokoro TTS · Warm
* speech  0.1 GB  Base
```

Three sidecars hold 4.0 GB and the model the user chose cannot get in. The app still answers and still
draws, so nothing on screen says the chosen model is not the one running - except one in-chat line,
captured on device:

> Prompt enhancement skipped - Generating from your original prompt - Not enough free memory to load
> this model. Close other apps or choose a smaller model.

That message is right, and it is the only signal. It does not name what was needed, what was
available, or what would fix it, and it appears only on the enhancement path - a plain chat turn with
the same problem says nothing at all.

**Ties directly to the memory-estimate work above.** The refusal is the estimator's verdict reaching
the surface. Two questions this run raises that the current estimator cannot answer:

- Would the text model fit if the image model (3.6 GB, idle) were evicted first? Nothing appears to
  consider that trade - the image sidecar stays resident across every stage including two turns that
  never needed it.
- Qwythos loaded earlier in the same session once the context was lowered to 1k, which the gate's
  cost model cannot express, since it is context-blind. Still unexplained, still open.

**Cover it.** The journey is the regression test: any change to the cost model should be run against
it, and `never resident at any stage: text` should become empty.


## Voice: hands-free, barge-in and note trimming — 2026-08-17

Built and merged in one session on `release/sync-feedback`. **None of it is device-verified**; the
notes below say exactly which part is proven and how.

### Open

- **Desktop consumes none of it.** `@offgrid/speech` now owns the turn decision
  (`SpeechEndpointTimer`, `canArmHandsFreeTurn`), the mode labels, the onset look-back and the WAV
  trim math. Mobile uses all of it; desktop uses none. Parity was asked for explicitly, so SSOT here
  is structural only until desktop's recorder is wired to the same package. **This is the top item.**
- **Barge-in is NOT possible on this audio stack, and the attempt is backed out.** Talking over the
  assistant cannot interrupt it. An AVAudioSession MODE is only a hint; real cancellation needs the
  voice-processing I/O unit driving INPUT and OUTPUT together so it has a reference for what the
  speaker plays. Our TTS goes out through an ordinary `AudioContext`, which that unit never sees, so on
  device the mic recorded the assistant and speech detection fired on the assistant's own voice - iOS
  AND Android alike. The Oboe `VoiceCommunication` patch was reverted for the same reason: it asks for
  a cancelling capture source while playback leaves by another path, so it bought nothing and carried a
  blank-audio risk on some devices (google/oboe#2123). `audioRecorderService.isEchoCancelled()` is the
  single owner and returns false; when playback and capture share a voice-processing engine it returns
  true and hands-free listens through the assistant with no other change. **Real fix: give TTS playback
  and mic capture one voice-processing engine** - native/library work, not a setting.
- **Voice processing degrades PLAYBACK, which is how TTS went silent.** `ensurePlayback` deliberately
  leaves an active record session alone, so one recorded turn in a voice-processing mode left every
  later playback voice-processed. Ordinary turns no longer request it. Guard rows are on the release
  checklist (#202, #203).
- **THE design gap: speaking and listening are not serialized.** They are one resource with one
  holder - the assistant or the person, never both - and the code models them as two independent
  subsystems (TTS state in `pro`, mic phase in core) with a 400ms poll guessing when it is safe. Every
  fault today came from that: TTS pausing the moment it started (the mic armed in the gap between
  generation ending and speech beginning), autoplay killed by an arm, the assistant recorded as the
  person. The settle-ticks and abandon-guard in `useHandsFreeArming` are symptoms, not a design.

  **The shape it wants:** one owner of the floor with event-driven handoff -
  `assistant speaking → person listening → recording → transcribing → generating → assistant speaking`.
  Exactly one holder; illegal states (mic open while speaking, two turns at once) become
  unrepresentable instead of raced against.

  **What forces the poll:** there is no "the assistant finished speaking" EVENT. Core cannot subscribe
  to pro's TTS state, so `audio.isSpeaking` is a question that must be re-asked. Needs an
  `audio.onSpeechEnded` hook fired by pro on playback completion, a floor owner in core that serializes
  transitions, and `useHandsFreeArming` collapsing into a listener on it rather than a timer. Three
  files, no new behaviour - it makes today's behaviour correct by construction instead of by timing.
  **Desktop should be wired to the floor owner, not to the poll.**

- **Idle hands-free stalls rather than ends.** The wait for speech is 120s, so two devices left
  pointing at each other both go quiet and it reads as frozen, not finished.
- **`@offgrid/speech` is a mixed package.** It was a gateway speech client (console/desktop) and now
  also holds on-device turn logic. Same domain, but the name promises less than it holds.

### Verified, and how

- **WAV trim math** — proven in node against real WAV bytes, not on device: chunk-walking finds `data`
  behind a LIST chunk (offset 70), a 1.5s cut of a 2s file yields `copyFrom 48044 / copyBytes 16000`,
  the rewritten header declares the kept length, and garbage / over-trim / zero-trim are all refused.
  The **file I/O around it is NOT verified** — no trim has run on a device.
- **VAD auto-stop** — verified on device earlier in the session, with rms/floor/speech in the log.

### Fixed while doing this, worth knowing

- `recordingController.stop()` required phase `'recording'` while `toggle()` offered to stop a
  `'listening'` turn, so stop was silently refused mid-listen. Live in every hands-free build before
  `42147394`.
- Phase had two writers (endpoint + recorder) that could disagree; callers now report facts and the
  controller derives. `echoCancelled` was hardcoded `true` away from the code that configures capture;
  the recorder owns it and derives iOS's answer from the session mode actually applied.

### Open, added while making the voice delays user-chosen + putting replay in the session

- **Trailing silence is not trimmed.** `finaliseRecording` calls `trimWavFront` only, so the person's
  chosen end-of-turn window (up to 5s of dead air) rides into every file and Whisper transcribes
  through it. The tail cut belongs in the same pure planner (`wav-trim.ts`), keeping ~300ms of
  hangover so the last syllable is not clipped. Shortening the window in settings shrinks the tail but
  does not remove it.
- **Post-reply hand-back overhead beyond the drain is unmeasured.** The chosen drain accounts for the
  speaker's tail; whatever the device adds on top (mic spin-up, audio-session switching) has never been
  read off a real log. Measure before tuning anything.
- **Replay-in-the-session and the two delay settings are code-complete, NOT device-verified.** The
  machine transitions are pure and typecheck/lint/package tests are clean, but no phone has run them:
  the replay-while-listening contention, the paused-replay hand-back, and the settings rows all need
  the on-device pass.
- **Queued outbound transfers do not follow a peer to its new address, and never expire.** Seen live:
  the phone's pending WAVs all say "To OGAD x.x.x.64" while discovery is finding the same Mac at
  .31 - inbound from .31 completes in seconds, outbound to .64 sits at 0% forever. The durable
  SQLite op-store makes these rows survive restarts (correctly), which turns two missing rules into
  a permanent pileup: (1) re-target queued items when the same device id is rediscovered at a new
  host - the sibling of the existing "follow a peer that comes back on a new port" fix; (2) an
  expiry/failed transition for a peer that stays unreachable, instead of pending-forever.
- **A sender dying mid-batch leaves the receiver full of zombie rows.** Seen live: desktop was
  sending a 90-item batch (its log shows one file importing every ~3s, serial); the desktop process
  was killed mid-batch and Android's Sync activity froze with 35 rows at "Receiving - 0%, 0 B" from
  the vanished peer. Two defects, both SSOT-shaped: (1) receiver rows are created at OFFER time and
  nothing reconciles them when the sender disappears - no timeout, no failed transition, they sit
  "in progress" forever; (2) admission marks the whole batch in-progress up front while transfer is
  actually serial, so "35 in progress" describes the queue, not the wire. Any crash or quit
  reproduces this; it does not need a kill.

## Voice: the three RED realtime tests are GREEN, but NOT device-verified (2026-08-18)

All three had ONE root cause. `recordingController.start()` both dispatched `userStart` - which the
session driver obeys by opening the microphone - AND called `handlers.start()`. One tap therefore ran
`startRealtimeTranscription` twice and entered the native `transcribeRealtime` twice while the first
session was still coming up. That is the "State: -100" collision (B12), and it never needed a
double-tap. Stack-captured at the boundary, not inferred.

Fixed: a synchronous in-flight latch in `useWhisperTranscription` (the old guard read `isRecording`
from a closure and `whisperService.isTranscribing` was only set after an await for permissions, so two
asks fit inside the window); `useVoiceSessionDriver` made edge-triggered, which is what its contract
already claimed; `nextVoiceSession` `userStart` made a no-op when already listening.

**Still owed: a device pass.** Every symptom in this area's history (B12, B26, B28) was device-only, and
these fixes are verified against faked native leaves. Three flows to run on a phone:
1. Text model resident, tap mic, speak - does the transcript land? (was the silent-empty-composer case)
2. Tap the mic twice quickly - any "State: -100", or does the transcript arrive?
3. Fresh voice-model download, then tap mic - does the spinner become a live recording?

**Do not make `useVoiceSessionDriver` level-triggered again.** `voiceSession.dispatch` notifies on a
phase change so the hero can show "Recording you now"; with a level-triggered driver that same
notification opens a second recording mid-turn. The two belong together and each says so in a comment.

---

## Personal Mesh visibility needs the final physical lifecycle pass

**Status:** automation-backed; manual device verification is open. Filed 2026-08-24.

The Shared, React Native, Pro control, and Swift tests prove that browsing and advertising are
separate. They also prove that Hidden is applied before startup, a failed advertising stop keeps the
last true runtime and stored state, overlapping show and hide requests finish in order, and a retry
can complete the stop.

The remaining boundary is a real iPhone and Mac. Use the exact release builds and complete rows
43-48 in `docs/PERSONAL_MESH_TEST_MATRIX.csv`. Confirm that Hidden survives a cold start, that each
visibility control leaves the other function active, that an existing encrypted session stays active,
and that a second device sees the correct advertisement. Also confirm one private IP or machine-name
route and one non-default Sync port on every device.

Close this gap only with the device names, OS versions, exact build commits, and the completed matrix
rows. Simulator and injected-failure results do not close the physical radio boundary.

---

## Remote task controls need acknowledged, bounded Mobile state

**Status:** code resolved 2026-08-28; physical iOS and Android verification pending.

Commits `ddd59dc0` and `cba88680` keep Mobile as a subscriber to the Desktop-owned task state:

- Task controls stay pending only until a matching authoritative `controlId` and control kind arrive.
- Applied results clear the request. Rejected results show the Desktop reason. A 15-second wait shows
  that Desktop did not confirm; it does not change task state.
- Unrelated task updates cannot settle a control.
- Mobile does not render or decide Web Use or Computer Use approvals. Chat tasks start directly, and
  non-task ActionApproval behavior remains separate.
- One router serves both task tools. It selects a stable eligible Desktop when no target is given,
  resolves an exact case-insensitive device name or alias from `execution_device`, and never falls back
  when a named Desktop is offline or disabled.

Local evidence: Mobile and Mobile Pro typecheck and ESLint pass; seven focused suites pass 71/71,
covering both task kinds, applied, rejected, unrelated, and timed-out controls, two-Desktop default and
named routing, disabled/offline rejection, chat rendering, and non-task approval preservation. Keep
this entry open only for the final narrow and wide physical-device checks on iOS and Android.

---

## RESOLVED 2026-08-29: a fresh Android device reported the license server as unavailable

The connected Android device reached Keygen. Validation returned HTTP 200 with
`FINGERPRINT_SCOPE_MISMATCH`. This code means the key exists but the new device fingerprint is not on
the license yet. It is an internal activation signal, not a network error and not a user-facing
failure.

The fixed activation path passed live at 23:34 local:

- the first machine-list request returned HTTP 200 with four devices;
- machine activation returned HTTP 201;
- the local entitlement transaction completed prepare, commit, and finalize;
- the final machine-list request returned HTTP 200 with five devices;
- the user confirmed that Off Grid AI Pro activation succeeded.

This closes the fresh-device activation defect. Do not repeat the live check unless licensing code or
activation-owner wiring changes. The final Android production build remains a separate release gate.

---

## Release 107 two-way exact-operation Sync needs final device proof

**Status:** Shared Code and build evidence exist; final Mobile Built and Live verified gates are
open. Filed 2026-08-29.

Mobile loads the full operation log through `loadOps()`. No Mobile production caller uses Shared
compaction helpers. Durable per-entity and per-device watermarks restore anti-entropy position, while
exact operation IDs own delivery acknowledgement and deduplication. Mobile must still accept a valid
delayed operation below a watermark.

Keep this gap open until the final Android and iOS builds pass and one final physical journey proves
both directions:

1. One Mobile change reaches Desktop once.
2. One Desktop change reaches Mobile once.
3. A restart does not cause a record flood or active compaction.
4. A destination-gated delayed operation still arrives when its destination becomes eligible.

---

## Release 107 QR, reconnect, and residency changes need final Mobile proof

**Status:** Shared QR and Android residency Code evidence pass. Mobile UI code is still being
finalized. Final iOS and Android Built and Live verified gates are open. Filed 2026-08-30.

The Shared pairing contract is built and tested. The Sync ESM, CJS, and DTS builds pass. Focused QR,
real-handshake, and ESM/CJS runtime checks pass 21/21. The final QR suite passes 11/11. Sync typecheck,
focused ESLint, and diff check pass.

The Android residency crash came from resolving a Kotlin `LinkedHashMap` through a React Native
Promise. `MeshResidencyModule.begin()` and `state()` now use one canonical `ResidencySnapshot` to
`WritableMap` projection. Native checks pass 7/7. Focused rendered checks pass 23/23 with
open-handle detection and a clean exit.

Keep this gap open until the final Mobile code and these installed checks pass:

1. On iPhone, Show QR Code opens a bottom sheet. The code is hidden before that action.
2. Scan QR Code is a direct action. A valid scan identifies the device, shows the connection target,
   selects the best reachable private route, and completes the identity-confirmed handshake.
3. Stale, malformed, duplicate, and wrong-device payloads stop without pairing. A plain pairing code
   remains available.
4. Rescan continues when one saved route is unavailable. That device row shows the failure and its
   reconnect action. The screen does not show an orphaned page-level transport error.
5. The local device card uses the Discoverable to new devices and Find nearby devices controls. It
   does not repeat them with a generic Not discoverable label.
6. The final iOS build passes and the iPhone flows pass through iPhone Mirroring.
7. After the Android phone is connected again, the final Android build passes. Start Personal Mesh,
   confirm there is no residency crash, then repeat QR, reconnect, and discovery checks on Android.

Android live verification is explicitly deferred while the phone is disconnected. Do not close this
gap from unit, rendered, simulator, or iPhone evidence alone.

### Reconnect review failures are code-resolved; device proof stays open (2026-08-30)

Five PR 637 review failures were valid at Mobile `1263ac08`:

1. App startup could start reconnect recovery while remote provider initialization still changed the
   same registry and store.
2. A server move or WiFi rejoin with the same phone IP did not trigger active-connection validation.
3. An IP lookup that completed after watcher teardown could schedule recovery from a stopped watcher.
4. Port-only moved-server matching could overwrite a reachable saved server when a second server used
   the same port.
5. A reachable active server returned before the enabled auto-discovery rule could run.

The directed code fix makes provider initialization settle before watcher startup, gives the watcher
a teardown generation, validates an active connection after a same-IP check, limits moved-server
mapping to one missing saved endpoint and one unmatched discovered endpoint on the port, and evaluates
auto-discovery before the reachable-server return.

Focused local evidence on the release tree:

- `networkReconnect.test.ts`: same-IP foreground validation, stale lookup teardown, and steady-state
  same-IP poll suppression pass.
- `remoteServerReconnect.test.ts`: 2/2 passed through the real manager, real stores, and real LAN
  discovery logic for ambiguous port ownership and enabled discovery with a reachable active server.
- The existing focused `remoteServerManager.test.ts` suite passes 41/41.
- `App.test.tsx`: 3/3 passed with the targeted ignore override, including provider initialization
  ordering and teardown safety. This file is excluded by the default Jest configuration, so the
  exact targeted command is part of the evidence.

The first focused manager draft failed because its fixture used the wrong production setting key
(`remoteAutoDiscovery`). That mock-based draft was removed. Its replacement uses the real app store
action and canonical `autoDiscoverRemoteModels` key. This was a test-fixture failure, not a product
failure. The first targeted App teardown failed because the old debug-log fixture did not expose
`stopDebugLogFile()`. The fixture now matches the production lifecycle, and the targeted App run
passes 3/3 without the prior post-test teardown crash.

Keep the parent Release 107 reconnect gap open. The code is not built or live verified on iOS or
Android. The final installed-device reconnect journeys remain required.

### Android QR permission and duplicate-scan failures found in the final device pass (2026-08-30)

**Status:** code repair in progress; final Android build and installed verification required.

The connected Android build did not request camera access because its manifest did not declare
`android.permission.CAMERA`. The scanner used VisionCamera's runtime permission owner correctly, but
Android cannot display a runtime prompt for a permission absent from the installed package.

The user then scanned a QR for a device that was already connected. Mobile started a second pairing
handshake and showed `The connection closed before pairing completed.` The transport message was a
symptom of the redundant handshake. A connected identity must make the scan idempotent. A saved but
offline identity must use its stored trust to reconnect through the safe QR route instead of starting
a new pairing handshake.

Evidence:

- `adb dumpsys package ai.offgridmobile.dev` did not list Camera under runtime permissions.
- `adb appops get ai.offgridmobile.dev CAMERA` returned `ignore`.
- The pre-fix native manifest contract failed because Camera was absent.
- The pre-fix rendered Personal Mesh journey recorded a second TCP dial for the repeated QR scan.
- User screenshot: `Screenshot 2026-08-30 at 6.59.55 AM.png` showed the false connection-closed error.

Close this gap only after the native manifest contract and rendered repeat-scan journey pass, the
Android debug and release builds pass, the fixed debug app is installed without clearing data, and
opening Scan QR shows the Android camera permission prompt once. Do not automate the camera scan.
