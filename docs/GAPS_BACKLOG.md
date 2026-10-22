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

## Clearing a maker filter does not leave search mode - 2026-10-22

**Verdict: fix-the-guard.** The auto-search effect in `src/screens/ModelsScreen/useTextModels.ts` returns early when
all filters are clear, so the list stays in search mode and shows the whole catalog plus stale Hugging Face results.

## Desktop: catalog-check diff and the engine-build rule for Hugging Face results - 2026-10-22

**Verdict: fix-the-guard.** Desktop's `checkForNewModels` (`desktop/src/main/models/remote-catalog.ts`) still says
"updated" when a remote entry repeats a bundled one unchanged; it should use the shared `diffMergedCatalog` as mobile
does. Hiding Hugging Face uploads that need a newer llama.cpp lives in mobile (`src/services/llamaEngineSupport.ts`)
and should move into the shared `searchHuggingFace` so Desktop gets it too.

## Gaps the v0.0.111 → v0.0.116 rendered tests could not close - 2026-10-22

**Verdict: instrument-and-revisit.**

- **The 4096 context fix (`9ea2c8275`) cannot be seen.** Nothing reads the server-reported context length. Remote
  chats trim to the local context setting. Only the unit test covers it.
- **No real model shows "Research licence".** Only the Qwen-Image models set `nonCommercial`, and the Image tab does
  not show fact chips.
- **The queue double-settle (`1151a103d`) does not reproduce in jest.** The rendered test guards the outcome only. An
  iPhone log of the second settle is needed to make it a real guard.
- **VoiceOver may never read the "Download <model>" labels.** The download button is inside the card's own button
  (`src/components/ModelCard.tsx` ~345). Check with VoiceOver and TalkBack on a phone.
- **The demo PDF's text is not checked.** The fake PDF reader in `__tests__/harness/documentEngine.ts` cannot read a
  real PDF.
- **Android sends two mic permission requests for one tap.** The user sees one prompt. The duplicate path is not traced.
- **None of the v0.0.112 → v0.0.116 changes has a real-device e2e.** The WDA and adb journeys in `scripts/e2e/` predate
  v0.0.111.

## Live transcription is not checked on a phone after the whisper.rn revert - 2026-10-22

**Verdict: instrument-and-revisit.**

OGAM#730 reverted whisper.rn to `^0.5.5` (`db25399be`) after 0.7.4 broke live transcription. The iPhone used on
2026-10-21 still had the broken 0.7.4 build. Nothing has been tested on a phone since the revert.

Acceptance: an installed beta on iPhone and Android transcribes live, and a voice note lands as text.

## whisper.rn 0.7 is not adopted - 2026-10-22

**Verdict: fix-the-guard (planned upgrade).**

whisper.rn 0.7 removes `transcribeRealtime()`, which live transcription uses, and deletes the file that the
Android crash fix patches. `main` pins `whisper.rn ^0.5.5` on purpose.

Remaining work: move live transcription to the `RealtimeTranscriber` API, port the Android fixes, then bump.

## ExecuTorch 0.10 is not adopted - 2026-10-22

**Verdict: fix-the-guard (planned upgrade).**

`main` has `react-native-executorch ^0.9.3`. 0.10 needs react-native-worklets 0.10 (the app has 0.7.3) and
react-native-blob-util (the app has none). Proposed on 2026-10-21; not started.

## The in-chat MTP tip never fires for models whose MTP head is a separate file - 2026-10-20

**Verdict: fix-the-guard.**

The 2026-10-20 audit found the tip checks only the main GGUF. A model whose head ships as a separate file never
shows it. Not re-checked since. Fix together with the shared MTP extraction below.

## Rendered tests cannot see three things from the v0.0.111 handoff - 2026-10-17

**Verdict: instrument-and-revisit.**

