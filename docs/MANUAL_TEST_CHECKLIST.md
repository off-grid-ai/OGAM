# Off Grid Mobile — Manual Release Test Checklist

A human-walkable, release-gate checklist. Go through this before every release. Independent of any automated
test claims. Aggregated from **both** adversarial/device sessions:
- Prior 6-agent adversarial sweep (`DEVICE_TEST_LOG.md`): Q1–Q20, M1–M11, D1–D4, V1–V5, log-B1–B9.
- Today's on-device wire-capture run (`DEVICE_TEST_FINDINGS.md`): DEV-B1–B33 + validated successes.

**Columns per row:** `ID · 🔴/✅ Sev · Auto · Steps · UI validation · Ref · Device · Result`
- **🔴/✅ Sev:** 🔴 = adversarial (a known/suspected bug — must be FIXED & verified before release) · ✅ = happy
  (must keep WORKING — regression check). Sev = P0 (blocker/crash/privacy) · P1 (major flow) · P2 (UX/cosmetic).
- **Auto:** automated-test coverage — ✅ (test file named) · ❌ none · ~ partial/service-level · n/a.
- **Steps:** the real gestures to imitate (same for a manual tester and the automated UI test).
- **UI validation:** what to assert on the live rendered screen (+ the RED reason for adversarial rows).
- **Ref · Device:** original bug ID · what today's device run observed (BROKEN/WORKS/NOT-RUN/GUARDED/verify).
- **Result:** you fill ✅/❌ + notes each release.

Coverage (verified against the actual test `it()` titles, not names): **110 cases · 52 automated (✅) ·
15 partial/service-level (~) · 33 not yet automated (❌) · 10 n/a (product-decision / code-review / infra).**
UI-integration reds written this pass (all `__tests__/integration/`, red-for-the-right-reason, device-grounded):
T001 (`downloadCountDivergence`), T022 (`whisperResidentOnDownload`), T023 (`ejectAllLeavesWhisper`),
T075+T080 (`chatModeSttArchitecture` — chat-mode STT never transcribes; full ChatScreen + real mic gesture).
Areas 1–14 = user-facing flows (T001–T098); **Area 15 (T099–T110)** = the latent/architecture/infra findings
from the 2026-07-12 cross-check that had no row (so this doc is the ONE exhaustive record).
Paste any table into Sheets/Excel (pipe-delimited).

---

## Automation surface plan — what src each new UI test touches (verified against code, 2026-07-12)

Every un-automated row is being turned into a **UI-behavioral integration test** (mount the real screen, arrive
at the precondition via real gestures, run the whole real stack over fakes at the **device boundary only**,
assert the **terminal artifact the user perceives**). No `store.setState` on the state under test. The honest
accounting of which rows need a src touch (grounded in the code, not guessed):

- **✅ No src change (~75 rows).** Assert on surfaces that already render: reply text, tool-result bubbles,
  generated image + **`GenerationMeta` backend/layers/tok/s** (renders `GPU (24L)` / `CPU` when *Show
  Generation Details* is on → covers the text-backend cluster **T014/T015/T021**), `ModelFailureCard` "Not
  Enough Memory" (**T024/T027/T028**), download cards (**T004–T008**), error bubbles, transcript-in-input,
  thinking block (**T033/T035**), project lists, "No servers found", the **`isRemote` header indicator**
  (**T098**, `ChatScreenComponents.tsx:109`), `stop-button` (**T077/T088**, `ChatInput/index.tsx:312`),
  lightbox, etc.
- **🔧 `testID` added — existing surface, just a selector (~5 rows).**
  **T001** (downloads badge count + DownloadManager running/queued counts), **T003** (model ready/preparing
  status label), **T057** (pre-send attach thumbnail tap target), **T086** (thinking-bubble + voice-note-bubble
  to compare widths).
- **🏷️ Test-mode-only label behind a jest-only flag (never dev/prod) (~5 rows).** The **resident set**
  (`getResidents()`) has no clean UI surface — the Models Manager sheet shows per-*type* rows
  (`models-row-${type}`), not "is whisper resident". So **T022/T023/T025/T026/T030** get one small
  `probe-residents` label gated by a new `__TEST_PROBE__` flag (set only in jest setup). **T016/T072** (8s GPU
  timeout, enhancement-slow) — timing isn't rendered; assert the *outcome* on existing surfaces and drop the
  raw-timing sub-assertion (no label) unless a `probe-timing` is later wanted.
- **🎧 Audio-boundary — assert at the boundary stub, not the UI (documented §D audio exception) (~3 rows).**
  **T081/T082** (TTS speaks / markdown-stripped): audio isn't a rendered surface; assert what reached the
  `speak` seam (already how `speakMessage`/`speakMarkdown` work). No src change.

Bottom line: the only planned src touches are **~5 `testID`s** + **one `probe-residents` test-mode label**
(+ its `__TEST_PROBE__` jest-only gate). Everything else rides existing rendered output or the audio boundary.

---

## Area 1 — Model download & management

Columns: **Auto** = automated test (✅ file · ❌ none · ~ partial). **Steps** = gestures to imitate (same for a
manual tester and the automated test). **UI validation** = what to assert on the live rendered screen.

