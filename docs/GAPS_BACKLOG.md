# Gaps backlog

Honest register of gaps, regressions, dead code, and "not fully done" items. Each
entry has a verdict and evidence. The standing gap agent picks these up, closes
them, and marks them resolved with evidence. Gaps are surfaced, never hidden.

Verdict legend:
- **delete-safe** - unreferenced / unreachable and provably unused; remove it.
- **fix-the-guard** - the branch is SUPPOSED to fire but a condition prevents it; fix the condition (this is a latent bug, not litter).
- **instrument-and-revisit** - uncertain trigger; add a `[*-SM]` trace + a Provit journey to observe it live before deciding.

---

## Dead-code recon - 2026-07-06

Recon sweep (4 parallel agents over disjoint subsystems) for unreferenced exports,
unreachable branches, duplicated logic, and threaded-but-unread params. All findings
grep-verified. Nothing deleted yet - this is the register; deletions land as their own
small PRs after each is confirmed.

### Model-load / generation

| # | Location | Symbol | Verdict | Note |
|---|----------|--------|---------|------|
| ML1 | activeModelService/index.ts:~469 | `getCurrentlyLoadedMemoryGB()` (private wrapper) | instrument-and-revisit | CORRECTION: recon said "zero call sites" but tests DO exercise it (integration + memory unit). Test-only API - deleting needs the tests reworked, not a blind delete. |
| ML2 | activeModelService/index.ts:~475 | `checkMemoryForDualModel()` (public wrapper) | instrument-and-revisit | CORRECTION: exercised by integration tests + mocked in HomeScreen test. Prod never calls it - decide keep-vs-remove in the dead-code PR, with tests. |
| ML3 | activeModelService/utils.ts:16-17 vs types.ts:48-50 | overhead multipliers (1.2/1.3 hardcoded vs 1.5/1.8 constants) | fix-the-guard | HomeScreen memory display disagrees with the load-path math; import the shared constants |
| ML4 | useChatModelActions.ts (needsReload double-check) | redundant `&& loadedPath === activeModel.filePath` | instrument-and-revisit | logically impossible to be false; simplify |
| ML5 | activeModelService/index.ts:~338 + loaders.ts | `cpuOnly: false` (always false) | delete-safe | native CPU-only branch unreachable from TS |

> Note: the recon confirmed the "Load Anyway" flow is NOT dead once the residency gate
> throws a typed `OverridableMemoryError` (shipped in this PR). Before that, the raised
> pre-check budget made `canLoad` almost always true, so the pre-check's Load-Anyway was
> effectively unreachable - the root cause of "Load Anyway stopped happening".

### Download / model-manager

| # | Location | Symbol | Verdict | Note |
|---|----------|--------|---------|------|
| DL1 | downloadHydration.ts:33 | `case 'retrying'` in mapNativeStatus | delete-safe | native (iOS+Android) never emits 'retrying' |
| DL2 | DownloadManagerScreen/items.tsx:51,60,81,91 (+ downloadStatusIcon.ts, downloadErrors.ts, useDownloads.ts) | branches on `status === 'retrying'` | fix-the-guard | unreachable given DL1; remove or document the contract |
| DL3 | modelManager/types.ts:13 | `BackgroundDownloadMetadataCallback` (@deprecated, no-op) | delete-safe | author-confirmed no-op, still threaded through 3 sites |
| DL4 | downloadHydration.ts:25 | `export isMmProjFileName` | delete-safe | only used internally; drop the export |
| DL5 | modelManager/download.ts:454-462 | `isFinalizing` reset only on error | instrument-and-revisit | verify re-entrancy window on success path |

### Audio / TTS / STT

| # | Location | Symbol | Verdict | Note |
|---|----------|--------|---------|------|
| AU1 | whisperStore.ts:172-189 | `deleteModel()` (vs used `deleteModelById`) | delete-safe | zero call sites |
| AU2 | audioSessionManager.ts:51-57 | `ensurePlayback()` | delete-safe | only referenced in comments |
| AU3 | whisperService.ts:145-164 (+ store 97-116) | `downloadFromUrl()` | delete-safe | only reached from an unused store action |
| AU4 | ChatInput/Voice.ts:136-143 | stopRecording early-return guard | fix-the-guard | inverted condition; can't be true when recording |
| AU5 | whisperService.ts:338-400 | `transcriptionFullyStopped` promise overwrite | fix-the-guard | new start replaces a promise unloadModel may await |
| AU6 | audioRecorderService.ts:12-14 | `supportsDirectAudioInput()` stub `return true` | instrument-and-revisit | placeholder; add real capability detection |

