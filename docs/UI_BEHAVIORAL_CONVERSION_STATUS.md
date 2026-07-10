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
imageModeToggle (auto/ON/OFF). Full happy suite: **33/33 deterministic**.

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
