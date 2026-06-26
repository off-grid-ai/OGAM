# Model Routing & Orchestration — Design Plan

Status: **proposal, for review** · Owner: TBD · Last updated: 2026-06-20

## 1. Problem

A user can have several on-device models installed across different jobs:
text-to-text (llama GGUF), text-to-image (diffusion), speech-to-text
(Whisper), and text-to-speech (pro TTS engines). Today the user must manually
pick the active model, and a chat effectively assumes a text model is loaded.

We want: **the user types (or speaks) a request, and the app figures out which
model is needed, loads it if it isn't already, and runs it** — without the user
hand-selecting a model first. First load of a model is slow; subsequent uses are
fast (warm).

## 2. The key distinction (read this first)

The "4 models" are not 4 interchangeable routing destinations. They split on two
axes:

| Axis | Models | Role |
|---|---|---|
| **Generation target** (what produces the answer) | text-to-text, text-to-image | A prompt is *routed to* one of these. |
| **I/O modality** (how input/output is carried) | STT (speech in), TTS (speech out) | Layered around a turn — not a destination. |

So the routable decision per turn is **text vs image**. STT just turns a
voice note into the prompt text *before* routing; TTS just speaks the result
*after*. This matters because it keeps the router small and correct: one
classifier (text vs image), not a 4-way switch.

```
                 ┌──────────── optional STT (mic) ───────────┐
   voice input ──┤                                            │
                 └──> prompt text ──> [ROUTER: text|image] ──> generation
   typed input ─────> prompt text ──┘                           │
                                                                 ▼
                                              text answer ──> optional TTS (speak)
```

## 3. What already exists (reuse, don't rebuild)

- **`intentClassifier`** (`src/services/intentClassifier.ts`): classifies a
  message as `text | image`. Two modes — fast keyword heuristics, or an LLM
  classifier model (`settings.classifierModelId`). It **already hot-swaps** to
  the classifier model and remembers the original.
- **`activeModelService`**: `loadTextModel(id)`, `getActiveModels()`,
  `unloadImageModel()` — the model lifecycle singleton.
- **`llmService`**: `getLoadedModelPath()`, `isModelLoaded()`,
  `generateResponse()` — one text context at a time.
- **`whisperStore`** (STT): `downloadedModelId`, `loadModel()`,
  `unloadModel()` — currently a single active model.
- **pro `ttsStore` / engine registry** (TTS): `isReady`, `setEngine`,
  `initializeEngine()`.
- **`settings.modelLoadingStrategy`**: existing knob for eager/lazy loading.
- Chat already supports an **image-only path** (`hasActiveModel = text || image`,
  `shouldRouteToImageGenerationFn` returns image when no text model).

**Conclusion:** ~70% of the primitives exist. The work is an orchestration layer
on top, plus a memory/eviction policy, not a from-scratch system.

## 4. The hard constraint: memory

You cannot hold a text LLM + a diffusion model + Whisper + a TTS engine in RAM
simultaneously on a phone. "Everything hot" is not achievable. So:

- **At most one generation model resident at a time** (text *or* image).
- Whisper and a TTS engine are smaller and may co-reside with a generation
  model on higher-RAM devices, but must be evictable.
- "Hot loading" therefore means **load-on-demand + evict-the-previous**, with the
  OS file cache making the *second* load of a given model fast. First load is
  slow — accepted and surfaced with a loading state.

This makes an explicit **memory budget + eviction policy** the core of the
design, not the classifier.

## 5. Proposed architecture

### 5.1 `modelOrchestrator` (new service, core)

A single entry point the chat send-path calls instead of assuming a loaded model.

```
orchestrateTurn({ promptText, forceTarget?, ramBudgetMB }) →
  1. target = forceTarget ?? classify(promptText)        // 'text' | 'image'
  2. ensureResident(target)                               // load if cold, evict others
  3. return a handle the caller runs generation against
```

Responsibilities:
- Decide the target (delegates to `intentClassifier`).
- Ensure the target model is resident (delegates to `activeModelService`).
- Enforce the memory budget by unloading what's not needed.

### 5.2 Residency manager (memory budget + eviction)

- Track what's loaded (`activeModelService.getActiveModels()` + whisper + tts).
- A simple policy to start: **one resident generation model**; loading text
  unloads image and vice-versa. Whisper/TTS load on use, unload on memory
  pressure or when idle.
- LRU eviction when a new load would exceed the device RAM budget
  (`hardwareService.getTotalMemoryGB()` → budget). Log every evict (no silent
  drops).
- Future: keep a tiny classifier model pinned (see 5.3).

### 5.3 The classifier (avoid "load a model just to choose a model")

