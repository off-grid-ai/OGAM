# Gaps backlog

Honest register of OPEN gaps, regressions, dead code, and "not fully done" items. Each
entry has a verdict and evidence. The standing gap agent picks these up, closes them, and
REMOVES them from this file once resolved (the record lives in git history + commit messages).
This file only ever contains work that is still open.

Verdict legend:
- **delete-safe** - unreferenced / unreachable and provably unused; remove it.
- **fix-the-guard** - the branch is SUPPOSED to fire but a condition prevents it; fix the condition (a latent bug, not litter).
- **instrument-and-revisit** - uncertain trigger; add a `[*-SM]` trace + a Provit journey to observe it live before deciding.

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
service. (DR2 vision-detection divergence was RESOLVED — unified onto utils/visionModel.ts.)

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
