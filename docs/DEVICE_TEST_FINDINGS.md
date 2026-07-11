# Device test findings — Android from-device wire-capture run (2026-07-11)

Device: OPPO CPH2707, **Snapdragon 8s Gen 3 (SM8635)**, qnnVariant `min`, hasNPU `true`, Android 16,
**11.8GB total / ~4.8GB available** at launch. Build: `ai.offgridmobile.dev` (debug, all `[WIRE-*]` loggers).

Evidence lives in `docs/wire-captures/` (timestamped `wire-*.log` + `debug-*.log` snapshots).
User's verbatim commentary in `DEVICE_SESSION_COMMENTARY.md` (gitignored).

---

## SESSION 3 (evening) — compute-backend matrix (clean install, models preserved)

### Backend matrix (gemma-4-E2B / Qwen0.8B on device SM8635)
| Engine | CPU | GPU | NPU |
|---|---|---|---|
| **llama gguf** | ✅ works (default = 0/36 GPU layers = CPU) | ✅ works | ❌ **B22** loads but gibberish |
| **litert (.litertlm)** | ❌ **B23** Status 13 fail | ✅ works | (not offered in UI) |

### NEW BUGS (session 3)
- **B22 — llama NPU (Beta)/HTP loads but generation is BROKEN.** On SM8635 (qnn `min`), HTP loads cleanly
  (layers on `HTP0`, `rnllama_jni_..._hexagon_opencl` native lib, no fallback) BUT output is garbage:
  attempt 1 = `" ca.\n"` (3 tokens), attempt 2 = 89 tokens of prompt-unrelated gibberish, tools turn = gibberish
  (the tool RESULT was correct only because tool execution is deterministic). Reproducible, user-confirmed.
  Verified genuinely on HTP (no fallback). NPU loadable but NOT functional for generation. (part17-19)
- **B23 — litert CPU backend BROKEN.** Selecting litert CPU → `Status Code: 13 ... Failed to invoke the
  compiled model` (on generateRaw AND sendMessage, reproducible on resend). Likely the `.litertlm` is a
  GPU-compiled artifact that can't be invoked on CPU. Bug either way: the app OFFERS a CPU option that errors.
  Scope: confirmed for gemma-4-E2B .litertlm (one model). (part21)
- **B24 (candidate) — GPU init timeout + partial offload.** llama GPU/OpenCL: first init `timed out after
  8000ms` → offloaded 0/36 → retry succeeded but only 24/36 layers on GPU (partial; 12 on CPU). Worth a
  timeout→retry test. (part16)
- **B25 (candidate) — litert context clamp drops tools.** litert GPU clamped context `4096 → 880` (native);
  a thinking+tools prompt then did NOT fire tools (session 1 litert tools DID work). Candidate: 880 too small
  for the tool-augmented system prompt. (part20)

### Refinement to thinking ground truth
Inline-thinking delimiter is **model-specific**: Qwen3.5 = `<think>...</think>`; **gemma-4-E2B = `<|channel>thought`
/ `<|think|>`**. Parser must handle multiple delimiters (REASONING_DELIMITERS). (part16)

### CONFIRMED WORKING (session 3)
- llama CPU + GPU: coherent, multi-round thinking+tools ("very rich answer", user). GPU offloads real layers
  (OpenCL KV cache on Adreno). litert GPU: coherent output. NPU IMAGE models present (`*_npu_min`) but text
  NPU broken.