The rendered tests for the changes since v0.0.111 (commit 982f99d6b) are green, but four outcomes are
not observable in Jest and need a device check (the thinking preview's ellipsis was checked on an
iPhone 17 Pro Max on 2026-10-17 and is not listed):

- **Synced chat repair at startup** (`pro/sync/syncedChatRestoredFromOpLog`): the test asserts the
  order before and after the repair. It cannot see whether the list flashes or reorders in between,
  or whether the scroll position holds, because the list has no layout in Jest.
- **Project knowledge with an unknown model name** (`knowledge-base/projectKnowledgeSearchedWhenNeeded`):
  the test uses a known name (Qwen3). With an unknown GGUF name, the first message after a lazy load
  goes out with no tools, so the whole PDF is put into the prompt (`src/utils/ggufCapabilities.ts`,
  by design). That cell is not covered.
- **Demo data PDF** (`settings/devToolingReleaseGate`): the fake PDF reader cannot read the real demo
  PDF, so the test checks that the PDF is listed, not that it was indexed.

## LiteRT-LM 0.18.1 is not checked on an Android phone - 2026-10-17

**Check 2026-10-22:** now LiteRT-LM 0.18.1 (`3ad24e535`). Still not checked on an Android phone.

**Verdict: instrument-and-revisit.**

The runtime upgrade (handoff item 9) was checked on an iPhone 17 Pro Max with llama.rn 0.13.0-rc.7:
a thinking chat completed with Metal (99 layers), tool calls ran, Stop kept the partial reply, and a
vision question about a photo was answered correctly. LiteRT-LM 0.18.1 (`android/app/build.gradle`,
commit 3ad24e535; first filed against 0.18.0) is Android-only and no Android phone was connected. Still to check on Android: a
LiteRT chat, the same llama.rn steps, and the backend chip or CPU fallback notice.

## A failed image generation does not hold the chat queue - 2026-10-17

**Verdict: instrument-and-revisit.**

A Stop or a failed text reply holds the queued messages until the user taps Send (the shared rules in
`@offgrid/sync` chat-queue). A failed image generation does not: `imageGenerationService.generateImage`
returns `null` for both a cancel and a failure, so `useChatGenerationActions` cannot tell them apart and
leaves the hold as it was. Decide whether the queue should hold here too, then pass the outcome through.

## Project deletion leaves an empty gap in the list - 2026-09-11

**Verdict: fix-the-guard.**

After the user deletes a project, the Mobile Projects list leaves an empty space where the row was.
The list should reflow immediately from its existing project state without navigation, refresh, or
restart. Verify deletion at the start, middle, and end of the list and confirm that the remaining
projects close the gap while their order stays stable.

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

## Android voice session can lose playback or transcription - 2026-08-24

**Verdict: instrument-and-revisit.**

A Pixel 8a user reported that voice replies showed both transcripts but produced no sound. After the
user stopped and restarted the app, playback worked, but microphone input no longer produced a
transcript. The currently attached Android device creates and plays a full-volume `AudioTrack`, so
the failure is not reproduced. Capture Pixel logs for the playback and recorder state machines before
changing audio-focus or model-lifecycle behavior. Acceptance: repeated voice turns continue to play
and transcribe before and after app restart, for the user's selected language.

## Projects screen does not refresh after desktop project sync - 2026-08-20

**Verdict: instrument-and-revisit.**

Observed during the attended desktop-to-mobile E2E: a project created on desktop and populated with
the four Off Grid AI fixture documents reached the sync mesh, but the already-open mobile Projects
screen did not show the new project in real time. Determine whether the project row was materialized
while the screen's query/cache failed to invalidate, or whether materialization itself was delayed.
The acceptance case is that an open Projects screen updates without navigation, rescan, or restart.

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

## Dead-code recon — open (deferred) items - 2026-07-06

_Re-checked 2026-10-22: only the items still open are listed._

