# UI-behavioral conversion — status (for the morning)

Branch: `refactor/parse-once-boundary` (PR #510). Everything below is COMMITTED, local-only (not pushed —
the pre-push gate blocks the intentional reds; push only after the fixes make them green).

## What's DONE

### Foundation (harness) — committed
- **Real navigation in jest**: mocked `react-native-screens` (Views) + the library's shipped
  `react-native-safe-area-context/jest/mock` in `jest.setup.ts` → a real `NavigationContainer` + native-stack
  mounts & navigates. A/B-verified non-regressing (ChatScreen rntl 310/310 identical; onboarding+components
  1768 identical with/without).
- **Test isolation**: global `afterEach(cleanup)` in `jest.setup.ts` — `installNativeBoundary`'s
  resetModules-per-test forks RTL so its auto-cleanup can't register; the afterEach requires RTL post-reset
  and unmounts. Killed the cross-test flakiness (happy suite 33/33 deterministic).
- **chatHarness** (`__tests__/harness/chatHarness.ts`): `setupChatScreen`, real gesture helpers `send`,
  `tapSend`, `regenerateLast`/`editLastUserMessage` (BOTH menu paths via `openActionMenu(role, via)` —
  long-press AND 3-dots), `settle`, and arrive-via-UI helpers `enableToolViaUI`, `enableGenerationDetailsViaUI`,
  `cycleImageMode`, `placeImageModel` (sets image model AFTER the mount's disk-hydration, which wipes it).

### Adversarial converted / resolved
- **Q2** (unquoted-key tool call) — behavioral: enable calculator via Tools screen, send, wait on visible
  reply, assert tool bubble absent. Falsified (quoted key → bubble renders).
- **Q3** (stringified args) — behavioral: send, assert tool bubble shows an error. Falsified (object args → ok).
- **Q5** (empty final turn) — behavioral. **FINDING: the service-level "(No response)" string is NEVER
  rendered through the streaming ChatScreen; the real symptom is a BLANK assistant reply.** Red now asserts
  that; control green.
- **Q4** (router false-positive) — **resolved to the faithful layer**: it's a PURE function
  (`selectRelevantTools` substring match). Through ChatScreen the routing only runs under MCP-enabled +
  tool-count-over-threshold; with a default set it returns all tools without hitting the substring path.
  Kept the function-level red (labeled documented exception); **removed the un-faithful rendered variant**.
- **N3** (draw + no image model) — **FINDING: UNREACHABLE via UI** (double-guarded:
  `shouldRouteToImageGenerationFn:159` returns false in auto with no image model; the input toggle refuses
  'force' without a model). Converted the red into a GREEN guard locking that safety.
- **Q19** (speak reads raw markdown) — documented **audio-boundary** surface: symptom is audio, tested at the
  text-fed-to-TTS seam (real MessageRenderer). Still red.

### Happy (behavioral / heavy-entry) — committed
firstMessage (llama/litert/metal), resend (both menu paths), editMessage (both menu paths), storeFlows
(new project via the real form — caught the required system-prompt field), tools/MCP/show-gen-details,
reasoning, imageIntentRouting (+control), imageBackends (5 backends), smartBudgeting, promptEnhancement,
multimodalVision, convoManagement, persistence, modelLifecycle, residencySwap, transcription, settingsApplied,
imageModeToggle (auto/ON/OFF), **imageLightbox** (tap a generated image → fullscreen viewer opens with
Save/Close; Close dismisses; Save runs the real RNFS save → "Image Saved" + the file lands on the memfs
gallery dir). Full happy suite: **31/31 deterministic** (19 suites).

**Harness fidelity add (imageLightbox):** the diffusion fake now WRITES its rendered PNG to the (memfs) disk
on `generateImage`, mirroring the native module, so the app's downstream file reads (save-to-gallery) find a
real file. Threaded `fsFake.seedFile` into `makeDiffusionFake`. Verified non-regressing (happy 31/31; image
adversarial reds — Q7/Q12/Q13/imageEstimatorDivergence — still red for the right reason).

**Next investigative step — rendered ModelFailureCard (the OOM surface users hit):** no rendered test yet
proves the user SEES the "Not Enough Memory" / "Load Anyway" card. The memory reds (M11/failedUnload/
sttReclaim/imageEstimator/overrideFloor) are pure residency INVARIANTS (documented gesture-less carve-out,
real `makeRoomFor`/resident-set assertions) — defensible, but the card itself is unexercised. Driving it needs
a NO-PRE-LOAD harness mode: `setupChatScreen` currently eagerly `loadTextModel`s, so `isModelReady` short-
circuits the send-time gate (`modelReadiness.ensureModelReady:68`). To surface the card via a real send, the
model must be SELECTED-but-not-loaded with RAM seeded too-small, so the send's lazy load hits
`ensureModelLoaded` → the memory refusal → `modelFailureHandler.report` → `ModelFailureCard`. That's a new
harness option (`skipLoad`) with real regression risk to the 31 green happy tests (all rely on the pre-load) —
do it carefully with the user able to verify, not blind overnight.

## What's LEFT (adversarial, ~30) — and the honest per-cluster notes

- **chat remaining**: Q8 remoteEnhanceSkipped (needs remote-server UI setup), Q17 voiceNoteToolAudio
  (native-crash → arg-level seam), Q20 voiceNoteChatModeEmptyTurn (hook-gesture, OK), thinkingAcrossToolCall
  + speakExcludes (render/audio-seam guards, green), transcriptionEmpty (pure-fn guard), voiceNoteMediaExcluded
  (native-arg guard). Reds red, guards green — each at a defensible altitude; upgrade entries where a gesture
  adds fidelity.
- **settings/image**: Q1/Q7 (imageGenMeta) — **entangled**: the `image-size` slider floors to SWEET_SPOT_SIZE
  (256), so "set 128" comes from Model Settings (different screen) + chat-modal clamp (Q13). Needs the
  cross-screen size-source flow. Q12/Q13 (imageSettings) already gesture-driven. Q14 (estimator divergence)
  is a pure multiplier invariant.
- **projects**: Q9/Q9b/Q10/Q11 — pure store + screens (cleanest to convert next): create project via form →
  file a chat → delete project / context-full → assert the ProjectChatsScreen list.
- **downloads**: V1/V2/V3/D1/D4 — gesture trigger (tap delete/retry) + pre-placed native rows + relaunch;
  the "downloaded model" precondition is a native/disk boundary (pre-place, don't gesture).
- **memory**: M4/M5/M6, M11, failedUnload, sttReclaim, imageEstimator, ttsDelete — mostly budget/residency
  INVARIANTS (documented gesture-less exception); the card-rendering ones can be driven via a send that
  triggers the ModelFailureCard.
- **KB**: indexDocumentRollback, toolEmbeddingStaleDim, searchKB — DB/embedding atomicity invariants
  (documented exception; real in-memory sqlite).

## Setup-fidelity pass (no store-seeding of state) — DONE
Per the "no store setup for state" bar (only download/RAM/native may be pre-placed):
- **Model activation is now a real gesture**: `setupChatScreen` seeds ONLY the download boundary (a
  persisted `@local_llm/downloaded_models` record + the file on disk), then mounts the REAL HomeScreen — its
  real hydration loads the record — opens the picker and TAPS the model row (`handleSelectTextModel`). No
  `setState({activeModelId})`. Verified non-regressing (happy 33/33).
- **Settings via real controls**: `settingsApplied` drags the real Temperature slider (`setTextSettingViaUI`);
  tools uses the real "Show Generation Details" toggle; reasoning's `thinkingEnabled` seed removed
  (unnecessary — the block renders from reasoningContent); pure-default `updateSettings` no-ops
  (autoDetect:'pattern', imageMode:'auto', enhance:false) removed across the suite.

### Setup-fidelity round 2 — DONE
- **Conversation via the real New Chat gesture**: setupChatScreen no longer `createConversation`s — after the
  model-select tap it taps "New Chat" on Home and mounts a NEW chat (the first send creates the conversation).
- **imageBackends / smartBudgeting / multimodalVision** converted from direct service calls to real gestures:
  image model downloaded (real per-backend files on disk = boundary) + activated by the toggle; generated via
  force-mode + send; multimodal via the full attach-photo gesture (attach → Photo Library → faked picker).
- **Regression fixed**: the global afterEach cleanup was requiring RTL fresh after resetModules and breaking
  non-render tests — now scoped to tests that actually rendered (requireRTL stashes its own cleanup).

### Still service/store-driven (honest remainder)
- **promptEnhancement** — the "Enhance Image Prompts" toggle lives in a conditionally-rendered advanced
  section that doesn't mount cleanly standalone; the litert enhancement path is also uncertain. Left at the
  service+meta layer (real service, real native-prompt assertion) with the enhance-setting seeded. Deferred.
- **modelLifecycle / residencySwap** — residency/lifecycle INVARIANTS (load→resident→unload→swap). Model
  select is now a gesture, but unload/delete/swap need the eject/delete buttons (some modal-gated). Partly
  service-layer by nature (the invariant), partly gesturable.
- **persistence** — project + conversation creation should be form + New-Chat gestures, then relaunch.
- **convoManagement** — delete-convo is swipe-blocked in jest; move-to-project + edit are gesturable.

### Older remaining notes
- **Image-model activation**: a few tests still `setState({ activeImageModelId })` (`placeImageModel` /
  imageIntentRouting's `withImageModel`). The image model PRESENCE is a boundary (downloaded), but ACTIVATING
  it should be an image-picker tap (same pattern as the Home text picker). Rework analogous to the text model.
- **Service-level image tests** (`imageBackends`, `smartBudgeting`, `promptEnhancement`) drive
  `imageGenerationService.generateImage` directly. Convert to the ChatScreen force-mode + send gesture (the
  harness now has `cycleImageMode` + `placeImageModel`).

## Key lesson reinforced (folded into /hygiene + LEDGER)
Converting to UI-driven is **investigative, not mechanical** — it repeatedly caught reds asserting symptoms
the user never sees (Q5's "(No response)", N3 unreachable, Q4 pure-fn). Each conversion must: arrive-via-UI,
trigger via the real gesture, wait on a user-visible signal, and be falsified both ways.

## Open questions for you (per your "ask in the morning")
1. **Q1 size-source**: confirm the intended flow — is "128" set in Model Settings then clamped by the chat
   modal (Q13), or should the chat image-size slider allow <256? That decides how to drive Q1.
2. **Source fixes + push**: you asked me to fix the bugs then push when green. Most fixes are safe (parser:
   Q2/Q3; empty-final: Q5), but memory/residency/native fixes carry regression risk you'll want to eyeball.
   Want me to land the safe parser/empty-final fixes autonomously and leave memory/native for your review?