### B28 — ARCHITECTURAL: STT is fragmented into ≥3 divergent pipelines (SOLID violation) — the ROOT of B26/Q20
Both chat mode and voice mode do the same primitive (voice in → text out); only the UI + post-transcript
action should differ. Instead the MECHANISM of getting the transcript branches by mode (`Voice.ts`
`stopRecording`):
1. **record file → `whisperService.transcribeFile(path)`** (voice/audio-interface mode) — **WORKS** ✅
2. **record file → `onAudioAttachment({uri,format})`** (chat-mode direct) — attaches AUDIO, no transcript — **Q20/B10** ❌
3. **`transcribeRealtime` streaming** (chat-mode hold-to-talk) — `hasData:false` — **B26** ❌
Per CLAUDE.md ("never branch on mode to decide HOW; one owning service"), this should be ONE pipeline
(record → file → transcribe → text — the path that works) used by both modes, differing only in UI + what
happens with the text. B26 and Q20 exist BECAUSE they are separate broken mechanisms the working path doesn't
share. User surfaced this ("shouldn't this be a common pipeline? it's just the UI that changes — per SOLID it
should be one pipeline"). Fix at the seam, not per-path. (session 3)

### STT — realtime (VoiceButton hold-to-talk) is BROKEN (session 3, Qwen0.8B GPU, medium whisper)
- **B26 — realtime STT (chat-mode hold-to-talk) captures NO data → no transcript. CONFIRMED FUNDAMENTAL.**
  Spoke a clear "Hello, how are you?"; result: blank screen, nothing in the input box, no message. Trace:
  `transcribeRealtime started successfully` → `Event: {isCapturing:false, hasData:false}` (captured nothing) →
  `Transcription result: false` → no `[WIRE-STT]`, no `[WIRE-RECORDER]`. **Rebuilt via `npm run android`
  (fresh process) → SAME failure** → so it's NOT state-pollution, it's fundamental. The **mic animates** (UI
  says "recording") but zero audio is captured — a UX disconnect on top of the bug. Also `State: -100` race
  (B12) and start/stop retry loops seen when state is polluted. Scope caveat: one Android device — can't fully
  rule out a device-mic quirk, but the app-side capture consistently gets no data. (part22–24)
- Ties to B11 (no-stop leak — a realtime transcription stayed active and collided with new presses) and
  B12 (State:-100 race on double-trigger).
- **Two distinct broken STT flows now:** voice-note-attach = records .wav but sends AUDIO not transcript
  (Q20/B10); realtime hold-to-talk = captures nothing (B26). USER SPEC: always transcript, never audio.

---

## SESSION 2 (afternoon) — additional findings, corrections, and ground truth

### NEW BUGS (session 2)
- **B9 — On-device vision decode fails on bigger models (SmolVLM, Qwen3.5-2B), works on Qwen3.5-0.8B.**
  `evaluate chunks` / `llama_decode: failed to decode, ret=-1` / `invalid token[29]=-1` +
  `<|vision_start|>/<|vision_end|>/<|vision_pad|>` not-marked-as-EOG. Reproducible ×3. Qwen0.8B vision WORKS
  (read the image correctly). So it's model/tokenizer-specific, NOT device-wide. (part2, part5)
- **B10 — Q20 CONFIRMED ON DEVICE + spec:** voice note dispatched as raw `.wav` (`[WIRE-RECORDER]`), `[WIRE-STT]`=0,
  `Transcription result: false`. USER SPEC: *"in any mode we always send a transcript, never audio to the model."*
  So this is a definite spec violation, not just adversarial hypothesis. (part3)
- **B11 — STT no-stop leak:** `startRecording` → 7+ min continuous mic capture, whisper stayed resident 1500MB,
  never stopped. (part3)
- **B12 — Realtime transcribe race:** double-trigger → `Failed to start realtime transcribe. State: -100`. (part3)
- **B13 — Error doesn't clear the spinner:** a generation that ended `reason=error` (vision fail) left the UI
  spinning indefinitely; user saw no error. (part2)
- **B14 — B5 UPGRADED (thinking render-timing):** the ENTIRE thinking phase renders in the ANSWER bubble until
  the close delimiter, then retroactively reclassifies into the thinking block. Should render in the thinking
  block from token 1. Data exists (`reasoning_content` populated). On slow CPU vision this is minutes of
  thinking masquerading as the answer. (part6, part7)
- **B15 — max-predict cutoff, silent:** vision turn hit `predicted=1024, stopped_eos=false` → cut off
  mid-sentence with no indication. Raising max-tokens to 4.4k → `predicted=1604, stopped_eos=true` (finished).
  Root: n_predict cap (NOT context — `context_full=false`); the leaked thinking (B14) burned the budget. (part6,7)
- **B16 — LM Studio (OpenAI-compat) drops reasoning:** LM Studio SENDS `reasoning_content` (raw-curl proof +
  WIRE captured it), but app `reasoning=0` → no thinking render. Cause: no thinking toggle for remote →
  `thinkingEnabled=false` → processDelta discards `reasoning_content`. **TOOLS WORK** (parallel, executed).
  (part8 + CORRECTION)
- **B17 — No thinking toggle for remote models (UX gap):** neither LM Studio nor Ollama exposes a thinking
  on/off toggle. (part10)
- **B18 (observation, verify):** loading a local model may not make it the ACTIVE model — a resend with gemma
  resident (5854MB) still dispatched `isRemote=true`. Ties to "text says 0" + "no remote indicator". (part13)
- **B19 (UX):** cannot preview an attached image in the input box (pre-send) — tapping the thumbnail does
  nothing. (part5)
- **B20 (UX):** litert gemma-4-E2B reports `supportsVision:true` natively but the app doesn't expose vision for
  it, while the gguf variant does. Engine-inconsistent vision affordance. (part5)
- **B21 (minor UX):** image-gen shows "~120s one-time GPU optimization" but actual gen was ~10s. (part12)

### CORRECTIONS (I over-concluded; user caught these — logged for honesty)
- **Phantom VoiceButton press — RETRACTED.** Controlled hands-off test (launch→select→15s idle) showed 0
  presses, 0 whisper. The earlier 17ms/orphaned presses were accidental brushes during the wedged session.
- **"LM Studio drops tools" — WRONG.** Tools WORK on LM Studio (structured parallel `tool_calls`, executed).
  My bad-data-slice error; only reasoning is dropped.
- **"Remote thinking broken on both providers" — WRONG.** Ollama thinking WORKS (`reasoning=211/1358` rendered,
  user confirmed). Only LM Studio (OpenAI-compat) drops it. They differ.

### CONFIRMED WORKING (session 2 — happy paths / positive results)
- **Litert fully works:** bare (pure token channel, NO stray `<think>`), thinking (dedicated `litert_thinking`
  channel), structured per-call tool JSON, GPU load, eager-load-on-select (fine UX).
- **Qwen0.8B vision works** (reads image). **LM Studio remote vision works** (gemma-4-e2b, image described).
- **Ollama:** tools work, thinking works (renders).
- **Image gen works** (AnythingV5 + Absolute Reality, GPU/mnn backend, 512x512, ~10s each).
- **Image-intent routing works:** a non-draw prompt routes to text even with an image model active.
- **M11 eviction WORKS on this device:** text load after image-gen evicted the resident image (`evict=[image]`).
- **App-restart clears the whisper leak** → models fast again (validates B1 as the slowness cause).
- Queue-while-busy, stop-mid-stream, onboarding-skip, lazy-load (gguf) — all confirmed.

### WIRE-FORMAT GROUND TRUTH — thinking delivered FOUR ways (all captured raw)
| Source | Thinking field |
|---|---|
| local gguf (llama.rn) | inline `<think>...</think>` in token stream (empty `<think></think>` even when off) |
| litert | dedicated `litert_thinking` native channel |
| OpenAI-compat (OGAD/LM Studio) | `reasoning_content` field in deltas |
| Ollama native (`/api/chat`) | `thinking` field inside `message` |

Tool calls: OGAD/LM Studio = structured `tool_calls`, args stream as partial-JSON fragments, accumulate by
`index`, parallel = index:0+1 same round. Litert = whole structured JSON per call. Local gguf = `[WIRE-LLAMA-TOOL]`.

### CAPS observation
Qwen0.8B AND gemma-4-E2B both advertise `tools:true, toolCalls:true, parallelToolCalls:true, toolUse:false`.

---

## BUGS (confirmed with device evidence)

### B1 — Whisper STT model leaks resident; eject-all can't clear it *(TOP PRIORITY)*
**The headline bug.** Chain of three defects, all confirmed from `[MEM-SM]`/`[MODEL-SM]` traces + code:

1. **Whisper auto-loads resident the instant it finishes downloading** — not on first transcription.
   Trace: `[Whisper] Downloaded → makeRoomFor whisper sizeMB=1500 → Loading model → Model loaded successfully`
   at 07:20. It should not load into RAM until the user actually transcribes.
2. **`makeRoomFor` counts it in the budget but never evicts it.** When loading gemma (text, 5854MB) with
   `residents=[text:1055, whisper:1500]`, it returned `fits=true evict=[]` while `os_procAvailMB=1662` —
   i.e. it green-lit a 5854MB load into 1.6GB of real free RAM.
3. **`ejectAll` doesn't know whisper exists.** After eject-all: `[MODEL-SM] ejectAll → done count=1`, and the
   next load shows `residents=[whisper:1500]` — the chat model ejected, **whisper survived**.
   Code: `activeModelService.unloadAllModels()` returns only `{textUnloaded, imageUnloaded}`; STT/whisper is
   absent from the unload set (`activeModelService/index.ts:394,428`). So the user's only manual escape hatch
   structurally cannot free whisper — app-kill is the sole recourse.

**User symptom (their words):** "this gemma4 e2b is struggling on my phone. I'm pretty sure its some coresident
bullshit in the ram" / "cause normally its super fast." Exactly right — 1.5GB whisper squatter → thrash.

**Fix directions:** (a) don't load whisper resident on download; (b) `makeRoomFor` must gate on physical
`os_procAvail`, not just the soft budget, AND treat an idle STT model as evictable; (c) `unloadAllModels`/
`ejectAll` must include the STT/whisper residency.

**Test (writable from this trace):** residency-invariant — after downloading an STT model it must NOT be
resident; loading a chat model must evict an idle whisper; eject-all must clear ALL heavy residents (assert
`getResidents()==[]`, not `count`). Reproduce budget: `budgetMB=7908`, sizes text:1055/1500/5854 from the log.

### B2 — Budget (soft) vs physical-available RAM divergence
`makeRoomFor` decides `fits=true` against `budgetMB=7908` while `os_procAvailMB=1662`. Loading a model larger
than physical-available thrashes/swaps → the slowness. The gate trusts the soft budget over the OS's real
figure. (Overlaps B1 but is its own defect — the physical-RAM number is captured and ignored.)

### B3 — gemma-4-E2B estimated at 5854MB (absurd for a 2B model)
`makeRoomFor text sizeMB=5854` for a ~2GB 2B model. Almost certainly the **mmproj (vision) inflating the
estimate** with a large multiplier. Consequences: trips the "may be too big" select-time warning, and forces
**CPU fallback** (`[WIRE-LLAMA-LOAD] nGpuLayers:0`) → slow generation. Estimator for vision-capable gguf needs
review.

### B4 — Premature "downloaded successfully" notification (fires before extraction)
The bottom-sheet "downloaded successfully" fires at **native download-complete**, but image-model **zip
extraction is deferred** to the next `syncCompletedImageDownloads` (image-tab visit / relaunch). Confirmed on
**AnythingV5** and **Absolute Reality** (consistent, not a one-off). So a model reports "ready" while it's only
downloaded-not-extracted. `downloadHydration.ts` comment corroborates: "native finished but JS finalization
(unzip+register)". `[WIRE-UNZIP]` had NOT fired for either image model at snapshot time — extraction pending.
**Open:** does selecting + generating with such a model immediately work (on-demand extract) or fail? (Not yet
tested — the "select image model → generate" step.)

### B5 — Thinking stream leaks into the answer bubble at stream start
**User's words:** "in the beginning the chat doesn't know its a thinking stream, and therefore is adding
everuything in the message like its the final response. then when the thinking stops it realises that it was
thinking." Mechanism (confirmed via wire capture): **local models deliver thinking as inline `<think>` tags**
in the content stream; the parser lags recognizing the opening `<think>` mid-stream, so the first tokens
mis-route into the answer bubble before it detects the think block. Thinking-OFF streams clean (no opener to
detect). **Test:** with thinking on, tokens before the delimiter is recognized must NOT render in the answer.

### B6 — Empty `<think></think>` emitted even with thinking OFF (Qwen3.5)
Bare baseline (thinking off, tools off) final content began: `<think>\n\n</think>\n\nHere are the answers...`.
Qwen3.5 emits an empty think block even when thinking is disabled; the parser must strip it or the user sees
literal `<think></think>` atop the answer. Captured in `[WIRE-LLAMA]`.

### B7 — Download counter transient off-by-one (vision-model mmproj)
Single-instant contradiction observed: download-manager list showed 4 running + 7 queued (=11) while the icon
badge showed 10. Root cause from `getActiveDownloads`: a vision model's **mmproj is a separate download row**,
so the list counts files while the badge counts models — they diverge by one **while the mmproj is in-flight**.
Steady-state is correct (user later confirmed solid number = 14 downloaded). Scoped claim: transient
off-by-one during active vision-model download, NOT a persistent counter break.
**Note:** user also reported "massive sync issues between this and the download manager icon notification" —
badge-vs-count divergence may be larger than one in some states; needs the exact numbers next session to pin.

### B8 — "No servers found" while the server is simultaneously added to the list
Network scan reported "no servers found" but OGAD appeared in the server list at the same time. State desync
between the scan-result toast and the server-list state. (Pure UI state — testable in jest.)

---

## UX FINDINGS (product, not crashes)

- **No remote indicator in the model modality selector.** A remote (Qwen3.5-2B / OGAD) model looks identical
  to a local one. User suggests a small cloud icon. ("There is no way to know that this is a remote model.")
- **"Text says 0" on home while a remote model is active + selected.** Likely "0 local text models" (correct
  literal) but reads as a desync next to an active remote model. Confirm the chat works despite the 0.
- **Notification consistency — CORRECTED finding.** Initially looked like "image models notify, text don't,"
  but SmolLM3 (text) DID notify. Real variable is likely **foreground/timing**, not model type. (Self-corrected
  from device evidence — don't encode the wrong "image vs text" rule.)

## CONFIRMED-WORKING (happy paths worth locking as regression tests)

- **Onboarding skipped** when a server + model are already configured ("hit continue, it skipped onboarding —
  good UX").
- **Lazy model loading** — model loads on first send, not on select ("exactly the lazy model loading I wanted").
- **Queue-while-generating** — sending a 2nd prompt mid-stream queues it and processes in order after the
  current completes. No collision/drop.
- **Stop-mid-stream** — stop halts generation cleanly and the queue advances to the next prompt.
- **Support-sheet dismissal** — the "support open source AI" share sheet dismisses correctly after returning
  from X (doesn't re-nag).
- **Reasoning + tool render** — pre-tool thinking → tool call → post-tool thinking → answer render as four
  distinct sections in order.

---

## WIRE-FORMAT GROUND TRUTH (the fixtures — captured, not guessed)

### Thinking is delivered THREE different ways (parser must handle all)
1. **Local (llama.rn):** inline `<think>...</think>` tags in the token stream; fields `{content, token}` only.
   Even thinking-OFF emits an empty `<think></think>` (B6).
2. **Remote OGAD (OpenAI-compatible SSE):** a separate **`reasoning_content`** field, streamed token-by-token,
   then switches to `content` for the answer. NOT `<think>` tags.
3. **Remote Ollama (native NDJSON):** a `thinking` field (to be captured — not run yet).

### Tool calls
- **Remote OGAD:** structured `tool_calls`, but **arguments stream as partial-JSON fragments** across many
  deltas; must accumulate `tool_calls[index].function.arguments` by `index`.
- **Parallel tools:** emitted as `index:0` AND `index:1` in the **same** round (accumulate by index — not one
  call, not serial rounds).
- **Reasoning + tool = TWO round-trips:** round 1 `reasoning_content* → tool_calls* → done`; then the app runs
  the tool and injects the result; round 2 `reasoning_content* → content* → done` (the model reasons in BOTH
  rounds).
- **Local (llama.rn):** captured via `[WIRE-LLAMA-TOOL]` (input+output). CAPS advertise
  `tools/toolCalls/parallelToolCalls: true, toolUse: false` (Qwen0.8B and gemma-4-E2B identical).
- **Gemma tool format:** thinking+tools turn captured but not yet decoded — the open question is structured
  `tool_calls` vs messy ` ```json `/`[tool_call]` markers (Q2/Q3 territory).

### Three distinct memory gates (do NOT conflate)
1. **Download-time:** "may not run comfortably on your device, sure you want to download?" (seen on E4B).
2. **Select-time:** "may be too big" advisory in the model-selector bottom sheet (informational, non-blocking).
3. **Load/generation-time:** `ModelFailureCard` "Not Enough Memory" + "Load Anyway" (residency `makeRoomFor`).

### Device / load facts
- SoC `[WIRE-DEVICE-SOC]`: `{vendor: qualcomm, hasNPU: true, qnnVariant: "min"}` → qnn image backend IS
  available on this device.
- gemma-4-E2B gguf load `[WIRE-LLAMA-LOAD]`: `contextLength 4096, nGpuLayers 0 (CPU), n_threads 6`.
- Several gguf models ship an **mmproj = vision-capable**: gemma-4-E2B, Qwen3.5-0.8B, SmolVLM, Qwen3.5-2B.

---

## CAPTURE STATUS (what's in the logs vs still to run)

**Captured:** device/SoC/RAM; downloads (parallel/queued, 14 models); 3 memory gates; OGAD remote (plain,
tool, reasoning, reasoning+tool, parallel-tools); Qwen3.5-0.8B local (bare baseline, thinking, tools, parallel,
queue, stop); gemma-4-E2B gguf (load+caps; thinking+tools turn pending decode); the B1 coresidency trace.

**Still to run (next session, after an app restart to clear whisper):**
- gemma-4-E2B **litert** (Android-only engine — does it use a `litert_thinking` channel? zero captures yet)
- **Vision** — attach a photo + ask (`[WIRE-VISION]` + response)
- **Image gen** — select AnythingV5/Absolute Reality → generate → `[WIRE-UNZIP]` (MNN/QNN extract, B4) +
  `[WIRE-IMAGE]` (also tests whether the "ready" image model actually works — B4 open question)
- **STT** — record a voice note + a silent clip (`[WIRE-STT]`)
- **TTS** — tap Speak on a reply (`[WIRE-TTS]`, kokoro)
- **RAG** — project + PDF in KB + ask (`[WIRE-EMBED]` + `[WIRE-PDF]`)
- **Remote:** LM Studio (gemma-4-E2B) + Ollama (minimax-m3:cloud), 2 samples each (thinking/tools on/off)
- **iOS** — repeat the native-divergent seams (image Core ML, STT, one gguf turn) for platform parity

### VOICE MODE — session 3 (working round-trip + UI bugs)
- **WORKS end-to-end:** STT (`transcribeFile` → `[WIRE-STT]` {language, segments[{t0,t1,text}]}) → response →
  kokoro TTS (`[WIRE-TTS]` 24000Hz). And the "draw a dog" journey: STT → ROUTE-SM dispatch→IMAGE → image
  generated → TTS confirmation. 4-subsystem happy path works (the Voice.ts-warned misroute does NOT happen).
- **Prompt enhancement WORKS but is slow + opaque:** engaging it swaps image→text model, generates the
  enhanced prompt (generateStandalone, ~9s to first token), then swaps back to image. Functional but the UX
  gives no sign it's a multi-step slow round-trip. (Enhance toggle confirmed working: first gen had
  enhanceImagePrompts:false, then on.)
- **B27 (UI):** in voice mode the thinking block takes the WHOLE screen width, doesn't match the (narrower)
  voice-note bubble width.
- **B29 (UI/SAFETY):** during an in-progress voice-mode generation, the mic button does NOT transform into a
  STOP button. Two problems: (a) no way to stop the generation; (b) it still LOOKS like a mic, so a user taps
  it to "record again" → starts a COLLIDING recording → triggers the exact double-record race (B12 State:-100 /
  B26 tangle). The UI bug is a direct on-ramp to the STT collision bugs. User: "which is fucked up."
- **Candidate — thinking not shown in voice mode:** user noted twice "thinking is on but no thinking blocks."
  Ambiguous (image-gen turns don't show thinking); needs a clear reasoning prompt in voice mode to confirm
  whether voice mode suppresses the thinking-block render. TO VERIFY.

### B30 — Prompt enhancement captures the model's THINKING as the "enhanced prompt" (thinking ON)
Device trace (draw a cat, enhancement ON, thinking ON):
  [ImageGen] ✅ Enhanced prompt: "Thinking Process:\n  *  Okay, so I need to respond with a text-based
  explanation or description of what I'd produce without actually drawing images? No, I should just output th..."
  → phase enhancing → generating → done   (image generated FROM that text)
The enhanced prompt should be a clean expanded image description; instead the model's reasoning_content
("Thinking Process:...") leaked in and became the image prompt. The enhancement's generateStandalone call
doesn't disable thinking / doesn't strip reasoning → the image model is fed garbage thinking text.
It LOOKED like it worked (an image appeared) but the prompt was nonsense. Confirms the Q8 adversarial case on
device. Also explains the user's "thinking is on but no thinking blocks" note (the thinking went INTO the
enhanced prompt, not a block). Enhancement round-trip is also slow (~2min: image→swap-to-text→enhance→swap-back
→regenerate). (part29)

### B30 downstream effect — the enhancement thinking-garbage POLLUTES the conversation context
Follow-up: after B30 (enhanced prompt = "Thinking Process:..." reasoning garbage), the NEXT turn (voice +
calculator "500 into 321") had that garbage in its context:
  system/history content: "<think>__LABEL:Enhanced prompt__\nThinking Process:\n1. Analyze the Request: User
  Input: 'draw a cat'..."
Result: the calculator turn crawled (Grammar still awaiting trigger, token-by-token over minutes, ~21K chars
of reasoning in context) and produced no timely response → UI showed "streaming voice response" with NO audio
(nothing ready to speak — premature/misleading state, like B29). So B30 is worse than a bad prompt: the leaked
reasoning enters conversation history and degrades subsequent turns. (part30)

### B30 — CLARIFICATION (user: "that's normal")
Context carrying forward across turns is NORMAL chat behavior — not a bug. Correcting the earlier framing:
the CORE bug is narrow and clear = **the enhanced prompt is thinking-garbage when thinking is ON** (the
enhancement's generateStandalone doesn't disable thinking / strip reasoning, so "Thinking Process:..." becomes
the image prompt). The "degrades subsequent turns" is just the NORMAL consequence of that garbage being in
history — NOT a separate context-management bug. Fix = enhancement call forces thinking OFF (or strips
reasoning) so the enhanced prompt is a clean image description. (Whether the enhancement output should be a
persistent chat message at all is a separate design choice, not asserted as a bug.)
