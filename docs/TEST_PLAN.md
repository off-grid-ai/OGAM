# Test plan — device-grounded, UI-behavioral tests (adversarial + happy)

Turn the Android device run (findings B1–B33 + successes, 41 wire snapshots) into a test suite.
**Two hard rules, from the user:**
1. **UI-behavioral only.** Every test mounts a REAL screen, drives REAL user gestures through the REAL
   navigation stack (type/tap/long-press/swipe/attach/record/3-dots/back), and asserts what the user SEES on
   the live rendered UI. **No `store.setState` to fabricate the state under test.** Arrive at every precondition
   by gesture. (Only genuinely un-gettable-in-jest things may be pre-placed: a downloaded model = AsyncStorage
   record + file on disk; RAM numbers; native output.)
2. **Seams built from REAL device data.** The fakes replay the exact shapes captured in `docs/wire-captures/`
   (`[WIRE-*]` logs) — not guesses. A green test must mean the real thing works.

Sources: `DEVICE_TEST_FINDINGS.md` (B1–B33 + corrections), `docs/wire-captures/*.log` (ground truth),
`DEVICE_SESSION_COMMENTARY.md` (user's verbatim observations). Builds on existing `__tests__/harness/`
(`chatHarness.ts`, `nativeBoundary.ts`) + `__tests__/integration/{happy,*}`.

---

## PHASE 0 — Upgrade the seams to REAL device shapes (foundation; do FIRST)

Every fake in `nativeBoundary.ts` gets its output replaced with the real captured shape. Extract fixtures from
the wire logs into `__tests__/fixtures/wire/` (one file per engine/seam), so tests import real data.

| Seam | Real shape (from wire logs) | Fixture / fake change |
|---|---|---|
| **llama stream** | model-specific inline thinking: Qwen `<think>…</think>`; gemma-4 `<\|channel>thought` / `<\|think\|>`; empty `<think></think>` even when off | `makeLlamaFake` streams these token shapes via the completion callback (already streams; make delimiters real + per-model) |
| **llama tools** | `[WIRE-LLAMA-TOOL]` — structured `tool_calls`, multi-round loop, `stopped_eos`, `predicted` | replay real tool-call JSON + 2-round reason→tool→reason→answer |
| **llama load** | `[WIRE-LLAMA-LOAD]` nGpuLayers/offloaded X/36; GPU 8s-timeout→retry→24/36; NPU=HTP0 loads but **gibberish**; CPU 0/36 | fake `loadModel`/completion per backend: GPU offloads N, NPU loads-then-emits-gibberish (B22), CPU works |
| **litert** | `[WIRE-LITERT]` `litert_thinking` CHANNEL (separate) + `[WIRE-LITERT-TOOL]` whole structured JSON; load clamps ctx 4096→880; CPU → Status 13 | litert fake emits thinking on its channel; CPU load throws `Status Code: 13 … Failed to invoke the compiled model` (B23) |
| **remote (OpenAI-compat)** | `[WIRE-REMOTE]` `{role,content:null}` opener, `reasoning_content` deltas, tool_calls **fragmented, accumulate by index**, parallel index:0+1 | remote fake replays OGAD/LM Studio deltas; LM Studio path drops reasoning when thinking off (B16) |
| **remote (Ollama)** | `[WIRE-OLLAMA]` native NDJSON, `message.thinking` field, tool_calls | ollama fake replays `/api/chat` lines; thinking field flows (works) |
| **STT** | `[WIRE-STT]` `{language:'en', segments:[{t0,t1,text}]}` (transcribeFile WORKS); realtime `{isCapturing:false, hasData:false}` → no transcript (B26 broken) | whisper fake: `transcribeFile` returns real segments; `transcribeRealtime` emits hasData:false (broken path) |
| **TTS** | `[WIRE-TTS]` kokoro `{samples:48054, sampleRate:24000, chunkIndex, isFinal}`; final chunk samples:0 | kokoro fake streams a real-sized chunk then the 0-sample end marker |
| **embeddings** | `[WIRE-EMBED]` `{dim:384, sample:[…8 floats…]}` | embed fake returns 384-dim vectors (query + stored match) |
| **PDF** | `[WIRE-PDF]` text PDF → `{textLength:14873, sample}`; scanned → `{textLength:0, sample:''}` | pdf fake: text→real len; a "scanned" fixture → 0 (B9-adjacent + "could not extract" UX) |
| **RAM / device** | `[WIRE-DEVICE]` 11.8GB/procAvail; `[WIRE-DEVICE-SOC]` `{vendor:qualcomm, hasNPU:true, qnnVariant:'min'}`; `[WIRE-RAM]` budget vs os_procAvail divergence | seed the real device numbers; expose budget vs physical for B2 |
| **downloads** | `[WIRE-DOWNLOAD]` getActiveDownloads rows (running+queued), mmproj as SEPARATE row, complete/progress events | download fake: real row shape; mmproj separate row (B7 counter) |
| **image gen** | `[WIRE-IMAGE]` `{imagePath,width,height,seed,generationTimeMs}`; `[WIRE-IMAGE-PARAMS]` requested vs native; `[WIRE-IMAGE-CONSTANTS]`; progress events | diffusion fake echoes native params + writes PNG (done) + real constants |

**Deliverable:** `__tests__/fixtures/wire/{llama,litert,remote,ollama,stt,tts,embed,pdf,device,download,image}.ts`
extracted verbatim from the logs, and `nativeBoundary.ts` fakes wired to them. Existing tests must stay green
after the swap (the fakes get *more* real, not different-behaving for happy paths).

---

## PHASE 1 — Adversarial / red tests (one per failure; must FAIL on current code)

Each: arrive via gesture → trigger via gesture → assert the user-visible WRONG outcome → falsify both ways.
Genuine red (real failing `it()`), grounded in the real seam. Clustered:

### Cluster A — Memory / residency / backends
- **B1** whisper coresidency leak — download STT (gesture) → it auto-loads resident → load a chat model →
  assert whisper STILL resident (should've evicted) → tap **Eject All** → assert whisper STILL resident
  (ejectAll misses it). Assert via the residency surface / a later spurious "Not Enough Memory" card.
- **B2** budget > physical — drive a load where soft budget says fits but `os_procAvail` < size → assert it
  loaded into over-budget (or the graceful card should appear and doesn't). *(Residency invariant — may be
  labeled service-level per the gesture-less carve-out; drive via the real load gesture where possible.)*
- **B3** gemma-E2B mmproj-inflated estimate → CPU fallback — assert nGpuLayers=0 for the vision gguf via the
  real load path. *(load-config invariant, labeled.)*
- **B22** NPU loads but gibberish — select NPU backend (gesture: Model Settings → Advanced → Backend → NPU) →
  reload → send → assert the rendered reply is gibberish/empty, NOT a correct answer.
- **B23** litert CPU broken — select litert CPU (gesture) → reload → send → assert the user sees the
  "Failed to invoke the compiled model" error, not an answer.
- **B24** GPU init timeout→retry / partial offload — assert the retry path + partial-offload outcome. *(load
  invariant, labeled.)*
- **B25** litert ctx clamp drops tools — litert + tools + a tool prompt → assert no tool call fired (clamp).

### Cluster B — STT / voice input (the B28 fragmentation is the root)
- **B26** realtime STT no capture — chat mode → tap mic (gesture) → assert nothing lands in the input / no
  message (hasData:false path). Falsify: the working path DOES transcribe.
- **B10/Q20** voice-note sent as audio not transcript — chat mode → record voice note (gesture) → send →
  assert the dispatched turn carries AUDIO with no transcript (spec: always transcript, never audio).
- **B11** STT no-stop leak — start recording (gesture) → assert it doesn't auto-stop / whisper stays resident.
- **B12** realtime transcribe race — double-trigger mic (gesture) → assert the `State:-100` collision surfaces.
- **B28** ARCHITECTURAL (the root of B10/B26) — a test that asserts BOTH modes go through ONE transcribe
  pipeline (record→file→transcribe). Currently red because they diverge (3 mechanisms). This is the seam test.

### Cluster C — Thinking / generation render
- **B14** thinking renders in ANSWER bubble until close delimiter — send a thinking prompt → during streaming,
  assert reasoning tokens appear in the THINKING block, not the answer bubble (currently they leak to answer).
- **B15** silent max-predict cutoff — force the predict cap → assert the user gets a "cut off"/continue signal,
  not a silently truncated answer (`stopped_eos=false` with no indication).
- **B16** LM Studio drops reasoning — remote LM Studio (real deltas WITH `reasoning_content`) + thinking →
  assert the thinking block renders (currently reasoning=0 dropped → nothing shown).
- **B17** no thinking toggle for remote — mount the remote-model chat settings → assert a thinking toggle
  exists (currently absent). *(render assertion.)*

### Cluster D — Image / enhancement / routing
- **B30** enhancement thinks → garbage prompt — enable enhancement (gesture) + thinking on → send "draw a cat"
  → assert the enhancement request carries **no thinking** (enable_thinking !== true) and the enhanced prompt
  has **no reasoning markers** (currently "Thinking Process:…" becomes the prompt). *(fix = plain completion.)*
- **B30b** enhancement no streaming — assert the enhancement step streams/shows progress (currently static,
  looks frozen). *(render/behavioral.)*
- **B33** resend image request → text — send "draw a dog" (routes to IMAGE ✓) → **resend it via the action
  menu** (gesture) → assert it STILL routes to IMAGE (currently resend bypasses ROUTE-SM classify → text).
- **B13** error doesn't clear spinner — drive a generation that errors (e.g. vision decode fail B9) → assert
  the loading spinner CLEARS + an error renders (currently spins forever).

### Cluster E — Vision
- **B9** vision decode fails on bigger models — attach image (gesture) to a "SmolVLM/Qwen2B"-shaped model →
  send → assert the user sees the decode-fail error (evaluate chunks). Falsify: Qwen0.8B-shaped model works.

### Cluster F — UI layout glitches (render/snapshot assertions)
- **B27** voice thinking block full-width — mount voice-mode chat with a thinking message → assert the thinking
  bubble width == voice-note bubble width + left-aligned (currently full-width).
- **B32** stray empty "#" bubble — mount voice-mode chat post-tool-turn → assert no empty/`#`-only bubble
  renders.
- **B29** mic-not-stop during gen — voice mode, generation in flight → assert the mic button shows STOP (in the
  states where it currently doesn't).

### Cluster G — Downloads / thermal
- **B7** counter off-by-one — download a vision model (mmproj = separate row) → assert badge count == list count
  (currently diverges by one mid-flight).
- **B31** thermal/runaway context — (candidate) assert the app guards/caps a runaway context rather than
  grinding to a crash. *(may be a service-level guard test.)*

*(Existing Q-series redflow tests — Q2/Q3 messy tool JSON, Q4, Q5 empty-final, etc. — get re-pointed at the
upgraded real seams. Q1 becomes a GREEN guard: image size can't go below 256.)*

---

## PHASE 2 — Happy / success-path tests (everything that WORKED on device)

Same UI-behavioral bar. Many already exist in `__tests__/integration/happy/` — re-point them at the upgraded
seams + add the new device-proven journeys:

- **Text gen** — llama CPU + GPU (real load config), litert GPU: type + send → correct reply renders. Both
  thinking (real per-model `<think>`/`<\|channel>thought`) and plain.
- **Tools** — calculator + parallel tools, multi-round reason→tool→answer (real `[WIRE-LLAMA-TOOL]` shape).
- **Remote** — OGAD (plain/tool/reason/reason+tool/parallel), Ollama (thinking field renders + tools). Real
  delta replay.
- **Vision** — attach image → correct description (Qwen0.8B-shaped works).
- **Image gen** — image-mode ON + send → image renders (real mnn/GPU params, PNG on disk); lightbox: tap image
  → viewer opens with Save/Close (already built — keep).
- **Voice mode END-TO-END** (the crown journeys):
  - STT: record → transcript renders (real `{segments}` shape).
  - draw-a-dog journey: record → transcript → routes to IMAGE → image renders → TTS confirmation.
  - calculator journey: record → transcript → routes to TEXT → tool → answer → TTS.
  - TTS: tap Speak → kokoro synthesis (real 24000Hz chunk).
- **RAG round-trip** — create project (form gesture) → add a text PDF to KB (attach gesture) → index (real
  `[WIRE-PDF]` 14873ch → chunks → `[WIRE-EMBED]` 384-dim) → chat a doc question → `search_knowledge_base` →
  retrieved chunks → grounded answer. + the `toolEmbeddingStaleDim` guard (query dim 384 == stored 384).
- **Image-intent routing** — "draw X" → image; "calculate X" → text (with image model active). Both gestures.
- **Budget eviction (M11 works here)** — image resident → text load evicts image (real device numbers).
- **Interaction** — queue-while-busy (send during stream → both land in order), stop-mid-stream (stop → halts +
  partial retained). Both real gestures.
- **Q1 guard** — image-size input floors at 256 (can't select 128).

---

## Methodology (how every test is written)

1. **Heavy entry point** — mount the real screen via `setupChatScreen`/real navigation (react-native-screens +
   safe-area jest mocks already in place). Real `NavigationContainer` + native-stack.
2. **Arrive via gesture** — model downloaded = boundary (AsyncStorage record + file on disk), then REAL Home
   picker tap to select, REAL New Chat, REAL settings toggles, REAL attach/record/swipe. Never setState the
   thing under test.
3. **Trigger via gesture** — type+send, tap Speak, long-press/3-dots menu, drag slider, attach photo, record.
4. **Assert on live UI** — query rendered text/testIDs the components already emit. Wait on a user-visible
   signal (the reply text), never opaque `assistant-message` counts.
5. **Falsify both ways** — remove the gesture/precondition → red; invert the seeded scenario → green. Deleting
   the impl must fail the test.
6. **Real seams** — fakes replay the captured wire shapes (Phase 0). Only native/network/clock/RAM/fs faked.
7. **Gesture-less invariants** — a few (budget math B2, load-config B3/B24, DB atomicity) have no single
   gesture; those are LABELED service-invariant exceptions per the hygiene carve-out, driven through the real
   owning service, asserting the resident/verdict state — never a mocked gate.

## Sequencing
1. **Phase 0 seam upgrade** (foundation — unblocks everything; keep existing 55 tests green).
2. **Phase 1 adversarial**, in priority order: B1 → B28/B26/B10 (STT) → B30 → B33 → B22/B23 (backends) →
   B16 → B14 → B9 → B13 → UI-glitch cluster (B27/B32/B29) → B2/B3/B24/B25 (invariants) → B7/B31.
3. **Phase 2 happy** — re-point existing + add voice/RAG journeys.
4. Run the full gate (lint + tsc + jest) green-except-intended-reds; the reds are the spec for the later fix
   phase (fixes are OUT OF SCOPE here — tests only, per the standing instruction).

## Honesty bar
- Red tests fail for the RIGHT reason (the real symptom the user saw), verified by falsification.
- Where a bug has no honest UI manifestation in jest (pure device/thermal/native-crash), say so and mark it
  Provit, don't fake a green.
- Report each test as code / wired / verified — never inflate.