| ID | 🔴/✅ Sev | Auto | Steps (gestures to imitate) | UI validation (assert on live screen) | Ref · Device | Result |
|---|---|---|---|---|---|---|
| T001 | 🔴 P1 | ✅ `downloadCountDivergence.rendered.redflow` | Mount ModelsScreen → tap download on a **vision** model (mmproj → 2 rows, per log: `SmolVLM-Instruct-Q4_K_M.gguf` + `…-mmproj.gguf`) → read `downloads-icon` badge (`vm.activeDownloadCount`) → tap `downloads-icon` → DownloadManagerScreen | `downloads-icon` badge number **==** DownloadManagerScreen running (`activeDownloadingCount`) + queued (`activeQueuedCount`) (RED: device saw badge **10** vs screen **4+7=11** — off by 1 while mmproj in-flight). Falsify: non-vision model (no mmproj) → equal | DEV-B7 · BROKEN | |
| T002 | 🔴 P2 | n/a (product decision) | Drive `DownloadComplete` for a text model, then an image model, in the same foreground state | completion notification behavior is consistent + intentional. NOTE: my earlier "image notifies, text doesn't" was CORRECTED — device showed **text models DID notify** (SmolLM3, Mistral); real variable is foreground/timing. User's gripe: the toast is noisy ("shouldn't have come"). *Product decision: show a completion toast at all?* **Reds-pass: SKIPPED — no falsifiable bug (behavior is type-independent/consistent); "should the toast exist" is a product question, not a spec violation.** | DEV-B4 · corrected (type-independent) | |
| T003 | 🔴 P1 | n/a (not reproducible) | Start image-model download → fake emits native `DownloadComplete` but zip NOT extracted (no `_ready`, integrity files absent on memfs) → select model + image-mode send | model status ≠ "ready/usable" until extracted; on generate a visible "preparing/extracting" state (RED: "downloaded successfully" fires at native-complete, extract deferred) **Reds-pass: SKIPPED — code gates readiness on extraction: `imageDownloadActions.ts:446-453` does unzip → `ensureImageExtractionComplete` (integrity) → `_ready` → THEN `registerAndNotify`. The device's premature "downloaded successfully" was the native NOTIFICATION (T002), not app readiness. Mid-unzip-kill recovery is covered by T004.** | DEV-B4 · PREMATURE→corrected | |
| T004 | 🔴 P1 | ✅ `imageExtractLostRelaunch` | Seed image download that completes-then-extraction-fails (missing `unet.bin`) → `simulateRelaunch()` (fresh stores, drop native rows, keep disk) → mount DownloadManagerScreen | a retriable/removable **failed card** renders after relaunch (RED: none renders — store not persisted, dir/zip unlinked) | D1/log-B7 · BROKEN | |
| T005 | 🔴 P1 | ✅ `whisperDeleteCancelsOther` | Start `base.en` whisper download (fake, in-flight) → mount DownloadManagerScreen → tap delete on downloaded `small.en` → confirm alert | `base.en`'s in-progress card **still present** after deleting small.en (RED: it vanishes — deleteModel cancels the single activeDownloadId) | V1 · BROKEN | |
| T006 | 🔴 P1 | ✅ `whisperTruncatedListed` | Seed a truncated `ggml-<id>.bin` on disk (below size floor) → mount DownloadManagerScreen / model list | truncated file NOT listed as a completed/loadable model (RED: shown as downloaded — name-only filter, no size floor) | V2 · BROKEN | |
| T007 | 🔴 P1 | ✅ `sttInterruptedRelaunch` | Seed STT download killed mid-flight → `simulateRelaunch()` → mount DownloadManagerScreen | a retriable/removable entry renders (RED: empty — store not persisted, no disk scan) | V3/D1 · BROKEN | |
| T008 | 🔴 P2 | ✅ `iosInterruptedNoFailedEntry` | iOS-shaped: download running → drop the native URLSession row (app-kill) → `simulateRelaunch()` → mount DownloadManagerScreen | a stranded/failed entry renders (RED: vanishes — reconcile reads empty native-rebuilt store) | D4 · NOT-RUN device | |
| T009 | ✅ P1 | ~ `searchKnowledgeBaseRoundtrip`/`indexDocumentRollback` | Mount → create project (form) → attach a text PDF to its KB (attach gesture); PDF fake returns real text; embed fake 384-dim | KB shows the doc indexed (chunk/embedding count); no error card | DEV · WORKS | |
| T010 | 🔴 P2 | ❌ | Attach a **scanned/image** PDF (pdf fake returns textLength:0) to a KB | a clear "no text layer / scanned PDF" message renders (RED: vague "could not extract text") | DEV · 0-text vague | |
| T011 | ✅ P2 | ❌ | Attach a **>5MB** PDF to a KB (fake file size >5MB) | "Maximum file size is 5MB" renders + upload rejected (guard WORKS — regression-confirm it stays gated) | DEV · GATED | |
| T012 | ✅ P2 | ❌ | Seed N downloaded models (boundary) → mount ModelsScreen | the solid downloaded-count badge renders == N | DEV · WORKS | |

## Area 2 — Model load & compute backends

| ID | 🔴/✅ Sev | Auto | Steps (gestures to imitate) | UI validation (assert on live screen) | Ref · Device | Result |
|---|---|---|---|---|---|---|
| T013 | ✅ P1 | ✅ `firstMessage`/`modelLifecycle` | Model downloaded (boundary) → mount Home → tap `browse-models-button` → tap `model-item` (select) → tap `new-chat-button` → type + send | reply text renders in an assistant bubble (lazy-load on first send works) | DEV · WORKS | |
| T014 | ✅ P1 | ❌ | Mount → Model Settings → Text → Advanced → tap Backend → **GPU/OpenCL** → reload → send; llama-load fake reports OpenCL offload | reply renders; (invariant) load path shows GPU layers offloaded, not 0 | DEV · WORKS (24/36) | |
| T015 | 🔴 P1 | ❌ | Same, Backend = **NPU (Beta)/HTP** → reload → send; llama fake: HTP loads then emits gibberish tokens (real B22 shape) | assistant reply is a **correct answer**, not gibberish/empty (RED: NPU loads but generation is garbage) | DEV-B22 · BROKEN | |
| T016 | 🔴 P2 | ❌ | GPU backend, first load; llama-load fake models 8s init-timeout → retry → 24/36 | load succeeds without a silent 8s hang / partial-offload surprise (invariant on the load path; labeled) | DEV-B24 · timeout→24/36 | |
| T017 | ✅ P1 | ✅ `firstMessage` (litert) | litert model downloaded → select via Home picker → new chat → send | reply renders (litert GPU works) | DEV · WORKS | |
| T018 | 🔴 P1 | ✅ `litertCpuInvokeError.rendered.redflow` | Select litert model → Advanced → Backend = **CPU** → reload → send; litert fake emits `Status 13 Failed to invoke the compiled model` | an answer renders, OR the CPU option isn't offered for a GPU-compiled model (RED: error alert shows, NO answer bubble). Native step (manual): CPU actually throws Status 13 for a .litertlm | DEV-B23 · BROKEN | |
| T019 | 🔴 P2 | ❌ | litert + tools enabled + a tool prompt (long tool-augmented system prompt); litert fake clamps ctx to 880 | a tool-result bubble renders (RED: tool call dropped when the clamp truncates the tool prompt) | DEV-B25 · dropped once | |
| T020 | ✅ P1 | ❌ | Select a litert model in the picker (no send) | model shows loading/loaded on select (eager warm — acceptable) | DEV · WORKS | |
| T021 | 🔴 P2 | ❌ | Load a vision gguf (gemma-4-E2B + mmproj) via select+send | (invariant) estimate not mmproj-inflated → offloads to GPU, not forced 0/36 CPU (RED: est 5854MB → CPU fallback → slow) | DEV-B3 · CPU-fallback | |