- **ML3** - `activeModelService/utils.ts` still uses 1.2 and 1.3; `types.ts` has 1.5/2.2/1.8. Use the shared multipliers.
- **ML5** - `activeModelService/index.ts` passes `cpuOnly: false` on to `loaders.ts`. Remove the arg in a typed refactor.
- **DL1 + DL2** - `downloadHydration.ts` still has `case 'retrying'`, but native maps RETRYING to failed
  (`DownloadUiState.kt`). Remove `'retrying'` from the union and its uses in `items.tsx`, `downloadStatusIcon.ts`,
  `downloadErrors.ts` and `useDownloads.ts`.
- **DL3** - `modelManager/types.ts` type still threaded through `index.ts`, `download.ts`, `restore.ts`. Delete it.
- **DL5** - `download.ts` sets `isFinalizing`; only the catch resets it. Reset it in `finally`.
- **AU4** - the guard moved to `ChatInput/Voice.ts`. It compares conversation ids, which can differ if the user
  switches chat while recording. Premise likely wrong: confirm, then drop.
- **AU5** - `whisperService.ts` overwrites the load promise that `unloadModel` awaits. Chain the old promise.
- **AU6** - `audioRecorderService.ts` still returns `true` for capability. Add real detection.
- **IM2** - `loaders.ts` always passes `'auto'`; `localDreamGenerator.ts` still has the union. Typed refactor.
- **IM3** - `imageGenerationHelpers.ts` ignores the backend on iOS. Branch on iOS first.
- **IM4** - `localDreamGenerator.ts` `hasKernelCache` calls `hasOpenCLCache`. Rename (caller: `imageGenerationService.ts`).
- **IM5** - `localDreamGenerator.ts` cache helpers are no-ops on iOS returning 0/true. Gate at call sites.

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

## On-device test session - 2026-07-09 (Qwythos-9B vision + memory, 12GB iPhone/Android)

_Re-checked 2026-10-22: only the items still open are listed._

- **OD5** - Android retry after a network drop: code in `9b45bab31` and `8d8d09e90`. Device check owed.
- **OD11** - Kokoro beside a large LLM: budget residency (`shared residency-policy.ts`), but the singleModel and
  not-warm paths remain (`streamingSpeech.ts`). Device check with the default policy.
- **OD13** - Qwythos output all in `reasoning_content`: `'auto'` only for gemma-4 names (`llm.ts`); others get
  `'deepseek'` (`llmHelpers.ts`). Pick the format from the template delimiters, or drop the model.
- **OD15** - Jinja "roles must alternate": retry without tools exists only on the remote path
  (`generationToolLoop.ts`). Add the local catch and retry.
- **OD16** - remote capabilities flaky: only hand-made fixtures. Capture live provider fixtures and add a contract test.

## Repo-wide /hygiene audit — open items - 2026-07-09 (SOLID §A/§B + DRY §C)

_Re-checked 2026-10-22: only the items still open are listed._

- **SO5** - `ImageFilterBar.tsx` hand-built filters. Use a data-driven filter descriptor.
- **SO6** - `remoteServerManagerUtils.ts` type-switches. Put `updateCapabilities` on the provider interface.
- **SO7** - `pro/audio/ttsStore.ts` engine checks. Optional cache methods on the engine interface.
- **SO8** - `remoteServerHelpers.ts` capability derivation. Fold into the shared derivation.
- **DR4** - `/ 4` token estimates in llmHelpers, litert, liteRTCompaction, generationServiceHelpers, llm and both
  providers. Use the shared `estimateTextTokens`.
- **DR5** - token lists in `llmHelpers.ts` and `messageContent.ts`. One token registry.
- **DR6** - `OuteTTSEngine.ts` and `ttsService.ts` both define the end token. Shared `IM_END_TOKEN`.
- **DR8** - `remoteModelCapabilities.ts` vs `openAICompatibleStream.ts` reasoning fields. Shared helper.
- **TQ1** - `useDownloads.test.ts`: 37 call asserts, 0 `getState`. Drive the real store.
- **TQ5** - `coreMLModelUtils.test.ts` claims sequential order; the code uses `Promise.all`. Fix the claim.
- **TQ6** - no visible-text assertions in TTSButton, ModelFailureCard, ImageGenAdviceCard, McpAddServerSheet,
  PlaybackControls, KokoroTTSBridge.

