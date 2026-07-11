# Device wire-capture — progress & resume checklist

Android run, 2026-07-11. Full analysis: `DEVICE_TEST_FINDINGS.md`.
Raw commentary: `DEVICE_SESSION_COMMENTARY.md` (gitignored). Logs: `docs/wire-captures/` (17 snapshot sets).

**Latest snapshot:** `wire-android-20260711-part15-lastpull.log` (4079 lines, 0 malformed). Append-only,
lossless — the on-device file also still holds the whole run since 06:39.

**Pull commands:**
```sh
adb exec-out run-as ai.offgridmobile.dev cat files/offgrid-wire.log  > /tmp/wire-android.log
adb exec-out run-as ai.offgridmobile.dev cat files/offgrid-debug.log > /tmp/debug-android.log   # [MEM-SM]/[GEN-SM]/etc traces
```

---

## OVERALL PLAN (agreed)
1. **Finish Android capture** (this checklist) — backends → STT → TTS → RAG → image-size/lightbox.
2. **Write the tests** from the ground truth: adversarial/red tests for every FAILURE (B1–B21),
   success/happy tests for everything that WORKED.
3. **Then iOS** — only the native-divergent seams (image Core ML + meta, downloads+kill, memory,
   sanity gguf/STT/vision). NOT the full text/remote/format matrix (shared JS — Android covers it).

## ▶ START HERE (resuming — Android)
1. **Force-restart the app first** (clears any leaked whisper model → everything fast).
2. Work down the "TO DO" list below. Ping to pull after each subsystem (or run several — log is lossless).
3. Per-model recipe when relevant: **(a)** thinking OFF + tools OFF → `What is 47*89 and what is 30% of 400?`
   **(b)** thinking ON + tools ON → same + "reason step by step".

## TO DO (Android — remaining)
- [ ] **Compute backends — llama × {CPU, GPU/OpenCL, NPU/HTP}** and **litert × {GPU, CPU}**. DO THIS FIRST.
      Model Settings → Text Generation → Advanced → **Backend** selector (`BackendSelector` for llama,
      `LiteRTBackendSelector` for litert; "Requires model reload"). For each backend: select it, reload the
      model, send one prompt. Captures `[WIRE-LLAMA-LOAD]`/`[WIRE-LITERT-LOAD]` (requested vs actual backend,
      nGpuLayers, offloaded X/Y) + confirms which backends REALLY work on-device vs fall back.
      Watch: does **NPU/HTP** actually load (device is qnn `min`), or fall back? Does **GPU** offload real
      layers (we saw gemma gguf fall to CPU: offloaded 0/36)? Response tokens are backend-independent — the
      value is the LOAD config + does-it-work, not the wire format.
      testIDs: `litert-backend-{gpu|cpu}-button`. (Metal is iOS-only — skip on Android.)
- [ ] **STT working case** — record a voice note in a mode that SHOULD transcribe → `[WIRE-STT]` with real
      text (we only have the broken Q20/raw-audio case). Also watch: does STT stop cleanly? (B11 no-stop leak)
- [ ] **TTS** — tap **Speak** on a reply (kokoro → `[WIRE-TTS]`)
- [ ] **RAG** — new project → add a **PDF** to its knowledge base → ask a question from it
      (`[WIRE-EMBED]` + `[WIRE-PDF]`)
- [ ] **Image size 128** — set it in image settings, regenerate → does it floor to 256? (Q1) + change guidance (Q7)
- [ ] **Image lightbox** — tap a generated image → does the viewer open with save/close?
- [ ] **qnn/NPU image backend** — if a backend selector exists, pick it (device supports qnn `min`; default = GPU)
- [ ] **Verify B18** — does loading a local model actually make it ACTIVE? (a resend went `isRemote=true` with
      gemma resident) — load local, send NEW message, check the pull shows `isRemote=false`

## TO DO (iOS — fresh session, platform parity)
- [ ] Native-divergent seams only: image (**Core ML** vs Android's LocalDream), STT, one gguf turn,
      one litert turn, vision. Same pull, iOS UDID in the `xcrun devicectl` command (see below).
```sh
xcrun devicectl device copy from --device <IOS_UDID> --domain-type appDataContainer \
  --domain-identifier ai.offgridmobile --source Documents/offgrid-wire.log --destination /tmp/wire-ios.log
```

---

## DONE (Android) ✅
- Device/SoC/RAM (SM8635, qnn `min`, hasNPU, 11.8GB), downloads (14 models, parallel/queued), 3 memory gates
- **Text engines:** Qwen0.8B gguf (full: bare/thinking/tools/parallel/queue/stop), gemma-4-E2B gguf,
  **litert (full — the 3rd `litert_thinking` channel captured)**
- **Remote:** OGAD (all 5 cases), LM Studio (bare/tools/vision), Ollama (bare/tools/thinking/vision)
- **Vision:** Qwen0.8B works, SmolVLM+Qwen2B crash (B9), LM Studio remote vision works
- **Image gen:** AnythingV5 + Absolute Reality (GPU/mnn, ~10s each), image-intent routing (draw vs text)
- **Budget/residency:** B1 whisper leak, B2 budget>physical, B3 CPU-fallback, M11 eviction-works-here
- **Thinking ground truth: all 4 formats** (inline `<think>` / `litert_thinking` / `reasoning_content` / ollama `thinking`)

## KEY BUGS → TURN INTO TESTS (priority)
1. **B1 whisper coresidency leak** (auto-loads on download; ejectAll can't clear; makeRoomFor won't evict) — headline
2. **B10/Q20 voice-note-not-transcribed** (spec: always transcript, never raw audio to the model)
3. **B16 LM Studio drops `reasoning_content`** (no toggle → thinkingEnabled=false → discarded; Ollama's works)
4. **B14 thinking renders in answer bubble until close delimiter** (should be thinking-block from token 1)
5. **B2 budget > physical RAM** (`fits=true` while model size > `os_procAvail`)
6. **B9 vision decode fails** on SmolVLM/Qwen2B (`evaluate chunks`); Qwen0.8B works
7. **B13** error doesn't clear spinner · **B15** silent max-predict cutoff · **B3** CPU-fallback from inflated estimate
(Full list B1–B21 + 3 honest corrections in `DEVICE_TEST_FINDINGS.md`.)