## Area 3 — Memory / residency / budget

| ID | 🔴/✅ Sev | Auto | Steps (gestures to imitate) | UI validation (assert on live screen) | Ref · Device | Result |
|---|---|---|---|---|---|---|
| T022 | 🔴 P0 | ✅ `whisperResidentOnDownload.rendered.redflow` | Download an STT model (download fake `complete` event) → do NOT transcribe → load a chat model via picker+send | whisper NOT auto-resident; chat model loads without a phantom 1.5GB resident (invariant: assert `getResidents()` excludes whisper) (RED: whisper auto-loads on download) | DEV-B1 · BROKEN | |
| T023 | 🔴 P0 | ✅ `ejectAllLeavesWhisper.rendered.redflow` | Whisper resident (via the real download gesture) → trigger Eject All (`activeModelService.ejectAll`, the Home button's onPress; button guard needs a co-active text/image model) | after eject, `getResidents()` == [] incl. whisper (RED: ejectAll returns count=1, whisper survives) | DEV-B1 · BROKEN | |
| T024 | 🔴 P0 | ✅ `budgetRedflow`(M2/M3 arithmetic) + `imageOomCard.happy` (card render) | Seed RAM so soft budget≥size but `os_procAvail`<size → drive the load; assert refusal | load refused (graceful "Not Enough Memory" card) / no over-commit (invariant: `fits` gates on PHYSICAL, not soft budget) (RED: fits=true while size>procAvail). **Coverage split (honest): the over-commit ARITHMETIC is a gesture-less invariant → `budgetRedflow` M2/M3 (service-level, red); the CARD render is UI-behavioral → `imageOomCard.happy` (mounts ChatScreen, drops RAM, asserts the card + Load-Anyway). A UI over-commit red isn't added because the chat harness has no per-model-size knob to reproduce the exact reclaim-credit arithmetic — the bug's natural altitude is the service.** | DEV-B2/M2/M3 · BROKEN | |
| T025 | ✅ P1 | ✅ `residencySwap`/`resendAfterImageGen` | Generate an image (image resident) → go to chat → send text | (invariant) text load evicts image (`evicted` contains 'image'); text-model reply renders | M11/DEV · WORKS | |
| T026 | 🔴 P1 | ✅ `budgetRedflow`(M1) | Load text model → start image-gen | text & image do NOT co-reside (`getResidents()` has one heavy) (verify — worked in one device flow) | M1/M16 · verify | |
| T027 | 🔴 P1 | ✅ `imageEstimatorDivergence` | Image model: the pre-load advisory (`checkMemoryForModel` 1.5/1.8×) vs the gate (`estimateImageModelRam` 2.5×) | both estimators agree (invariant) (RED: ~40% divergence → "safe to load" then a hard "not enough memory" card) | Q14 · BROKEN | |
| T028 | 🔴 P1 | ✅ `overrideFloor` | Load-Anyway a too-big dirty model at low real free RAM (RAM fake) | survival floor BLOCKS the guaranteed OOM (invariant: post-load free ≥ floor uses REAL free, not credited ceiling) | M3/M4 · verify | |
| T029 | 🔴 P2 | ✅ `overrideFloor`(M5) | iOS 12GB, 3.1GB free → Load-Anyway a 2GB dirty litert model (RAM fake, platform ios) | NOT over-refused (loads) (RED: flat 1200 floor over-refuses a safe load) | M5 · NOT-RUN device | |
| T030 | 🔴 P1 | ✅ `ttsDeleteResidencyStale` | Load TTS (registers key:'tts') → delete TTS in DM (gesture) → load a text/image model | no phantom TTS pressure (invariant: `release('tts')` fired on delete → resident set excludes tts) (RED: 320MB phantom → wrong refusal) | V4 · BROKEN | |
| T031 | ℹ️ P0 | n/a (device-stress observation) | Drive a very long/runaway context, keep sending | thermal-throttle → 30–47s/token → crash under heavy/polluted context. **IGNORED per user: a device-stress data point (user was intentionally pushing past limits), not a fixable/testable app bug — no app-side guard to assert.** | DEV-B31 · observation | |

## Area 4 — Text generation (thinking / streaming / stop / queue)

| ID | 🔴/✅ Sev | Auto | Steps (gestures to imitate) | UI validation (assert on live screen) | Ref · Device | Result |
|---|---|---|---|---|---|---|
| T032 | ✅ P1 | ✅ `firstMessage` | Thinking off, tools off → type + send a plain prompt (litert fake streams a clean answer) | reply text renders in the answer bubble; NO stray `<think></think>` block | DEV · WORKS | |
| T033 | 🔴 P1 | ~ `reasoningPipeline`(LOCAL split) | Thinking ON → send a reasoning prompt; llama fake streams `<think>…</think>` (Qwen) tokens | during streaming, reasoning tokens render in the THINKING block (answer bubble stays empty) from token 1 (RED: they render in the answer bubble until the close delimiter, then reclassify) | DEV-B14/B5 · BROKEN | |
| T034 | 🔴 P2 | ❌ | Send a prompt whose completion hits the max-predict cap (fake: `stopped_eos=false` at n_predict) | a "cut off / continue" indication renders (RED: silently truncated mid-sentence, no signal) | DEV-B15 · silent cutoff | |
| T035 | 🔴 P2 | ~ `reasoningPipeline`(REMOTE) | litert/remote turn (separate reasoning channel) — assert the thinking-box header WHILE reasoning streams | header reads "Thinking…" while streaming (RED: shows the DONE label + "T" badge; llama inline `<think>` is correct → divergence) | Q6 · BROKEN | |
| T036 | ✅ P1 | ✅ `queuedSendFeedback` | Send msg 1 (fake holds it streaming) → type + send msg 2 before it finishes | both replies render in order; neither dropped/collided | DEV · WORKS | |
| T037 | ✅ P1 | ✅ `generationFlow`(stop/save-partial) | Start a generation → tap the Stop button (input transforms to stop) mid-stream | generation halts; partial text retained; input returns to send state; next queued item proceeds | DEV · WORKS | |
| T038 | ✅ P2 | ~ `thinkingAcrossToolCall`/`toolExtensionLoop` | Thinking + calculator on → send a reason+compute prompt (fake: reason→tool→reason→answer, real multi-round shape) | thinking block, tool-result bubble, and final answer all render in order | DEV · WORKS | |

## Area 5 — Tools (calculator / MCP / parallel)

| ID | 🔴/✅ Sev | Auto | Steps (gestures to imitate) | UI validation (assert on live screen) | Ref · Device | Result |
|---|---|---|---|---|---|---|
| T039 | 🔴 P1 | ✅ `toolMessyJson` | Enable a tool (Tools screen switch) → send; fake emits a tool_call with **unquoted keys / trailing comma / single quotes** | a tool-result bubble renders with real data (RED: MCP strict JSON.parse drops it → "I couldn't find anything"). Falsify: quoted JSON → bubble renders | Q2 · BROKEN | |
| T040 | 🔴 P2 | ✅ `toolStringifiedArgs` | Tool on → send; fake emits `"arguments":"{...}"` (stringified) | tool runs with parsed params → result bubble (RED: raw string sent → error/empty bubble) | Q3 · BROKEN | |
| T041 | 🔴 P2 | ✅ `toolRouterFalsePositive` | Several tools; router prose contains a tool name as substring / says "none" | correct/no tool selected (RED: substring force-selects the wrong tool; "none" branch skipped) | Q4 · BROKEN | |
| T042 | 🔴 P1 | ✅ `toolEmptyFinal` | Tool on → send; fake: tool returns data, final turn EMPTY | the assistant bubble shows the tool data / non-empty reply (RED: blank reply; data discarded — note "(No response)" is never rendered through streaming) | Q5 · BROKEN | |
| T043 | ✅ P1 | ✅ `tools` | Enable calculator (real Tools-screen switch) → new chat → send "use the calculator: 500×321" | a tool-result bubble + correct answer (160500) render | DEV · WORKS | |
| T044 | ✅ P1 | ~ `tools` | Calculator on → send two calculations in one prompt (fake: parallel tool_calls index 0+1) | two tool-result bubbles render; both correct | DEV · WORKS | |
| T045 | ℹ️ P2 | n/a | 0.8B model + tools, no explicit "use tool" nudge | (KNOWN model limit) small models under-call tools — not an app bug; no test | DEV · model-limit | |

## Area 6 — Remote providers (OGAD / LM Studio / Ollama)

| ID | 🔴/✅ Sev | Auto | Steps (gestures to imitate) | UI validation (assert on live screen) | Ref · Device | Result |
|---|---|---|---|---|---|---|
| T046 | ✅ P1 | ~ `remoteProviderRouting` | Mount remote-server config → scan (fake HTTP returns a server) or manual-add URL → tap connect | server appears + connects (connected state renders) | DEV · WORKS | |
| T047 | 🔴 P2 | ❌ | Scan with no server (fake HTTP: none) | "No servers found" AND the server list stays empty (RED: shows "none found" yet adds a server) | DEV-B8 · desync | |
| T048 | ✅ P1 | ~ `remoteProviderRouting`/`reasoningPipeline` | Connect remote (OpenAI-compat fake replays real `[WIRE-REMOTE]` deltas) → send the 5 prompts | correct replies; thinking + parallel tool_calls render (accumulate by index) | DEV · WORKS | |
| T049 | 🔴 P1 | ❌ | LM Studio remote + reasoning model + thinking; fake emits `reasoning_content` deltas | thinking block renders (RED: no thinking toggle → thinkingEnabled=false → processDelta drops `reasoning_content` → reasoning=0). Tools DO work | DEV-B16 · BROKEN | |
| T050 | 🔴 P1 | ❌ | Mount chat settings with a remote model active | a thinking on/off toggle is present (RED: absent for remote) | DEV-B17 · MISSING | |
| T051 | ✅ P1 | ~ `remoteProviderRouting` | Ollama remote (native NDJSON fake, `message.thinking` field) + tools → send | thinking renders + tool-result bubbles render | DEV · WORKS | |
| T052 | 🔴 P1 | ✅ `remoteEnhanceSkipped` | Active text model = remote + image-gen + enhancement on → generate | enhancement runs via the remote model (RED: `generateStandalone` has only llama/litert branches → skipped on remote) | Q8 · BROKEN | |
| T053 | 🔴 P2 | ❌ | Open the model modality selector with a remote model selected | remote model is visually marked (cloud icon) (RED: identical to local, no indicator) | DEV · no indicator | |

## Area 7 — Vision (multimodal)

| ID | 🔴/✅ Sev | Auto | Steps (gestures to imitate) | UI validation (assert on live screen) | Ref · Device | Result |
|---|---|---|---|---|---|---|
| T054 | ✅ P1 | ✅ `multimodalVision` | Vision model active → tap attach → Photo Library → faked picker → type "what's in this image?" → send | a coherent description of the (faked) image renders | DEV · WORKS | |
| T055 | 🔴 P1 | ❌ | Attach image to a bigger vision model → send; llama fake models the `invalid token / failed to decode` (SmolVLM/Qwen2B shape) | a description renders (RED: "Failed to evaluate chunks" error). Falsify: Qwen0.8B-shape → works | DEV-B9 · BROKEN | |
| T056 | 🔴 P1 | ✅ `errorClearsSpinner.rendered.redflow` (PROVEN: falsified via chatStore.clearStreamingMessage; local path — remote path still ~) | Drive a generation that errors (e.g. the B9 vision decode fail) | the loading spinner CLEARS + an error bubble renders (RED: session ends reason=error but UI spins forever) | DEV-B13 · BROKEN | |
| T057 | 🔴 P2 | ❌ | Attach an image → tap the thumbnail in the input box (pre-send) | a preview opens (RED: tapping does nothing) | DEV · no preview | |
| T058 | 🔴 P2 | ❌ | Load gemma-4-E2B litert (reports supportsVision:true) then its gguf variant → check the attach/vision affordance | vision affordance consistent across engines (RED: litert hides vision, gguf shows it) | DEV-B20 · inconsistent | |
| T059 | 🔴 P1 | ✅ `voiceNoteToolAudio` | LiteRT model + a tool enabled → record a voice note → send | the TRANSCRIPT reaches the model, raw audio is NOT sent (RED: litert tool-loop re-derives audioUris → "File does not exist") | Q17 · BROKEN | |
| T060 | 🔴 P1 | ~ `voiceNoteToolAudio` | Attach an image on a non-vision LiteRT model + a tool → send | graceful "does not support images" (RED: no vision gate → raw native crash) | Q17b · BROKEN | |

## Area 8 — Image generation & settings

| ID | 🔴/✅ Sev | Auto | Steps (gestures to imitate) | UI validation (assert on live screen) | Ref · Device | Result |
|---|---|---|---|---|---|---|
| T061 | ✅ P1 | ✅ `imageBackends`/`imageModeToggle` | Image model placed (boundary) → cycle image-mode to ON (`quick-image-mode`) → tap send "a fox in snow" | a generated image renders; details show the correct backend label (MNN GPU / Core ML) | DEV · WORKS | |
| T062 | ✅ P1 | ✅ `resendImageRoutes` (text) + `voiceModeResendImageRoutes` (voice) + `voiceModeResendEnhancedImage` (voice+enhance) | Send "draw a dog" (routes to IMAGE ✓) → open action menu (long-press/3-dots) → tap **Regenerate/Resend** | resend re-runs the IMAGE pipeline (re-drawn image renders), does NOT fall to the text model. FIXED by `recordedTurnKind` scanning EVERY reply in the turn (replayed via `resolveTurnKind`, no classify). Falsified: breaking `messageHasImageOutput` (pre-fix B33 mechanism) turns ALL THREE guards RED. Device failure was the pre-fix build. | DEV-B33 · FIXED+GUARDED (text+voice+enhance) | |
| T063 | ✅ P2 | ✅ `imageGenMeta` (guard) | Mount image settings → drag the image-size control to minimum | the size input floors at 256 (can't select 128) — green guard | Q1/DEV · GUARDED | |
| T064 | 🔴 P2 | ✅ `imageGenMeta`/`imageSettings` | Set image size (via Model Settings path) → generate | generated size == the size set (no silent floor at gen). Currently guarded at input (256 min) so the red is the chat-modal clamp divergence (Q13) | Q1/Q13 · guarded | |
| T065 | 🔴 P2 | ✅ `imageGenMeta` | Force `imageGuidanceScale` 0/stale → generate | meta shows cfg **7.5** (RED: drifts to 2.0 — three fallback literals) | Q7 · BROKEN | |
| T066 | 🔴 P2 | ✅ `imageSettings` | Change image params → open Chat Settings sheet → tap "Reset to Defaults" | image steps/size/guidance/threads ALSO reset (RED: only the 7 text params reset) | Q12 · BROKEN | |
| T067 | 🔴 P2 | ✅ `imageSettings` | Compare the Image-Size/Steps sliders in the chat modal vs Model Settings | same mins/fallbacks (RED: 256 vs 128 divergence — the root of Q1) | Q13 · BROKEN | |
| T068 | ✅ P1 | ✅ `imageLightbox` | Generate an image → tap the rendered `generated-image` | fullscreen viewer opens with Save/Close; Close dismisses; Save → "Image Saved" + file on disk | DEV · WORKS | |
| T069 | ✅ P1 | ✅ `imageIntentRouting` | With an image model active, send "what is the capital of France" (non-draw) | routes to TEXT (answer renders), image generator NOT called | DEV · WORKS | |
| T070 | ✅ P2 | ✅ `imageGenerationFlow`(120s notice) | First image gen on a model | the "~120s one-time" warmup notice matches actual time (or is accurate) (device: said 120s, was ~10s — cosmetic) | DEV-B21 · misleading | |

## Area 9 — Prompt enhancement

| ID | 🔴/✅ Sev | Auto | Steps (gestures to imitate) | UI validation (assert on live screen) | Ref · Device | Result |
|---|---|---|---|---|---|---|
| T071 | 🔴 P1 | ~ `imageGenerationFlow`(strips `<think>`; but device saw enable_thinking=true leak) | Enable "Enhance Image Prompts" + thinking ON → send "draw a cat" | the enhancement request carries **no thinking** (`enable_thinking !== true`) and the enhanced prompt has NO reasoning markers (RED: "Thinking Process:…" becomes the image prompt) | DEV-B30 · BROKEN | |
| T072 | 🔴 P1 | ❌ | Same — measure the enhancement generation length | enhancement is a fast plain completion, not a multi-thousand-token reasoning chain (RED: slow "million characters") | DEV-B30 · SLOW | |
| T073 | 🔴 P2 | ❌ | During the enhancement step | it streams / shows progress (RED: static "Enhancing…", looks frozen) | DEV-B30b · no stream | |
| T074 | ~ P2 | ✅ `imageGenerationFlow`/`promptEnhancement` | Enhancement on, thinking OFF → generate | prompt rewritten → image regenerated from it (mechanics work; existing test is service-level, not UI-gesture) | DEV · works | |

## Area 10 — STT / voice input

| ID | 🔴/✅ Sev | Auto | Steps (gestures to imitate) | UI validation (assert on live screen) | Ref · Device | Result |
|---|---|---|---|---|---|---|
| T075 | 🔴 P0 | ✅ `chatModeSttArchitecture.rendered.redflow` (shared w/ T080) | **Chat mode** → tap the mic (VoiceButton) → speak → release; whisper realtime fake | a transcript lands in the input / a message is sent (RED: `hasData:false` → nothing on screen). Falsify: the working file-transcribe path yields text | DEV-B26 · BROKEN | |
| T076 | 🔴 P1 | ✅ `voiceNoteChatModeEmptyTurn` | **Chat mode**, direct-audio model → record a voice note → send | the TRANSCRIPT reaches the model, never raw audio (RED: `onAudioAttachment` sends audio, content='') | Q20/DEV-B10 · BROKEN | |
| T077 | 🔴 P1 | ❌ | Start recording (mic) → wait / navigate away | recording auto-stops; whisper doesn't stay resident (RED: 7+ min capture, whisper resident 1.5GB) | DEV-B11 · BROKEN | |
| T078 | 🔴 P2 | ❌ | Double-tap the mic quickly (start-while-recording) | no `State:-100` race / collision; clean single recording (RED: "Already recording, stopping first" → race error) | DEV-B12 · BROKEN | |
| T079 | ✅ P1 | ✅ `transcription` | **Voice mode** → record a note (fake `transcribeFile` returns real `{segments:[{text}]}`) | the correct transcript renders (real whisper segment shape) | DEV · WORKS | |
| T080 | 🔴 P0 | ✅ `chatModeSttArchitecture.rendered.redflow` | ARCHITECTURE seam: both chat-mode and voice-mode STT | both routes go through ONE transcribe pipeline (record→file→transcribe) (RED: 3 divergent mechanisms — the root of B26/Q20) | DEV-B28 · BROKEN | |

## Area 11 — TTS

| ID | 🔴/✅ Sev | Auto | Steps (gestures to imitate) | UI validation (assert on live screen) | Ref · Device | Result |
|---|---|---|---|---|---|---|
| T081 | ✅ P1 | ✅ `speakMessage` | Register the `audio.*` hook seam (kokoro) → open a reply's action menu → tap Speak (`action-speak`) | the reply's text is dispatched to the audio engine (kokoro synth); no Speak on user messages | DEV · WORKS | |
| T082 | 🔴 P1 | ✅ `speakMarkdown` | **Chat mode** → tap the speaker on an assistant bubble with markdown | the text fed to TTS is markdown-stripped (no `**`/`##`/backticks/pipes) (RED: MessageRenderer passes only `stripControlTokens`) | Q19 · BROKEN | |
| T083 | 🔴 P2 | ❌ | TTS playing → delete the TTS model in DM (gesture) | graceful (canEvict veto), no broken playback (verify) | V5-gap · verify | |

## Area 12 — Voice-mode journeys (end-to-end)

| ID | 🔴/✅ Sev | Auto | Steps (gestures to imitate) | UI validation (assert on live screen) | Ref · Device | Result |
|---|---|---|---|---|---|---|
| T084 | ✅ P1 | ❌ | Voice mode + image model active → record "draw a dog" (fake STT → "Draw a dog.") | STT transcript → ROUTE-SM → IMAGE pipeline → image renders → TTS confirmation. Full journey | DEV · WORKS | |
| T085 | ✅ P1 | ❌ | Voice mode + calculator on → record "use the calculator: 500 × 321" | STT → routes to TEXT → calculator tool → correct answer → TTS speaks it | DEV · WORKS | |
| T086 | 🔴 P2 | ❌ | Voice mode → a reply that thinks (render assertion) | thinking bubble width == voice-note bubble width AND left-aligned (RED: full-width, edge-to-edge) | DEV-B27 · BROKEN | |
| T087 | 🔴 P2 | ❌ | Voice mode → after a tool turn (render assertion) | no empty / "#"-only message bubble renders (RED: stray empty `#` bubble) | DEV-B32 · BROKEN | |
| T088 | 🔴 P1 | ✅ `voiceModeGeneratingStopButton.rendered.redflow` (GREEN guard — B29 fixed) | Voice mode, generation in flight (render assertion) | the mic button shows STOP while generating (RED: still a mic → a tap starts a colliding recording → the STT race) | DEV-B29 · BROKEN | |

## Area 13 — Projects & RAG

| ID | 🔴/✅ Sev | Auto | Steps (gestures to imitate) | UI validation (assert on live screen) | Ref · Device | Result |
|---|---|---|---|---|---|---|
| T089 | ✅ P1 | ✅ `searchKnowledgeBaseRoundtrip`(+`indexDocumentRollback`,`toolEmbeddingStaleDim`) | Create project (form) → attach text PDF to KB → new chat in project → ask a doc question (≥2B model); embed fake 384-dim | model calls `search_knowledge_base` → retrieved chunks → answer grounded in the doc; query dim 384 == stored 384 (existing tests cover embed-dim + index rollback, not the full UI round-trip yet) | DEV · WORKS | |
| T090 | 🔴 P1 | ✅ `deleteProjectOrphansChats` | Create a project + file a chat (real ProjectChatsScreen) → open ProjectDetail → tap "Delete Project" → confirm | the chat is not left with a dangling projectId (RED: `deleteProject` doesn't cascade → orphaned) | Q9 · BROKEN | |
| T091 | 🔴 P1 | ✅ `orphanChatInjectsKbTool` | Orphaned chat (project deleted) → send | `search_knowledge_base` is NOT force-injected for the gone project (RED: injected on truthy projectId, project existence unchecked) | Q9b · BROKEN | |
| T092 | 🔴 P1 | ✅ `newChatFilesPendingProject.guard` | New chat → pick a project (before 1st message) → send | chat is filed under the project (RED: `pendingProjectId` in local state lost on send) | Q10 · BROKEN | |
| T093 | 🔴 P2 | ✅ `contextFullNewChatDropsProject` | Project chat → fill context → tap "New chat" in the alert | the continuation chat inherits the project (RED: unassigned) | Q11 · BROKEN | |
| T094 | ℹ️ P2 | n/a | RAG with a 0.8B model | (KNOWN model limit) needs ≥2B to reliably call the KB tool; no test | DEV · model-limit | |

## Area 14 — UI / rendering / misc

| ID | 🔴/✅ Sev | Auto | Steps (gestures to imitate) | UI validation (assert on live screen) | Ref · Device | Result |
|---|---|---|---|---|---|---|
| T095 | ✅ P2 | ❌ | Configure a server+model → complete onboarding (tap continue) | routes straight into the app, skips remaining onboarding | DEV · WORKS | |
| T096 | ✅ P2 | ❌ | Trigger the support-share sheet → tap Share on X → return to app | the sheet is dismissed (doesn't re-nag) | DEV · WORKS | |
| T097 | ✅ P2 | ❌ | Home with a remote model active → read the "Text" count | count reflects reality / "0 local" isn't a misleading desync (verify) | DEV · verify | |
| T098 | 🔴 P2 | ✅ `unifiedModelSelection` | Load a local model → send a NEW message (not a resend) | the generation uses the LOCAL model (`isRemote=false`) (RED-suspected: a resend went `isRemote=true` with gemma resident — verify local-select makes it active) | DEV-B18 · verify | |

## Area 15 — Latent / architecture / infra findings (findings cross-check, 2026-07-12)

These findings from `DEVICE_TEST_FINDINGS.md` + the prior Q/M/D/V sweep (`DEVICE_TEST_LOG.md`) had NO row
until this cross-check. Most are NOT user-gesture tests — they are latent code footguns, SOLID/DRY
violations, or test-infra fixes (the honest "not user-facing" residue). They live here so this checklist is
the ONE exhaustive record. **Auto:** ✅ test · ~ partial · ❌ none · n/a = code-review/infra (no runtime UI
surface). **Verification (2026-07-12):** 10/12 line-refs re-confirmed against CURRENT code — Q15
(`index.ts:427/432/439`), Q16 (`policy.ts:6`+`imageGenerationService.ts:248`), Q18 (`litert.ts:223`), M7
(`index.ts:152`), M8 (`types.ts:50`), M9 (`policy.ts:55`+`index.ts:34`), M10 (jest unanchored), D2
(`scan.ts:229-246`), D3 (`imageDownloadActions.ts`), V5 (`pro/audio/ttsDownloadProvider.ts:75,82`). M4/M6:
the code MECHANISM is confirmed (`memoryBudget.ts` clean/dirty + `aggressive` LoadPolicy) but the exact
admit/refuse THRESHOLDS are the prior log's analysis, not re-derived — hence NEEDS-DEVICE in those rows.

| ID | 🔴/✅ Sev | Auto | Steps (gestures / how to check) | UI validation / invariant (+ RED reason) | Ref · Device | Result |
|---|---|---|---|---|---|---|
| T099 | 🔴 P1 | ~ (`budgetRedflow`/`failedUnloadOverCommits` at T024 cover the caller-side `fits` gate) | Drive a load through a path that calls `ensureResident` directly (RAM fake: model size > `os_procAvail` so `makeRoomFor` returns `fits:false`, no override) | load is REFUSED / no over-commit (invariant: `ensureResident` HONORS `fits`, never loads unconditionally) (RED: `modelResidency/index.ts` `ensureResident` takes only `{evicted}` from `makeRoomFor` and discards `fits`, then loads anyway — the "call the gate, ignore its verdict" class CLAUDE.md forbids). Dead in prod today (callers pre-check `fits`) but a live trap | Q15 · latent OOM | |
| T100 | ℹ️ P2 | n/a (resolve WITH M1/T026) | Read `modelResidency/policy.ts:5-7` + `imageGenerationService.ts:250` vs the balanced planner's actual behavior | doc-drift: the routing doc + comments claim text/image are mutually EXCLUSIVE (swap), but the balanced planner CO-RESIDES them. Fix WITH M1/T026 (make the swap true, don't just edit the doc). Same root as T026 | Q16 · doc-drift (=M1) | |
| T101 | 🔴 P1 | ✅ `litertSamplerRedflow` (service-level) | LiteRT model active, mid-conversation → drag Temperature / Top-P in Chat Settings → send another message (no new chat / no system-prompt change) | the NEW sampler value takes effect on the next send (RED: LiteRT keeps sampling at the ORIGINAL value until a reset — `litert.ts:223` only pushes `samplerConfig` on `needsReset` = id/sys/tools changed, so the fresh config at `generationServiceHelpers.ts` is discarded; llama re-applies every `completion`). Engine parity: both apply mid-convo | Q18 · engine divergence | |
| T102 | 🔴 P1 | ~ (`overrideFloor`/T028 cover the DIRTY floor; the clean-GGUF working-set charge is UNtested) | iOS (RAM fake, platform ios) → Load-Anyway an 8GB **clean GGUF** at ~1200MB free; also a no-override clean 9GB at ~500MB free | the inference WORKING SET (KV/compute, which IS dirty) is charged against the survival floor even for clean mmap weights (RED: clean → `incomingDirtyMB=0` → floor sees full availMem → admits; iOS has no swap for the working set). NB the weight paging being free is CORRECT (device-verified for E4B) — only the working-set charge is missing. **NEEDS-DEVICE** to size the charge; the fake test asserts the JS gate, the human confirms jetsam on iOS | M4 · iOS / needs-device | |
| T103 | 🔴 P2 | ❌ | Aggressive memory policy (0.88 Android / 0.92 iOS) + RAM fake 12GB total / ~3GB free → Load-Anyway a **9GB dirty** (CoreML/ONNX image) model | not admitted / refused (invariant: aggressive headroom still refuses a dirty model that can't be backed) (RED: aggressive admits the 9GB dirty on 12GB@3GB-free; zram/dirty pages can't back it → OOM). Fake asserts the JS admission; human confirms the OOM | M6 · policy edge (both platforms) | |
| T104 | 🔴 P2 | n/a (code-review + FIX-mode) | Code review — `activeModelService/index.ts:152` `const textIsDirty = model.engine === 'litert'` | `dirtyMemory` is a capability the model/engine DECLARES (data on the resident spec), not an `engine === 'litert'` branch in the caller (DIP violation — a new engine needs a caller edit). No runtime UI surface; fix in FIX-mode by moving the flag onto the model/engine | M7 · SOLID/DIP | |
| T105 | 🔴 P2 | n/a (code-review + FIX-mode) | Code review — `activeModelService/types.ts:50` `IMAGE_MODEL_OVERHEAD_MULTIPLIER = Platform.OS === 'ios' ? 1.5 : 1.8` | the overhead is capability-as-DATA (CoreML vs ONNX runtime), normalized once, NOT a `Platform.OS` mechanism branch. Consumed by `memory.ts:53`. No runtime UI surface; fix in FIX-mode | M8 · SOLID/Platform.OS | |
| T106 | 🔴 P2 | n/a (code-review + FIX-mode) | Code review — `SIDECAR_TYPES` is defined TWICE: `modelResidency/policy.ts:55` AND `modelResidency/index.ts:34` (+ the physical-cap expression duplicated) | one definition, imported everywhere (single source of truth) — two owners can drift (a sidecar type added to one, missed in the other). No runtime UI surface; fix in FIX-mode by exporting from `policy.ts` and importing in `index.ts` | M9 · DRY | |
| T107 | 🔴 P1 | n/a (jest.config fix) | Inspect `jest.config.js` `testPathIgnorePatterns`; drop a dummy `.test.ts` under `__tests__/integration/memory/ios/` and confirm jest never runs it | anchor the unanchored `'/android/'` + `'/ios/'` patterns to `<rootDir>/` (as `/pro/` already is) so a platform-named test dir isn't silently skipped; also add `.claude/worktrees/` to the ignore list (currently test-collected — stale worktree dupes in `--listTests`). **VERIFIED 2026-07-12: patterns ARE unanchored, but NO current memory test sits under those paths → the memory suite (T024/26/28/29/30) genuinely runs today; the trap is latent, fix pre-emptively** | M10 · infra (confirmed by 2 agents) | |
| T108 | 🔴 P2 | ~ (tied to T004 `imageExtractLostRelaunch`) | Relaunch mid-unzip: partial extracted dir, no `_ready`, `_zip_name` present, the zip still on disk → the `scan.ts:228-262` recovery | on next launch the recovery re-extracts from the surviving zip (RED: the zip-finalize catch deletes dir+zip FIRST, so this branch can NEVER fire for the primary zip path — dead code). Fixed together with T004 (D1) option b (keep the zip on extract-fail) | D2 · dead branch | |
| T109 | 🔴 P1 | n/a (code-review + FIX-mode; ROOT behind D1/D2/T003/T004) | Code review — `imageDownloadActions.ts` + `imageDownloadResume.ts` own unzip, integrity, `_ready`/`_zip_name` writes, cleanup, store mutation, retry | image download FINALIZE belongs in a SERVICE (an image finalizer under `modelDownloadService`), NOT in the screen — the "no side-effects/finalize logic/store-mutation in presentation" rule. Text has a `textProvider` seam; image has none — this is WHY T003/T004/T108 have no correct home. FIX-mode: build the image finalizer, migrate the logic off the screen | D3 · SoC root | |
| T110 | 🔴 P2 | ~ (T083 is "V5-gap · verify") | With TWO TTS engines registered, one ACTIVE → in DM tap delete/retry on the NON-active TTS engine | the op targets the SPECIFIED engine without flipping the active selection (RED: `ttsProvider.remove`/`retry` do `if (engineId !== active) setEngine(engineId)` → active flips to the target, now model-less; and `setEngine` never `release('tts')`, so the stale resident's unload fn releases the WRONG engine). LATENT — only kokoro registered today, fires when a 2nd TTS ships. Fix: operate on the target instance without switching active | V5 · latent | |

## Platform parity (iOS — run the native-divergent ones)
Re-run on iOS (native differs): T003/T004/T008 (downloads/URLSession-kill), T015–T021 (backends — note litert is
Android-only; iOS has Metal), T024/T028/T029 (memory/jetsam), T054–T056 (vision Core ML), T061/T068 (image Core
ML + lightbox), T075–T080 (STT), T081 (TTS). Shared-JS areas (remote framing, thinking parse, routing) are
covered by Android — don't re-run the full matrix on iOS.

---

### Summary counts (fill Result each release)
- Adversarial 🔴 to verify-fixed: ~63 · Happy ✅ regression: ~25 · Known model-limits ℹ️: 3 · product-decision n/a: 1.
- P0 blockers to watch: T022/T023 (whisper leak+eject), T024/T031 (memory/thermal), T075/T080 (STT capture+arch).
- **Area 15 (T099–T110) — non-user-facing residue:** T099 (Q15 `fits`-ignored OOM footgun), T101 (Q18 litert
  mid-convo sampler), T102 (M4 iOS clean-GGUF working-set), T103 (M6 aggressive over-commit) are testable;
  T104/T105/T106/T109 (M7/M8/M9/D3 SOLID/DRY/SoC) + T107 (M10 jest infra) are code-review/FIX-mode; T100
  (Q16) + T108 (D2) fold into T026/T004. None are user-facing release blockers, but all are now on record.
