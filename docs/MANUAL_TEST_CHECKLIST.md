# Off Grid Mobile — Manual Release Test Checklist

A human-walkable, release-gate checklist. Go through this before every release. Independent of any automated
test claims. Aggregated from **both** adversarial/device sessions:
- Prior 6-agent adversarial sweep (`DEVICE_TEST_LOG.md`): Q1–Q20, M1–M11, D1–D4, V1–V5, log-B1–B9.
- Today's on-device wire-capture run (`DEVICE_TEST_FINDINGS.md`): DEV-B1–B33 + validated successes.

**Legend**
- **Type:** 🔴 = adversarial (a known/suspected bug — must be FIXED & verified before release) · ✅ = happy
  (must keep WORKING — regression check).
- **Sev:** P0 (blocker/crash/data-privacy) · P1 (major broken flow) · P2 (UX/cosmetic).
- **Device status:** what today's device run actually observed (BROKEN / WORKS / NOT-RUN / GUARDED).
- **Result:** you fill in ✅/❌ + notes each release.

How to use each row: do the **Steps** (real gestures), check the **Expected**, mark **Result**. If ❌, it
regressed / still broken.

Paste any table into Sheets/Excel (they're pipe-delimited).

---

## Area 1 — Model download & management

| ID | Type/Sev | Steps (gestures) | Expected | Ref | Device | Result |
|---|---|---|---|---|---|---|
| T001 | 🔴 P1 | Download several models at once (incl. a vision model w/ mmproj); open Download Manager; note the top-bar badge count vs the in-list running+queued count | Badge count == list count (no off-by-one) | DEV-B7 | BROKEN (off-by-one while mmproj in-flight) | |
| T002 | 🔴 P2 | Download a text model; watch for a completion toast/sheet | Notification behavior is consistent across model types (or intentional) | DEV-B4-note | INCONSISTENT (image notified, timing-dependent) | |
| T003 | 🔴 P1 | Download an **image** model (NPU/QNN `_min`); let it finish; without visiting the image tab, try to generate | "Downloaded" only after extraction; a "ready" model is actually usable | DEV-B4 | Premature "downloaded" (extract deferred) | |
| T004 | 🔴 P1 | Image model download where **extraction fails**; see the failed card; force-quit + relaunch; open Download Manager | A retriable/removable failed card survives relaunch | D1/log-B7 | BROKEN (lost on relaunch) | |
| T005 | 🔴 P1 | Start an STT (whisper) download; while it runs, **delete a different already-downloaded whisper model** | The in-flight download is NOT cancelled | V1 | BROKEN | |
| T006 | 🔴 P1 | App-kill mid-whisper-download (leaves a truncated `ggml-*.bin`); relaunch; open Download Manager | Truncated file is NOT shown as a completed model (size floor / .part) | V2 | BROKEN | |
| T007 | 🔴 P1 | STT download killed → relaunch → Download Manager | A retriable/removable entry is shown (not empty) | V3/D1 | BROKEN | |
| T008 | 🔴 P2 | iOS: start a download → app-kill → relaunch | Interrupted download shows a failed/stranded entry, not vanished | D4 | NOT-RUN (iOS) | |
| T009 | ✅ P1 | Download a text-based PDF (<5MB) into a project KB | Indexes cleanly (extract → chunks → embeddings) | DEV | WORKS | |
| T010 | 🔴 P2 | Upload a **scanned/image** PDF to a KB | Clear message ("no text layer / scanned"), not a vague fail | DEV | 0-text, vague msg | |
| T011 | 🔴 P2 | Upload a **>5MB** PDF to a KB | Clear "Maximum file size is 5MB" | DEV | WORKS (gated) | |
| T012 | ✅ P2 | Download Manager shows the solid count of downloaded models | Count is accurate at steady state | DEV | WORKS (=14) | |

## Area 2 — Model load & compute backends

| ID | Type/Sev | Steps (gestures) | Expected | Ref | Device | Result |
|---|---|---|---|---|---|---|
| T013 | ✅ P1 | Select a gguf model → send a prompt (lazy load on first send) | Loads and replies; default backend works | DEV | WORKS (CPU default) | |
| T014 | ✅ P1 | Model Settings → Text → Advanced → Backend = **GPU/OpenCL** → reload → send | Loads on GPU (offloads real layers), correct reply | DEV | WORKS (24/36, 8s init) | |
| T015 | 🔴 P1 | Backend = **NPU (Beta)/HTP** → reload → send a prompt | A correct answer (NOT gibberish/empty) | DEV-B22 | BROKEN (loads, gibberish) | |
| T016 | 🔴 P2 | GPU backend, first load | GPU init doesn't 8s-timeout then partial-offload (or is handled gracefully) | DEV-B24 | timeout→retry→24/36 | |
| T017 | ✅ P1 | Select a **litert** model → send | Loads on GPU, correct reply | DEV | WORKS (GPU) | |
| T018 | 🔴 P1 | litert model → Backend = **CPU** → reload → send | Works, OR the CPU option isn't offered for a GPU-compiled model | DEV-B23 | BROKEN (Status 13) | |
| T019 | 🔴 P2 | litert + tools + a tool prompt (long system prompt) | Tool call still fires (context clamp 880 doesn't drop it) | DEV-B25 | dropped tools once | |
| T020 | ✅ P1 | litert model select | Eager-loads on select (warming) — acceptable UX | DEV | WORKS | |
| T021 | 🔴 P2 | Load a vision gguf (gemma-4-E2B + mmproj); check speed/backend | Reasonable estimate; offloads to GPU (not forced CPU by inflated estimate) | DEV-B3 | CPU-fallback (est 5854MB) | |

## Area 3 — Memory / residency / budget

| ID | Type/Sev | Steps (gestures) | Expected | Ref | Device | Result |
|---|---|---|---|---|---|---|
| T022 | 🔴 P0 | Download an STT model; do NOT transcribe; check RAM/residency; load a chat model | Whisper is NOT auto-resident; loading chat model doesn't fight a phantom 1.5GB | DEV-B1 | BROKEN (auto-loads, leaks) | |
| T023 | 🔴 P0 | With whisper stuck resident, tap **Eject All** | ALL heavy models unload (incl. whisper) | DEV-B1 | BROKEN (ejectAll misses whisper) | |
| T024 | 🔴 P0 | Load a model larger than physically-free RAM (soft budget says ok) | Refused with graceful card, OR loads without thrash — not silent over-commit | DEV-B2/M2/M3 | BROKEN (budget>physical) | |
| T025 | ✅ P1 | Generate an image (image model resident) → go to chat → send text | Text load EVICTS the image model (mutual exclusion) | M11/DEV | WORKS (evict=[image]) | |
| T026 | 🔴 P1 | Text model resident → start image-gen | Text & image do NOT co-reside (swap) | M1/M16 | verify (worked in one flow) | |
| T027 | 🔴 P1 | Image model → pre-load "Safe to load" advisory, then generate | Advisory & the load gate agree (no "safe" then "not enough memory") | Q14 | BROKEN (est multipliers differ) | |
| T028 | 🔴 P1 | Load-Anyway a too-big dirty model on low free RAM | Survival floor blocks a guaranteed OOM (checks real free RAM) | M3/M4 | verify | |
| T029 | 🔴 P2 | Load-Anyway a small 2GB dirty model on 3GB free (iOS 12GB) | NOT over-refused | M5 | NOT-RUN (iOS) | |
| T030 | 🔴 P1 | TTS loaded → delete the TTS model in DM → later load a text/image model | No phantom TTS pressure causing a wrong refusal | V4 | verify | |
| T031 | 🔴 P0 | Very long / runaway conversation context, keep generating | App caps/trims context; doesn't thermal-throttle to freeze/crash | DEV-B31 | CRASHED (pushed to limit) | |

## Area 4 — Text generation (thinking / streaming / stop / queue)

| ID | Type/Sev | Steps (gestures) | Expected | Ref | Device | Result |
|---|---|---|---|---|---|---|
| T032 | ✅ P1 | Send a plain prompt (thinking off, tools off) | Clean answer streams in; no stray `<think>` block shown | DEV | WORKS | |
| T033 | 🔴 P1 | Thinking ON → send a reasoning prompt; watch the stream from the FIRST token | Reasoning renders in the THINKING block from token 1 (not in the answer bubble, then reclassified) | DEV-B14/B5 | BROKEN (leaks to answer until close) | |
| T034 | 🔴 P2 | Long answer that hits the max-token cap | User gets a "cut off"/continue indication, not a silent truncation | DEV-B15 | silent cutoff | |
| T035 | 🔴 P2 | litert/remote (separate reasoning channel) while reasoning streams | Header shows "Thinking…" (not the DONE label + T badge) | Q6 | BROKEN (divergence) | |
| T036 | ✅ P1 | Send a 2nd message while the 1st is still generating | 2nd queues; both answer in order (no drop/collide) | DEV | WORKS | |
| T037 | ✅ P1 | Stop a generation mid-stream | Halts cleanly; partial retained; queue advances; input recovers | DEV | WORKS | |
| T038 | ✅ P2 | Thinking + tools, multi-round (reason→tool→reason→answer) | All phases render in order; rich correct answer | DEV | WORKS (GPU) | |

## Area 5 — Tools (calculator / MCP / parallel)

| ID | Type/Sev | Steps (gestures) | Expected | Ref | Device | Result |
|---|---|---|---|---|---|---|
| T039 | 🔴 P1 | MCP tool + small model that emits **unquoted keys / trailing comma / single quotes** | Tool still runs (parser recovers); result shown | Q2 | BROKEN (silent drop) | |
| T040 | 🔴 P2 | Model emits `"arguments":"{...}"` (stringified) to an MCP tool | Server gets parsed params, not a raw string | Q3 | BROKEN | |
| T041 | 🔴 P2 | Several MCP tools; router prose names a tool as substring / says "none" | Correct/no tool selected (no false-positive force-select) | Q4 | BROKEN (litert/llama-iOS) | |
| T042 | 🔴 P1 | Tool returns data but model's final turn is empty | User sees the tool data, not "(No response)"/blank | Q5 | BROKEN (litert) | |
| T043 | ✅ P1 | Calculator tool: ask a multiplication (explicitly "use the calculator") | Correct answer via the tool | DEV | WORKS (500×321=160500) | |
| T044 | ✅ P1 | Two calculations in one prompt (parallel tools) | Both tool calls fire; both correct | DEV | WORKS (remote) | |
| T045 | ℹ️ P2 | A 0.8B model with tools, no explicit "use tool" nudge | (KNOWN) small models under-call tools — model capability, not a bug | DEV | Model-limit | |

## Area 6 — Remote providers (OGAD / LM Studio / Ollama)

| ID | Type/Sev | Steps (gestures) | Expected | Ref | Device | Result |
|---|---|---|---|---|---|---|
| T046 | ✅ P1 | Scan network with a server running → connect (or manual add) | Server found/added; connects | DEV | WORKS | |
| T047 | 🔴 P2 | Scan with nothing running | "No servers found" AND list stays empty (no desync) | DEV-B8 | desync (found+added) | |
| T048 | ✅ P1 | Remote (OGAD/LM Studio): plain, tool, reasoning, reason+tool, 2 tools | All correct; tools fire (structured, parallel) | DEV | WORKS | |
| T049 | 🔴 P1 | Remote **LM Studio** + reasoning model + thinking | The thinking block renders (server sends `reasoning_content`) | DEV-B16 | BROKEN (reasoning dropped) | |
| T050 | 🔴 P1 | Any remote model → open chat settings | A thinking on/off toggle exists for remote | DEV-B17 | MISSING | |
| T051 | ✅ P1 | **Ollama** (native) reasoning model + tools | Thinking renders + tools fire | DEV | WORKS (thinking field) | |
| T052 | 🔴 P1 | Active text model = REMOTE + image-gen + enhancement on | Enhancement runs (has a remote path) | Q8 | BROKEN (no remote branch) | |
| T053 | 🔴 P2 | Model modality selector with a remote model selected | Remote model is visually distinguishable (cloud icon) | DEV | no indicator | |

## Area 7 — Vision (multimodal)

| ID | Type/Sev | Steps (gestures) | Expected | Ref | Device | Result |
|---|---|---|---|---|---|---|
| T054 | ✅ P1 | Attach an image (Qwen0.8B vision or LM Studio) → "what's in this image?" | Correct description of the actual image | DEV | WORKS | |
| T055 | 🔴 P1 | Attach an image to a bigger vision model (SmolVLM / Qwen2B) → send | Describes the image (no "Failed to evaluate chunks" crash) | DEV-B9 | BROKEN (decode fails) | |
| T056 | 🔴 P1 | A vision decode error occurs | Spinner clears + an error renders (not infinite spin) | DEV-B13 | BROKEN (spins forever) | |
| T057 | 🔴 P2 | Attach an image in the input box → tap the thumbnail (pre-send) | A preview opens | DEV | BROKEN (no preview) | |
| T058 | 🔴 P2 | A vision-capable model on litert vs its gguf variant | Vision affordance consistent across engines | DEV-B20 | litert hides vision | |
| T059 | 🔴 P1 | Voice note + a TOOL enabled on LiteRT | Transcript sent, not raw audio; no "File does not exist" | Q17 | BROKEN (tool-loop leaks audio) | |
| T060 | 🔴 P1 | Image on a non-vision LiteRT model + tool | Graceful "does not support images", not a native crash | Q17b | BROKEN | |

## Area 8 — Image generation & settings

| ID | Type/Sev | Steps (gestures) | Expected | Ref | Device | Result |
|---|---|---|---|---|---|---|
| T061 | ✅ P1 | Image mode ON → "draw a dog" (fresh message) | Generates an image; details show correct backend | DEV | WORKS (GPU/mnn) | |
| T062 | 🔴 P1 | Generate "draw a dog" → **resend it** (action menu) | Resend STILL routes to image (draws), not the text model | DEV-B33 | BROKEN (resend→text) | |
| T063 | ✅ P2 | Model Settings → Image Size | Cannot go below 256 (input floor) | Q1/DEV | GUARDED (works) | |
| T064 | 🔴 P2 | Set image size / verify the generated image size matches | Generated size == the size shown (no silent floor to 256 at gen) | Q1/Q13 | guarded at input now | |
| T065 | 🔴 P2 | Set `imageGuidanceScale` to 0 / stale → generate | Uses 7.5 default, not a drift to 2.0 | Q7 | BROKEN (2.0 drift) | |
| T066 | 🔴 P2 | Chat Settings sheet → "Reset to Defaults" | Resets image steps/size/guidance/threads too (not only text params) | Q12 | BROKEN (partial) | |
| T067 | 🔴 P2 | Compare Image sliders in the modal vs Model Settings | Same mins/fallbacks (256 vs 128 divergence gone) | Q13 | BROKEN (diverge) | |
| T068 | ✅ P1 | Tap a generated image in chat | Fullscreen lightbox opens with Save/Close; Save persists + confirms | DEV | WORKS | |
| T069 | ✅ P1 | Image-intent routing: "calculate X" with an image model active | Routes to TEXT (not image) | DEV | WORKS | |
| T070 | ✅ P2 | First image gen on a model | ~120s warmup notice matches reality (or is accurate) | DEV-B21 | UI says 120s, was ~10s | |

## Area 9 — Prompt enhancement

| ID | Type/Sev | Steps (gestures) | Expected | Ref | Device | Result |
|---|---|---|---|---|---|---|
| T071 | 🔴 P1 | Enable "Enhance Image Prompts" + thinking ON → "draw a cat" | Enhanced prompt is a clean image description (NO "Thinking Process:…" reasoning in it) | DEV-B30 | BROKEN (thinking→prompt) | |
| T072 | 🔴 P1 | Same as above — observe timing | Enhancement is fast (a plain completion, not a full reasoning chain) | DEV-B30 | SLOW (thinking chain) | |
| T073 | 🔴 P2 | During enhancement | It streams / shows progress (not a static frozen-looking screen) | DEV-B30b | no stream | |
| T074 | ✅ P2 | Enhancement mechanics (thinking off) | Rewrites prompt → regenerates image from it | DEV | works (slow) | |

## Area 10 — STT / voice input

| ID | Type/Sev | Steps (gestures) | Expected | Ref | Device | Result |
|---|---|---|---|---|---|---|
| T075 | 🔴 P0 | **Chat mode** → tap mic → speak a clear phrase → release | Transcript appears in the input / message (audio actually captured) | DEV-B26 | BROKEN (hasData:false, nothing) | |
| T076 | 🔴 P1 | **Chat mode** → record a voice note → send (direct-audio model) | The TRANSCRIPT is sent to the model, never raw audio | Q20/DEV-B10 | BROKEN (sends audio) | |
| T077 | 🔴 P1 | Start recording → wait / move on | Recording auto-stops; whisper doesn't stay resident indefinitely | DEV-B11 | BROKEN (7+ min leak) | |
| T078 | 🔴 P2 | Double-tap the mic quickly | No `State:-100` race / start-while-recording collision | DEV-B12 | BROKEN (race) | |
| T079 | ✅ P1 | **Voice mode** → record → "hey how are you doing" | Correct transcript renders | DEV | WORKS | |
| T080 | 🔴 P0 | ARCHITECTURE: chat-mode & voice-mode STT | Both use ONE transcribe pipeline (record→file→transcribe) | DEV-B28 | BROKEN (3 divergent pipelines) | |

## Area 11 — TTS

| ID | Type/Sev | Steps (gestures) | Expected | Ref | Device | Result |
|---|---|---|---|---|---|---|
| T081 | ✅ P1 | Voice mode → get a reply | Kokoro speaks the answer aloud (24kHz) | DEV | WORKS | |
| T082 | 🔴 P1 | **Chat mode** → tap the speaker on an assistant bubble | Reads clean text (no `**`, `##`, backticks, table pipes) | Q19 | BROKEN (raw markdown) | |
| T083 | 🔴 P2 | Delete a TTS model mid-playback | Graceful (canEvict veto), no broken playback | V5-gap | verify | |

## Area 12 — Voice-mode journeys (end-to-end)

| ID | Type/Sev | Steps (gestures) | Expected | Ref | Device | Result |
|---|---|---|---|---|---|---|
| T084 | ✅ P1 | Voice mode → "draw a dog" | STT → routes to IMAGE → image renders → TTS confirms | DEV | WORKS | |
| T085 | ✅ P1 | Voice mode → "calculate 500 × 321" (nudge tool) | STT → routes to TEXT → calculator → correct answer → TTS | DEV | WORKS | |
| T086 | 🔴 P2 | Voice mode with a thinking reply | Thinking block == voice-note bubble width, LEFT-aligned (not full-width) | DEV-B27 | BROKEN (full-width) | |
| T087 | 🔴 P2 | Voice mode after a tool turn | No stray empty "#" bubble renders | DEV-B32 | BROKEN (stray # bubble) | |
| T088 | 🔴 P1 | Voice mode, generation in flight | Mic button becomes a STOP button (can't accidentally start a new recording) | DEV-B29 | BROKEN in some states | |

## Area 13 — Projects & RAG

| ID | Type/Sev | Steps (gestures) | Expected | Ref | Device | Result |
|---|---|---|---|---|---|---|
| T089 | ✅ P1 | Create a project (form) → add a text PDF to KB → chat a doc question (≥2B model) | Calls search_knowledge_base → retrieves real chunks → answer grounded in the doc | DEV | WORKS (validated) | |
| T090 | 🔴 P1 | Create a project + chats → delete the project | Chats not orphaned with a dangling projectId (re-filable/cleared) | Q9 | BROKEN | |
| T091 | 🔴 P1 | Orphaned chat (project deleted) → send | Does NOT inject search_knowledge_base for the gone project | Q9b | BROKEN | |
| T092 | 🔴 P1 | New chat → pick a project (before 1st message) → send | Chat is filed under the project | Q10 | BROKEN (pendingProjectId lost) | |
| T093 | 🔴 P2 | Project chat → context-full → tap "New chat" in the alert | New chat inherits the project | Q11 | BROKEN (unassigned) | |
| T094 | ℹ️ P2 | RAG with a 0.8B model | (KNOWN) needs ≥2B model to reliably call the KB tool | DEV | model-limit | |

## Area 14 — UI / rendering / misc

| ID | Type/Sev | Steps (gestures) | Expected | Ref | Device | Result |
|---|---|---|---|---|---|---|
| T095 | ✅ P2 | Complete onboarding with a server+model configured | Skips onboarding into the app | DEV | WORKS | |
| T096 | ✅ P2 | Support-share sheet (GH/X) → return from X | Sheet dismisses, doesn't re-nag | DEV | WORKS | |
| T097 | ✅ P2 | Home "Text" count with a remote model active | Count reflects reality (or "0 local" is clearly not a desync) | DEV | verify (showed 0) | |
| T098 | 🔴 P2 | Load a local model, then send a NEW message (not resend) | The local model is the ACTIVE model (not still remote) | DEV-B18 | verify (resend went isRemote) | |

## Platform parity (iOS — run the native-divergent ones)
Re-run on iOS (native differs): T003/T004/T008 (downloads/URLSession-kill), T015–T021 (backends — note litert is
Android-only; iOS has Metal), T024/T028/T029 (memory/jetsam), T054–T056 (vision Core ML), T061/T068 (image Core
ML + lightbox), T075–T080 (STT), T081 (TTS). Shared-JS areas (remote framing, thinking parse, routing) are
covered by Android — don't re-run the full matrix on iOS.

---

### Summary counts (fill Result each release)
- Adversarial 🔴 to verify-fixed: ~55 · Happy ✅ regression: ~25 · Known model-limits ℹ️: 3.
- P0 blockers to watch: T022/T023 (whisper leak+eject), T024/T031 (memory/thermal), T075/T080 (STT capture+arch).
