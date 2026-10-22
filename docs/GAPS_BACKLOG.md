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

## LiteRT-LM 0.18.0 is not checked on an Android phone - 2026-10-17

**Verdict: instrument-and-revisit.**

The runtime upgrade (handoff item 9) was checked on an iPhone 17 Pro Max with llama.rn 0.13.0-rc.7:
a thinking chat completed with Metal (99 layers), tool calls ran, Stop kept the partial reply, and a
vision question about a photo was answered correctly. LiteRT-LM 0.18.0 (`android/app/build.gradle`,
commit c55dd1d72) is Android-only and no Android phone was connected. Still to check on Android: a
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

## Dead-code recon — open items (re-checked 2026-10-22)

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

## On-device test session follow-ups (2026-07-09 session, re-checked 2026-10-22)

- **OD5** - Android retry after a network drop: code in `9b45bab31` and `8d8d09e90`. Device check owed.
- **OD11** - Kokoro beside a large LLM: budget residency (`shared residency-policy.ts`), but the singleModel and
  not-warm paths remain (`streamingSpeech.ts`). Device check with the default policy.
- **OD13** - Qwythos output all in `reasoning_content`: `'auto'` only for gemma-4 names (`llm.ts`); others get
  `'deepseek'` (`llmHelpers.ts`). Pick the format from the template delimiters, or drop the model.
- **OD15** - Jinja "roles must alternate": retry without tools exists only on the remote path
  (`generationToolLoop.ts`). Add the local catch and retry.
- **OD16** - remote capabilities flaky: only hand-made fixtures. Capture live provider fixtures and add a contract test.

## Repo-wide /hygiene audit — open items (2026-07-09, re-checked 2026-10-22)

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

## PR #510 follow-ups still open (re-checked 2026-10-22)

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

## M5a — exact budget boundary untested

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

## Model memory: fallback multipliers and the refusal card

The estimate now counts context (`82cb512f7`, `1d0800588`; `activeModelService/memory.ts`), and every caller
uses `estimateTextModelMemoryMB`. Still open:

- **Fallback multipliers** - `TEXT_MODEL_*_MULTIPLIER` (`types.ts`) still apply to LiteRT models and when GGUF
  metadata is missing. Calibrate from logged footprints and replace them.
- **Refusal card** - `ModelFailureCard` offers Load Anyway (`activeModelService/index.ts`) but names no numbers.
  Show needed vs free memory and a "Reduce context" action.

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