### Image-gen / tools / remote

| # | Location | Symbol | Verdict | Note |
|---|----------|--------|---------|------|
| IM1 | types/index.ts:314-320 | duplicate `ImageGenerationState` | delete-safe | authoritative def is in imageGenerationService.ts |
| IM2 | localDreamGenerator.ts:67 (+ loaders.ts:296) | `backend` param always `'auto'` | delete-safe | 'mnn'/'qnn' branches never reached from TS |
| IM3 | imageGenerationHelpers.ts:42-44 | iOS short-circuit ignores `backend` | fix-the-guard | 'coreml'/default 'mnn' unreachable on iOS; make explicit |
| IM4 | localDreamGenerator.ts:236-238 | `hasKernelCache()` wraps `hasOpenCLCache` (name mismatch) | fix-the-guard | rename to match native call |
| IM5 | localDreamGenerator.ts:231-239 | `clearOpenCLCache`/`hasKernelCache` silent iOS no-op | instrument-and-revisit | throw or gate at call site on iOS |

### Verification pass - 2026-07-06 (before acting)

Every "delete-safe" candidate was re-grepped across `src`, `__tests__`, and `pro/`
before touching anything. The recon **over-reported**: most flagged symbols are
actually referenced (largely by tests, some by prod). Blind deletion would have
broken the suite. Verified outcomes:

- **RESOLVED (removed):**
  - IM1 - duplicate `ImageGenerationState` in `types/index.ts`: zero importers (every
    consumer takes the service's version). Deleted.
  - AU3 - `whisperService.downloadFromUrl` + the `whisperStore.downloadFromUrl` action:
    no UI/hook/screen/pro caller (custom-URL whisper download was never wired). Removed
    across service + store + its orphaned tests.
- **FALSE POSITIVE - verified USED, kept:**
  - AU1 `whisperStore.deleteModel` - called at whisperStore.ts:180/201 + store test.
  - AU2 `audioSessionManager.ensurePlayback` - full test suite + whisperService.test call.
  - DL4 `isMmProjFileName` export - imported by `modelManager/restore.ts` + tested directly.
  - ML1/ML2 - exercised by integration + memory unit tests (see corrected rows above).
- **DEFERRED (not "dead", changing risks behaviour - kept out of this PR):**
  - Unreachable-branch removals (DL1/DL2 `retrying`, IM3/IM7 iOS backend short-circuits):
    they never execute, but removing a value from a status/type union risks exhaustiveness
    breakage; do it as a typed refactor with its own tests.
  - Threaded-constant params (ML5 `cpuOnly`, IM2 `backend:'auto'`): passed to the native
    bridge; removing the arg changes the native call. Not dead in a way that's safe to cut here.
  - Race/stub items (AU4/AU5/AU6, DL5, DL3 deprecated-callback threading): need on-device
    observation before change - `instrument-and-revisit`, not a blind edit.

Net: the genuinely-dead, safe-to-remove set was small (IM1 + AU3). Removed here; the
rest stay in the register with an honest verdict rather than a risky change.

### Handling policy (how we close these)
1. **delete-safe** → each removed in a small, single-concern PR with a grep proof of zero references in the description.
2. **fix-the-guard** → fix the condition, add a fails-before/passes-after test that exercises the now-reachable branch.
3. **instrument-and-revisit** → add a `[*-SM]` trace + a Provit journey; only decide delete-vs-keep after observing it live.
4. **Standing gate** → add `knip` (or `ts-prune`) to CI to catch category-1 (unreferenced) dead code continuously, so this register only ever needs the reasoning-heavy categories.

---

## Image-gen QNN over-recommendation on non-flagship Snapdragons - 2026-07-08

**Verdict: fix-the-guard (DEFERRED - needs a curated SoC allowlist + on-device rounds, intentionally out of the current release).**

**Symptom (observed live on an AC2001 / OnePlus Nord, SoC SM7250):** the app recommends
a QNN/NPU image model, the user downloads + loads it, and the native local-dream process
crashes: `Failed to load image model: Server process exited with code 1. Your device
(SM7250) may not support this model's backend. Try a CPU model instead.` So it recommends
NPU and then reports NPU unsupported - a self-contradiction.

**Root cause (`src/services/hardware.ts`):**
- `classifySmNumber` buckets every non-flagship Snapdragon into `'min'` (the catch-all,
  the `return 'min'` after the 8gen1/8gen2 sets).
- `hasNPU = vendor === 'qualcomm' && !!qnnVariant` → `'min'` counts as NPU-capable → `true`.
- `getQualcommImageRec` returns `recommendedBackend: 'qnn'` for ALL variants (incl. `'min'`),
  with `compatibleBackends: ['qnn','mnn']`.
- So a SoC like SM7250 (Hexagon that can't actually run the QNN image binaries) is told QNN
  works, passes the pre-load gate (`checkImageModelCanLoad` only blocks qnn when `!hasNPU`),
  and crashes at runtime.

**Fix direction (do properly, not rushed):** QNN capability must be a narrow, verified set
(8gen1/8gen2, or an explicit allowlist), not "any Snapdragon". Then `hasNPU`/recommendation
key off ACTUAL QNN-capability; the catch-all recommends `mnn` (reliable GPU/CPU). That fixes
both the bad recommendation and the runtime crash (the pre-load gate would also block a
manually-selected qnn model with a clear message instead of a hard crash). Needs device
verification on affected SoCs (SM7250 and at least one true 8gen1/8gen2) before shipping -
hence deferred, not patched blind.

---

## Image-gen inline preview not shown on first run - 2026-07-08

**Verdict: instrument-and-revisit (native-emission behaviour, not a JS/UI bug).**

Observed on-device (OnePlus Nord, mnn/OpenCL, first run): the "Generating Image" card
showed no inline preview thumbnail. The UI IS wired correctly — `ChatScreenComponents`
renders `imagePreviewPath` when set, fed by imageGenerationService's onPreview →
appStore. The preview only appears when the NATIVE localdream module includes
`previewPath` in its progress events (`localDreamGenerator.ts:123`, optional field). No
preview events were emitted for this run — consistent with first-run OpenCL kernel
compilation skipping the (expensive) intermediate-latent decode while warming.

Next: confirm whether previews appear on a SECOND (warmed) generation. If they do, this
is expected first-run behaviour (optionally: show a "preview available after first run"
hint). If they never appear on mnn, it's a native gap in the localdream preview path to
fix on the native side — the JS/UI layer is already correct, so no JS change is warranted.

---

## On-device test session - 2026-07-09 (Qwythos-9B vision + memory, 12GB iPhone/Android)

Surfaced live on real hardware during 0.0.103 vision/memory testing. None caught by the
green suite — the reason the on-device gate is mandatory. Verdicts + evidence below.

| # | Finding | Verdict | Evidence |
|---|---------|---------|----------|
| OD1 | **Vision (mmproj) dropped on download retry** | fix-the-guard | `[DL-SM]` iPhone: main GGUF failed at 9% ("network connection lost") → auto-retry re-issued `needsMmProj:false, mmProjLocalPath:null` → finalized text-only (`savedEngine:llama`, `mmProjFileExists:false`). release/0.0.103 fix (persist metadataJson) targets this; UNVERIFIED on-device. |
| OD2 | **Repair Vision has no progress feedback** | fix-the-guard | ~900MB mmproj re-download behind an indeterminate "Repairing…" spinner; `[linkOrphanMmProj] recovered` eventually fired ("Vision Repaired"). Needs determinate progress. USER-SELECTED to fix. |
| OD3 | **Chat vs Home model-selector inconsistency** | fix-the-guard | `checkMemoryForModel` is called ONLY in `useChatModelActions.ts` (:96, :311). Chat pre-checks (predictive fileSize×1.5 ≈ 8.4GB for the 9B → critical on 12GB → gates behind "Load Anyway"); Home skips the pre-check → loads via `makeRoomFor` (measured) → succeeds. Two surfaces, one decision, divergent logic. USER-SELECTED to fix. |
| OD4 | **UI freeze on forced heavy load (Load Anyway on 9B multimodal)** | instrument-and-revisit | Only iOS native edge-swipe worked; all RN touchables dead; debug log stopped emitting = JS thread blocked by the synchronous native load of ~6GB + vision projector. The failure the override survival-floor is meant to prevent; installed build predates the release/0.0.103 fix. |
| OD5 | **Android download retry doesn't resume after network drop** | instrument-and-revisit | `[DL-SM]` android: Qwythos errored at 75% ("Network connection lost"), retry dispatched (WorkManager resume in place) → NO further progress milestones. Partly a real WiFi drop; retry-not-resuming is the reliability gap. |
| OD6 | **Kokoro TTS asset stuck loop** | instrument-and-revisit | android log: `[KOKORO-DL] checkAssetStatus → downloading (phase=ready progress=1.00 genuineCompletion=false)` spamming — stuck "downloading" while phase=ready/progress=1.0. |
| OD7 | **Thinking toggle missing for Qwythos-9B in settings** | instrument-and-revisit | Model has reasoning (HF tags: reasoning) + emits `<think>`, but settings shows no thinking toggle. Capability detection gap for community GGUF. |
| OD8 | **Voice-mode thinking not streamed (appears suddenly)** | instrument-and-revisit | Thinking renders live in text chat but batches in voice mode. Suspected in the audio-layout display path (`pro/audio/ui/AudioModeLayout.tsx`), not just the TTS sentence-queue (`pro/audio/streamingSpeech.ts`). Needs the display seam confirmed before fix. USER-SELECTED to fix. |

## More on-device TTS findings - 2026-07-09 (later)

| # | Finding | Verdict | Status |
|---|---------|---------|--------|
| OD-TTS1 | **Play does nothing / "not downloaded" though model is on disk** | fix-the-guard | FIXED (pro fix/tts-download-flag-reconcile). checkAssetStatus reported off the engine's volatile `_genuineCompletion`, which desyncs false on mid-session re-init/bridge-unmount (hydrate only runs on engine switch). `[TTS-SM] play() … downloaded=false` bailing in ~1ms (no icon change). Fix: reconcile to the durable persisted `modelDownloaded` flag; extracted download actions to ttsDownloadActions.ts (no eslint-disable). Red-first test. UNVERIFIED on-device. |
| OD9 | **TTS speaks tool-call content aloud (voice mode)** | fix-the-guard | DELEGATED (fix/tts-strip-tool-calls). streamingSpeech `answerOf` strips thinking only; `enqueueReadySentences` runs stripControlTokens per-SENTENCE-fragment, so a `<tool_call>…</tool_call>` block spanning sentence boundaries leaks in fragments. Fix: withhold+strip whole control-token blocks before segmentation (mirror the thinking withhold). Red-first. |
| OD10 | **TTS stops mid-speak** | instrument-and-revisit | `[TTS Store] Engine error: KOKORO_SPEAK The model is currently generating` + `stream segment FAILED session=1 fails=2` — a double-speak concurrency collision aborts the stream mid-sentence. Needs the speak/stream serialization checked (a second speak fired while the first was still generating). |

| OD11 | **Voice mode can't stream TTS alongside a large LLM (falls back to end-of-turn speech)** | fix-the-guard | With a big model resident (Qwythos 9B, ~6GB), the single-model residency rule blocks the ~82MB Kokoro TTS sidecar from co-loading (`[Whisper] Skipping load — no room alongside the active model (single-model rule)`), even with 4.4GB free (os_procAvailMB=4405). streamingSpeech loops `stream feed SKIP: engine not warm` (442× in one turn) then falls back to onStreamingEnd speaking the whole message at generation end. Works, but no live streaming + long silence + log spam. Fix: allow SIDECAR types (tts/whisper/embedding) to co-reside with a generation model when real free RAM fits them (they're tiny), rather than subjecting them to single-model eviction. |

| OD12 | **Load-Anyway freeze on a too-big CLEAN GGUF (survival floor hole)** | fix-the-guard | Forcing Load Anyway on Qwythos 9B (est 9366MB, budget 7908MB, os_procAvail ~5074MB, GPU 4624MB free) bypasses the fit gate; native llama.cpp load wedges at `done_getting_tensors … cannot be used with preferred buffer` and blocks the JS/UI thread (taps dead, native swipe works). BOTH iOS+Android. Root: the OVERRIDE_SURVIVAL_FLOOR credits 0 for a CLEAN model (`incomingDirtyMB = dirty ? sizeMB : 0`), so postLoadFree≈realAvail passes the 1200MB floor and force-loads — but a 9.3GB model's compute/KV/GPU buffers don't fit ~5GB free even mmap'd. The clean-model "bounded by physical RAM only" assumption ignores working-set/GPU-buffer limits. Fix: the survival floor (and/or a hard override ceiling) must account for a large clean model's real load footprint vs available RAM + GPU buffer, not just dirty memory. Consequence: "tools/thinking don't show" because the model never finishes loading → capabilities never resolve. |