## Pre-existing: mid-chat model switch doesn't refresh chat state until remount - 2026-07-10
**instrument-and-revisit** | Reported on-device (iOS, gemma-4 local + remote), confirmed present on the
OLD build (NOT introduced by this PR's work). Loading a new model from within the Chat screen mid-
conversation does not update the screen's derived active-model state — not a freeze; navigating Home →
back re-syncs. Suspect useChatModelStateSync / the chat's derived activeModel not re-running after an
in-chat load (the model loads fine; only the screen's projection is stale). Fix separately with its own
on-device repro — do NOT bundle into the current release PR (scope + risk).

## Device-verification gate before release (PR #510) — MUST pass before shipping

_Re-checked 2026-10-22: only the items still open are listed._

- **Native-first Gemma flip** - `parseGemmaNativeToolCalls` is still in `generationToolLoop.ts` with the
  `[GEMMA-FALLBACK]` log. Run on a device, then keep or delete the hand-parser.
- **iOS thinking-box width** - fixed in `a0142d48e` with test `5aafed0ec`. Screenshot check only.
- **Fallback notice needs a conversation** - `useChatModelActions.ts` returns early with no conversation. Add a
  surface for that case plus a rendered test.
- **CPU fallback inherits OpenCL params** - `llmHelpers.ts` copies the GPU params and strips only `devices`.
  Rebuild the CPU params; assert via `WIRE-LLAMA-LOAD`.
- **Concurrent-retry race journey test** - none exists. Rendered journey: retry before the classifier runs,
  assert no card.
- **Kokoro bypasses the 3-slot download cap** - Kokoro goes through the executorch fetcher
  (`ttsDownloadProvider.ts`), not `backgroundDownloadService`. Gate it on the shared slot count, or move it to
  the app's downloader.
- **Reclaim-aware pre-load gate** - `awaitMemoryReclaim` is in `memoryBudget.ts`. Confirm whether the branch
  merged or was abandoned.

## Cosmetic voice-mode label (deferred from the 0.0.103 device session)

**Verdict: instrument-and-revisit.** During the 0.0.103-beta device session, two fixes landed (Lean
per-model eject + thinking-block width). A third item — a **cosmetic label/chip in voice mode**
rendering the wrong text — was deferred: it is purely cosmetic (no functional impact) and pinning the
exact wrong value needs a device-log pull, not code reading. Next device session: pull the live tail of
`offgrid-debug.log` from the `.dev` container, grep the `[*-SM]` traces while entering voice mode, read
the actual rendered label value, then fix in `pro/audio/` UI. NOT a release hazard.

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

## M5a (marginal, logged) — exact budget boundary untested

_Re-checked 2026-10-22: only the items still open are listed._

The budget check is now `fitTier` in `shared/packages/models/src/model-fit.ts`. `model-fit-phone.test.mjs` has
no case where size equals the budget. Add a boundary test in shared. Marginal.

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

## Personal Mesh (sync across macOS, iOS, Android) — 2026-07-30

_Re-checked 2026-10-22: only the items still open are listed._

- **PM1 / PM2** - one device identity (`localDevice.ts`) and Android mesh residency
  (`MeshResidencyService.kt`) are in code. Matrix rows 5–6 and 18–21 still need a device run.
- **PM7** - Devices UI vs the state table: `docs/PERSONAL_MESH_TEST_MATRIX.csv` rows 39–42 have empty result
  columns. Run on three platforms.
- **PM8** - none of the 48 matrix rows records a pass. Run the matrix on hardware.
- **PM9** - receive consent: `admitIncoming` is now wired to per-category receive preferences
  (`pro/sync/fileTransferService.ts`). There is no prompt, by decision.
- **PM12** - no late-pair app journey in `scripts/e2e`. Run the physical two-way late-pair journey, including a
  receiver restart.

## Open bug: evicting an OFFLINE device may not leave the eviction outstanding

`shared/packages/sync/src/personal-mesh-entitlement.ts` still calls `onRegistryChanged` before
`finalizeEviction`. The test is skipped (`syncPersistence.integration.test.ts`, `it.skip`).

Fix: finalise before announcing, then un-skip the test.

## Deleting the mockist ChatScreen suite leaves real ChatScreen journeys uncovered

_Re-checked 2026-10-22: only the items still open are listed._

135 `chatHarness` tests exist now. Still missing:

- **ChatModalSection** - no rendered modal open/dismiss test.
- **useChatMessageHandlers** - no copy or delete-message rendered test.
- **useChatModelActions** - no switch while a reply is streaming.
- Re-measure coverage for ChatScreenComponents, modelReadiness and the screen index.

## Image-generation journeys left uncovered by deleting imageGenerationFlow.test.ts

_Re-checked 2026-10-22: only the items still open are listed._

- **Enhancement context rules** - unit-covered only (`imageGenerationHelpers.test.ts`). Add a rendered test if
  policy needs it.
- **Auto-load and thread-count reload** - logic in `activeModelService/index.ts`; only a unit test. Rendered
  test: generate, change threads, generate again.
- **Generate with no conversation open** - no test. Add a rendered gallery-only test.

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

## A tool-heavy turn's FINAL ANSWER reaches peers LONG after its tool calls do

**Check 2026-10-22:** later fixes (pro `237f16f5`, shared `3327116`, `8883ae51`) were never measured. Measure the latency on the mesh.

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

## "Preparing reply" state never reaches peer devices

**Check 2026-10-22:** likely fixed by live preview streaming (`pro/sync/chatStreamService.ts`), shared phases (`4f76b0c`, `9fbe2db`) and keepalive (`237f16f5`). Device check that peers show the in-flight state, then remove.

**Verdict:** instrument-and-revisit.

While the primary device is working, peers show nothing. There is no "preparing reply" or thinking
indicator on the other devices, so a person watching their desktop cannot tell the difference
between "my phone is mid-answer" and "nothing is happening". Reported by Mac, 16 Aug 2026, during
the guided journey.

Related to the entry above: the peers do eventually receive tool events, so SOMETHING streams -
what is missing is any signal that a turn is in flight.

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

## Test coverage we know we are missing (Mac's list, 16 Aug 2026)

_Re-checked 2026-10-22: only the items still open are listed._

Device journeys with no recorded result:

- Huge-model eviction on iPhone with a 9B model (`scripts/e2e/model-eviction-journey.mjs` exists).
- GPU/NPU selection read back on a device.
- Voice mode end to end (`scripts/e2e/two-device-voice.mjs` exists).
- Copy outside the app reaching the clipboard on iOS.
- Ambient sharing of screenshots and downloads, allowed and disallowed, both ways (shared policy test exists;
  no app journey).
- Model transfer: multi-GB, resume, then load on the receiver for image, vision, text and STT.
- Non-PDF attachments (voice note) end to end on desktop.
- A receiver without the model downloads on demand.
- Interrupted transfers, offline behaviour, and five-device replacement.

Code gaps:

- **Peer-pushed settings skip a device-fit check** - `src/services/sync/mutation.ts` checks type and range only;
  `llmHelpers.ts` sends `n_predict` unclamped. Clamp on receive or at load.
- **`maxToolCalls` syncs** - `mutation.ts` allows 1–100; default 25 (`tool-execution-policy.ts`). Decide
  whether it should sync, and add a test.
- **Vision journeys are Android-only** - `scripts/e2e/vision-answer-sync.mjs` uses the Android producer. Port
  the iOS producer.

## Model memory: the estimate is unscientific, inconsistent, and fails silently

_Re-checked 2026-10-22: only the items still open are listed._

The estimate now counts context (`82cb512f7`, `1d0800588`; `activeModelService/memory.ts`), and every caller
uses `estimateTextModelMemoryMB`. Still open:

- **Fallback multipliers** - `TEXT_MODEL_*_MULTIPLIER` (`types.ts`) still apply to LiteRT models and when GGUF
  metadata is missing. Calibrate from logged footprints and replace them.
- **Refusal card** - `ModelFailureCard` offers Load Anyway (`activeModelService/index.ts`) but names no numbers.
  Show needed vs free memory and a "Reduce context" action.

## The selected text model is never resident on a 3-model device (16 Aug 2026, iPhone)

**Check 2026-10-22:** code mostly fixed: shared residency policy (`04845bd1d`) and a context-aware estimate (`82cb512f7`). Re-run `scripts/e2e/model-eviction-journey.mjs` on the iPhone and confirm "never resident: text" is empty.

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
- Qwythos loaded earlier in the same session once the context was lowered to 1k. At the time the
  gate's cost model was context-blind; superseded by the context-aware estimate (`82cb512f7`).
  Re-check with the journey.

**Cover it.** The journey is the regression test: any change to the cost model should be run against
it, and `never resident at any stage: text` should become empty.

## Voice: hands-free, barge-in and note trimming — 2026-08-17

_Re-checked 2026-10-22: only the items still open are listed._

- **Desktop consumes only part of the shared voice logic** - desktop imports `SpeechEndpointTimer`,
  `VOICE_TURN_LABELS` and `VoiceTurnMode` (`5cacb52c8`), not `canArmHandsFreeTurn`, onset look-back, WAV trim or
  the `voice-session` machine.
- **Barge-in is not possible** - `audioRecorderService.ts` `isEchoCancelled()` returns false on both platforms.
  Playback and capture need one shared voice-processing engine (native work).
- **`@offgrid/speech` is a mixed package** - its description says gateway client only, but it holds
  voice-turn, voice-session and wav-trim. Split it, or fix the description.
- **Post-reply hand-back overhead** - not measured. Read it from a device log.
- **Replay-in-session and delay settings** - code in `8f62f6c82`. Device pass owed.
- **Queued outbound transfers do not follow a new address and never expire** - the orchestrator re-dials
  (`orchestrator.ts`), but queued transfers are not re-targeted and have no expiry.
- **Sender dying mid-batch leaves zombie receiver rows** - `transfer/manager.ts` `handleDisconnect` does not
  fail rows created at offer time, and the whole queue is marked in progress. Time them out; mark only the
  file on the wire.

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

## Release 107 QR, reconnect, and residency changes need final Mobile proof

**Check 2026-10-22:** the code repairs below are all on `main` (`efbe3e700`, `pro/sync/pairingQr.ts`, `src/services/networkReconnect.ts`). Only the installed-device proof is left; the "code repair in progress" lines are out of date.

**Status:** Shared QR and Android residency Code evidence pass. The Mobile code repairs are done
(see the check above). Final iOS and Android Built and Live verified gates are open. Filed 2026-08-30.

The Shared pairing contract is built and tested. The Sync ESM, CJS, and DTS builds pass. Focused QR,
real-handshake, and ESM/CJS runtime checks pass 21/21. The final QR suite passes 11/11. Sync typecheck,
focused ESLint, and diff check pass.

The Android residency crash came from resolving a Kotlin `LinkedHashMap` through a React Native
Promise. `MeshResidencyModule.begin()` and `state()` now use one canonical `ResidencySnapshot` to
`WritableMap` projection. Native checks pass 7/7. Focused rendered checks pass 23/23 with
open-handle detection and a clean exit.

Keep this gap open until these installed checks pass:

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

## Harness: there is NO passive way to observe an iPhone through WDA

**Check 2026-10-22 (moved from the desktop backlog):** passive mode in `scripts/e2e/sync-surface.mjs` now reuses the existing WDA session (`scripts/ios/wda-client.mjs`). There is still no way to read app state outside WDA.

**Status:** open, harness limitation. Learned the hard way 2026-08-07, twice in one session.

Every read of the iOS app goes through a WebDriverAgent session, and creating one is not an
observation - it changes the device:

- `session(bundleId)` LAUNCHES/ACTIVATES that bundle, terminating whatever it was doing. This killed a
  706 MB model transfer that was mid-receive: the snapshot tool called it "read-only by design" while
  relaunching the app it was recording.
- `session()` with no bundle id was the attempted fix. It does not launch the app under test, but it
  still appears to deactivate the FOREGROUND app - a read taken while the user had the app open
  returned the SpringBoard home screen instead.

So `passive: true` on the iOS surface is weaker than its name promises: it will not relaunch the app,
but it cannot be trusted not to disturb what the user is doing.

**Rules that follow, until something better exists:**

1. Never read an iPhone while a person is driving it or a transfer is in flight. Ask them for a
   screenshot instead - it is the only genuinely zero-cost observation.
2. Automated iOS flows are fine, because there the harness IS the driver and nothing else is going on.
3. Android does not have this problem to the same degree: `adb shell uiautomator dump` reads the tree
   without touching the app, and only `session()`'s `monkey` launch foregrounds it, which `passive`
   now skips.

**Worth investigating:** whether an iOS read can be taken outside WDA entirely - the app could expose
its own state over a dev-only local endpoint, which the harness reads without going near the UI. That
would make observation free on every platform and is probably the right long-term answer for a suite
that has to watch journeys it is not driving.

## MTP is a mobile feature, and it should be a `@offgrid/models` one

**Check 2026-10-22 (moved from the desktop backlog):** desktop now supports MTP and the heads table is shared (`shared/packages/models/src/mtp-heads.ts`). The "declares MTP" check still lives in both `src/utils/mtpSupport.ts` and desktop `gguf-metadata.ts`. Move it into `@offgrid/models`.

**Status:** open. Filed 2026-08-12. Deliberately NOT in the current PR - it is a package extraction,
not a fix, and folding it in would bloat a release branch that is about sync feedback.

**The gap.** Both apps now support MTP, but the "declares MTP" rule is written twice:
`src/utils/mtpSupport.ts` on mobile and `gguf-metadata.ts` on desktop. Both apps consume the same
model layer, so a rule that lives in each app's code has two homes and can drift - the shape this repo keeps finding at the root of its bugs.

**Why it is a shared-package problem, not a desktop one.** Copying the mobile implementation across
would make it a rule with TWO homes, which is worse than having it once. The model layer is the owner:
whether a model needs MTP, which artefacts it implies, and how a device advertises support are all
properties of the MODEL, and every surface should be asking `@offgrid/models` rather than each app
deciding for itself. Desktop then gets it by consuming the package, and so does any future surface.

**Fix shape.**

1. Move the MTP capability rule into `shared/packages/models` - one definition of what MTP is and which
   models require it, keyed off the catalog entry, with no app-specific branching inside it.
2. Mobile stops deciding and starts asking. Its current behaviour is the reference for what the rule
   must produce, so it is the regression check that the extraction changed nothing.
3. Desktop consumes the same rule. No `if (platform)` in either app: a platform that cannot serve MTP
   reports that through the same interface, it does not get a special case at the call site.

**Watch for:** the mobile implementation almost certainly carries assumptions that are really about the
phone runtime rather than about MTP. Those belong on the platform adapter, not in the shared rule - and
the tell is any code in the extracted package that names a platform.
