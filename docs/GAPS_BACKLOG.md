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
