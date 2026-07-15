# From-device ground-truth capture — OPTIMIZED fresh-start run

Goal: exercise every native seam the test fakes invent a shape for, in the order that costs the least
phone wall-clock. All capture lines tee into an append-only, never-rotated `Documents/offgrid-wire.log`.

Two constraints drive the ordering:
1. **Downloads are the long pole** (GBs). Start them ALL first, then do work that needs no download while they run.
2. **Only ONE heavy model is resident at a time** — every text↔image↔vision switch forces a load/unload.
   So do ALL prompts for a loaded model before switching. Never ping-pong.

Pull anytime (lossless): `adb exec-out run-as ai.offgridmobile.dev cat files/offgrid-wire.log > /tmp/wire-android.log`

---

## Stage A — launch (FREE, one-time, automatic)  → `[WIRE-DEVICE]`, `[WIRE-DEVICE-SOC]`
1. Delete app → reinstall → open. Device detection fires on first launch (RAM/model/SoC/NPU).
   - *Why:* grounds onboarding recommendations + the memory budget + the qnn/NPU image gate. No action needed beyond launching.

## Stage B — kick off ALL downloads at once (start the long pole)  → `[WIRE-DOWNLOAD]`, `[WIRE-UNZIP]`
2. From onboarding/model manager, queue everything in this order (front finishes first → testable soonest;
   big ones at the back keep downloading while you work):
   **(a)** a small text gguf (e.g. Qwen3.5) · **(b)** whisper STT · **(c)** embedding model · **(d)** a TTS voice
   · **(e)** Gemma-4 litert · **(f)** Mistral gguf · **(g)** Llama gguf · **(h)** vision gguf (+mmproj, big)
   · **(i)** image model (zip, big).
   - *Why:* queuing 8-9 at once = real parallel + queued rows (`[WIRE-DOWNLOAD]` getActiveDownloads); the image zip → `[WIRE-UNZIP]` extracted listing. This is the download/relaunch + integrity fixtures. **Do NOT wait here — go to Stage C while these run.**
3. (Optional, high value) once one download is mid-flight, force-quit + relaunch the app.
   - *Why:* iOS-URLSession-dies vs Android-WorkManager-survives — the platform-parity capability.

## Stage C — REMOTE providers (runs DURING downloads — needs no local model)  → `[WIRE-REMOTE]`, `[WIRE-OLLAMA]`
4. Configure **LM Studio**, then **Ollama**, then **OGA Desktop** (one at a time). For each, send the 5 prompts:
   - plain: `What is the capital of France?`
   - thinking (reasoning ON): `A train covers 60 km in 45 min. Speed in km/h? Reason step by step.`
   - tool (calculator ON): `What is 47 times 89?` (let it run + answer)
   - thinking+tool: `Reason about it, then compute 128 * 256 with the calculator.`
   - two tools: `What is 12*12 and also 30% of 400?`
   - *Why:* `[WIRE-REMOTE]`/`[WIRE-OLLAMA]` = how remote streams thinking (`<think>` vs reasoning field) + tool_calls (delta-partial vs final). Pure network → overlaps the downloads perfectly, zero wasted wait.

## Stage D — on-device text, ONE block per model (as each finishes; minimize swaps)  → `[WIRE-CAPS]`, `[WIRE-LLAMA*]`, `[WIRE-LITERT*]`, `[WIRE-LLAMA-LOAD]`, `[WIRE-RAM]`
First: enable the **calculator tool** once (it persists). Then for **each** text model (small gguf, Mistral, Llama, Gemma-4 litert), in this ONE block before switching:
5. Load it → `[WIRE-CAPS]` (tool caps), `[WIRE-LLAMA-LOAD]`/`[WIRE-LITERT-LOAD]` (load config), `[WIRE-RAM]`.
6. Send the 5 prompts (plain, thinking, tool, thinking+tool, two-tools) → `[WIRE-LLAMA]`/`[WIRE-LITERT]` stream + `[WIRE-*-TOOL]` framing.
7. Change **Temperature** + toggle **Thinking**, resend one prompt → `[WIRE-LLAMA-PARAMS]` (settings→native, no reload).
8. (Once, on ONE model only) change **context size** in model settings + reload → a second `[WIRE-LLAMA-LOAD]` (load-config mapping). No need to repeat per model.
   - *Why:* the single highest-value capture — real token/thinking/tool wire format per model family, plus the settings→native mappings. Grouped so each model loads once.

## Stage E — heavy single-resident blocks (each forces a swap; do all-in-one)
9. **Image**  → `[WIRE-IMAGE-CONSTANTS]`, `[WIRE-IMAGE-PARAMS]`, `[WIRE-IMAGE]`, `[WIRE-IMAGE-PROGRESS]`
   Generate once (defaults), then change **Image Size** (128 then 256), **Steps**, **Guidance** → generate after each.
   - *Why:* requested-vs-native params (size-floor/guidance-clamp bugs Q1/Q7/Q13) + real progress/preview event shape.
   - *Note:* your device's SoC (`[WIRE-DEVICE-SOC]`) decides backends — qnn only on Snapdragon; elsewhere the qnn refusal + mnn/cpu path are the real captures.
10. **Vision**  → `[WIRE-VISION]`, `[WIRE-LLAMA]`
    Load the vision gguf, attach a photo, ask `What's in this image?`.
    - *Why:* real `initMultimodal` support flags + vision response shape. (Use a **gguf** vision model — the litert vision path only captures the response, not the init flags.)

## Stage F — small-model blocks (fast; any order)
11. **STT**  → `[WIRE-STT]` — record a voice note (let it transcribe) AND a **silent/short** clip (captures the no-speech marker).
12. **TTS**  → `[WIRE-TTS]` — tap **Speak** on any assistant reply (note the engine; OuteTTS is instrumented — tell me if you use Kokoro/Qwen3).
13. **RAG**  → `[WIRE-EMBED]`, `[WIRE-PDF]` — create a project, add a **PDF** to its knowledge base, chat a question answerable from it.
    - *Why:* real embedding dimensionality + native PDF→text shape.

---

## What is NOT a capture target (pure JS — already real in jest, no device run needed)
Projects, conversation management (rename/move/delete), message edit/copy, settings *storage*, navigation.
These run for real in the tests over faked AsyncStorage — nothing native to ground.

## Efficiency summary
- **Stage C overlaps Stage B** — remote testing fills the entire download wait (biggest time save).
- **One load per model** (Stage D grouped) — no repeated heavy loads.
- **Load-config + context-size captured once**, not per model.
- **Free/auto captures**: device detection (A), RAM (every load), caps (every load).
- Pull `offgrid-wire.log` once at the end — it's lossless, so no need to pull between stages.