**Routing only runs when there is a real choice.** If only one generation model
is available, skip classification entirely and use it — no model, no overhead.
The classifier earns its keep only in the ambiguous multi-model case. (See §6.)

Loading a 1GB LLM only to decide "text vs image" defeats the purpose. So, in
order of preference:
- **Heuristics-first** (the keyword classifier already exists, ~instant, no
  load). Route on that unless genuinely ambiguous.
- **Pinned SMOL LLM — default model: `SmolLM2-135M-Instruct` (GGUF, Q4/Q5,
  ~100MB).** Runs on the existing llama.rn runtime, small enough to keep
  **pinned resident** (reserved in the budget, excluded from eviction) so
  classification never triggers a big swap. Prompted for a one-word label.
- **Upgrade path (not now): encoder/embedding classifier** — e.g.
  `all-MiniLM-L6-v2` (embedding + cosine-to-label, ~22–90MB) or a fine-tuned
  MobileBERT/TinyBERT. Strictly better classification per-MB (discriminative,
  single forward pass), but needs an ONNX/embeddings runtime the app doesn't
  ship today. Revisit only if heuristics + SmolLM2 prove insufficient.
- Cache decisions per prompt (already done via `intentCache`).

### 5.4 STT / TTS integration (modalities)

- **STT**: the mic button transcribes with the active Whisper model, then feeds
  the text into `orchestrateTurn`. Active-Whisper selection is its own small
  feature (see §7) — independent of routing.
- **TTS**: unchanged audio-mode toggle; speaks the final text answer. The
  orchestrator does not route to TTS; the audio-mode hook does.

## 6. Routing decision flow (per turn)

1. Input arrives (typed, or STT-transcribed voice note).
2. **Gate — is there a choice?** Count the *available* generation models
   (downloaded text + downloaded image). **If ≤ 1, skip routing entirely**: use
   the one that exists (or the image-only path). No classifier runs. Routing and
   the SMOL classifier only engage when **2+ generation targets are available.**
3. `forceTarget`? (explicit image button) → skip classify, use it.
4. Else classify text vs image (heuristics first; pinned SMOL model only if
   ambiguous).
5. `ensureResident(target)`: if cold, show "Loading <model>…", evict as needed,
   load. If warm, proceed instantly.
6. Run generation; stream result.
7. If audio mode on and target was text → TTS speaks it.

> Note: under the one-resident-generation-model budget (§4), text and image
> generation models are never resident simultaneously. "Multiple models" in the
> gate means **available/downloaded**, not co-resident — routing decides which
> one to make resident.

## 7. Phasing (each phase shippable on its own)

- **Phase 0 — Active model selection (prereq, small).**
  Let users pick the active Whisper model among several downloaded (track
  multiple ids, tap-to-activate in the Transcription tab). Same for confirming
  text/image active selection is coherent. No routing yet.
- **Phase 1 — Auto-load the routed generation model.**
  On send, classify (heuristics) → if the needed gen model isn't resident, load
  it (evicting the other) with a visible loading state. Removes manual
  pre-selection for text↔image. Reuses `intentClassifier` + `activeModelService`.
- **Phase 2 — Residency manager + memory budget.**
  Formalize the budget + LRU eviction across text/image/whisper/tts. Instrument
  loads/evicts. Handle low-RAM devices gracefully.
- **Phase 3 — Pinned tiny classifier (optional).**
  Allow a small always-resident classifier for higher-accuracy routing without a
  big-model swap. Opt-in in settings.
- **Phase 4 — Polish.**
  Pre-warm prediction (load the likely-next model during idle), per-conversation
  sticky target, telemetry on misroutes.

## 8. Risks / open questions

- **Misclassification** routes to the wrong (and slow-to-load) model. Mitigate:
  heuristics-first, a manual override chip, decision cache, easy "switch to
  text/image" affordance.
- **Load latency** on first use (multi-GB models). Mitigate: clear loading UI,
  pre-warm in Phase 4.
- **Memory thrash** if the user alternates text/image every turn (constant
  load/evict). Mitigate: sticky target per conversation; only swap on a
  confident classification.
- **Whisper multi-model state** needs a small refactor (single → many).
- **iOS vs Android** native load/unload behaviour must be verified equally.

## 9. Testing

- Unit: orchestrator decision table (forceTarget, cold/warm, image-only).
- Unit: residency/eviction policy under a fake RAM budget.
- Integration: STT → orchestrate → generate → TTS end-to-end with mocked
  native layers.
- Device: real first-load vs warm-load timings; alternating text/image; low-RAM
  device behaviour.

## 10. Recommendation

Build **Phase 0 then Phase 1** first — they remove the "must pre-select a model"
friction with low risk and reuse existing services. Treat Phases 2–4 as a
follow-up once the load-on-demand UX is proven on-device.
