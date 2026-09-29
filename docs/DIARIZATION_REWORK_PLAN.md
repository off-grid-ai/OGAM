# Diarization + Adaptive VAD + Relevance Rework — Plan

Status: proposed (2026-09-29). Owner: Sidd. Spans OGAM (phone), pro/ (offload wiring),
shared/@offgrid/models (catalog), OGAD (Mac gateway).

## Why

Today's diarization (pyannote-seg 3.0 + CAM++/ERes2Net/TitaNet embeddings via sherpa-onnx) is
not accurate enough, and — more importantly — **accuracy alone does not deliver the product**. The
24/7 recorder captures everything: traffic, TVs, and conversations happening *near* the owner that
the owner is not part of. The goal is a Day made only of the conversations the owner is **actually
in**, with clean who-spoke-when, so journal/to-dos are built from signal, not clutter.

## The key insight (do not skip)

"Get a better diarizer" is necessary but **not sufficient**. A perfect diarizer will accurately
label the baristas across the counter. The product is a **relevance decision** layered on top of
diarization, and the strongest signal for it is **foreground / near-field**: the mic is on the owner,
so the owner's voice is near-field (loud, high SNR, low reverb) and a real conversation is one where
*near-field owner turns interleave with other near-field turns*. Overheard talk is far-field; traffic
is non-speech. This is the research-backed "Foreground VAD" framing: foreground = sustained presence,
not instantaneous loudness.

Design against the obvious failure mode: **conversations where the owner mostly listens** (a meeting,
a 1:1, a lecture) must be KEPT even though the owner barely speaks. So relevance ≠ "owner talks a
lot." It's "owner is present + near-field + part of the turn-taking."

## Architecture — five distinct stages

```
mic → [1 Adaptive VAD] → [2 Diarization] → [3 Speaker ID / owner] → [4 Conversation segmentation] → [5 Relevance/FVAD gate] → Day
```

1. **Adaptive VAD** — is anyone speaking? Silero VAD v6 + slow-rise/fast-fall noise-floor tracker so a
   loud café doesn't blow it up. Front gate that drops silence/traffic before anything expensive runs.
2. **Diarization** — who spoke when. New models (see below). Anonymous clusters + per-turn embeddings.
3. **Speaker ID** — map a cluster to the owner via the enrolled voiceprint (we already have enrollment
   + one shared vector space). Also names other enrolled people.
4. **Conversation segmentation** — chop the day into discrete conversations by time gaps + speaker-set
   continuity (already partially present as "sessions").
5. **Relevance / FVAD gate** — per conversation, decide owner-in vs overheard/noise. v1 = explainable
   heuristic (owner present + near-field + turn interleave + sustained presence); v2 = a trained FVAD
   head if the heuristic isn't enough. Only relevant conversations feed journal/to-dos; the rest are
   kept as low-priority "ambient" or dropped per the retention setting.

## DECISIONS (locked 2026-09-29)

- **Runtime = ONNX everywhere, no Python, sherpa's diarizer removed.** There are ONNX exports of
  Nemotron 3 on HF that run under onnxruntime with no PyTorch/NeMo. Desktop runs Nemotron 3 ONNX under
  onnxruntime (Python-free); mobile runs it via onnxruntime / ExecuTorch (the app already bundles
  react-native-executorch), with a lighter on-device fallback if a phone can't handle it. Both are
  offered as selectable options. The current sherpa seg+embedding stack is retired as the primary path,
  kept only if it's the sole thing that runs on a given device.
- **Relevance = a weighted, tunable 3-factor score** (not near-field alone):
  1. **Near-field** (acoustic) — gates out overheard talk + traffic.
  2. **Owner participation** (vocal fingerprint) — how actively the owner took turns.
  3. **Importance** (summary LLM judges the transcript) — is it about the owner's world (tasks,
     commitments, decisions).
  Kept iff the combined score clears a tunable threshold. This resolves the owner-listening trap: a
  meeting where the owner is quiet but the content is about their project scores low participation but
  high importance → kept; overheard gossip is far-field + no participation + low importance → dropped.

## Models — two tiers, user-selectable, pulled from Hugging Face

Same UX as our other models: a Models-screen list where the user picks the diarization model; we pull
weights from HF on demand. Because the best model (Nemotron 3) is heavy and NeMo/PyTorch, we run a
**two-tier** strategy — the same split we already have for transcription offload:

- **Mac-offload tier (accurate):** **NVIDIA Nemotron 3 Diarization** — 100M params, open-weight,
  streaming+offline, up to 8 speakers, #1 on Voice Arena Diarization-Bench (14.72% DER), ~41% rel.
  DER reduction vs Streaming Sortformer. Runs on the Mac gateway (`/v1/audio/diarize`). Easy: 100M is
  nothing for the Mac. Also add **Streaming Sortformer 4spk v2.1** as a lighter Mac option.
- **On-device tier (fallback when the Mac is away):** keep pyannote-seg + a sherpa-compatible embedding
  model for now. Upgrade path: whichever of the above has (or gets) an ONNX/CoreML export that runs
  under sherpa-onnx. **Open question to verify early:** is there an on-device-runnable export of
  Nemotron 3 / Sortformer? If not, on-device stays on the current stack and the Mac tier is the win.

Catalog model = "a diarization bundle": a segmentation/diarizer model + an embedding model + which tier
it runs on + HF repo/files + dims + max speakers + license. Phone remains the single source of truth
for which one is active; the Mac auto-pulls the selected one (we already do this via `embeddingModel`).

## Confirmed model spec (Nemotron 3 ONNX)

- Repo: `onnx-community/Nemotron-3-Diarization-ONNX` (external-data ONNX: small `.onnx` graph +
  `.onnx_data` weights). Precisions: fp32 (398MB), fp16 (199MB), q4 (83MB), q4f16 (73MB), int8 (120MB).
  **Desktop → model_fp16; mobile → model_q4f16.** Config: `config.json`, `preprocessor_config.json`,
  `processor_config.json`.
- **Input:** raw waveform, 16 kHz mono (model computes 10ms mel internally).
- **Output:** `[T, 8]` per-frame per-speaker activity probabilities in [0,1] → postprocess to labelled
  turns. **No embeddings.** → Owner/person IDENTITY still needs a companion voiceprint model (reuse
  CAM++/embedding catalog): run the embedding model over each Nemotron speaker's turns, match to enrolled
  profiles. So a "Nemotron bundle" = Nemotron diarizer (turns) + embedding model (identity).
- Max 8 speakers. Streaming (80ms–1.04s latency) or offline (30.4s buffer) — we use offline for the
  batch Day pipeline, streaming later if we want live labels.

## Adaptive VAD — design

- Base: **Silero VAD v6** (JIT ~2MB; on-device already viable). Tune the four params that matter:
  `threshold`, `min_speech_duration`, `min_silence_duration`, `speech_pad`.
- **Adaptive noise floor:** maintain a rolling noise-floor estimate with **slow-rise / fast-fall**
  (drop the floor immediately to a lower input level; raise it slowly, attributing rising energy to
  speech). Effective threshold = floor + margin. This handles nonstationary noise (street → quiet room).
- **Near-field gate:** compute per-frame SNR / near-field score; only "arm" a conversation when
  near-field speech is present (owner likely in scene). Cheap and high-leverage.

## Relevance / FVAD — design

- **v1 (heuristic, ship first):** per candidate conversation, score on:
  - owner voiceprint present (from stage 3), AND
  - other turns are near-field (talking *with* the owner, not overheard), AND
  - turn interleave / sustained presence over the window (dialogue, not a nearby monologue).
  Output a relevance score + reason; threshold tunable. Owner-listening case handled by near-field +
  presence, NOT owner talk-time.
- **v2 (trained FVAD head), only if v1 underperforms on the eval:** frame-level foreground classifier
  trained with competing-speaker mixing (per the FVAD literature). Bigger lift; gate behind evidence.

## Eval harness — build FIRST (highest leverage)

We cannot tell if a model swap or VAD tweak helps without ground truth. Before swapping anything:
- Collect 3–5 real day recordings; hand-label (a) who-spoke-when and (b) which spans the owner is
  genuinely in.
- Metrics: **DER** for diarization; **precision/recall on "kept the right conversations"** for
  relevance; VAD false-accept rate on noise-only clips.
- A repeatable script that runs a candidate stack over the labeled set and prints the metrics. Every
  model/threshold change is judged against this, not vibes.

## Integration points

- **shared/@offgrid/models:** extend the diarization catalog (new entries + fields: tier, HF repo/files,
  maxSpeakers, license, runtime). Keep phone-driven selection.
- **OGAM phone:** Models-screen selection for diarization models (mirror existing model UX); on-device
  sherpa path stays as fallback; wire the adaptive VAD front-gate + relevance gate into the ambient
  pipeline (`speakerAnnotationFactory` / `timelineBuilder`).
- **pro/ (offload):** already routes diarize/embed to the Mac with the selected model; extend to the new
  model ids + tier awareness.
- **OGAD (Mac gateway):** `/v1/audio/diarize` runs the selected Mac-tier model (Nemotron 3 / Sortformer);
  auto-download weights from HF; return turns + embeddings in our existing shape.

## Phased roadmap

- **Phase 0 — Eval harness + labeled set.** Metrics script + 3–5 labeled day recordings. (Unblocks all.)
- **Phase 1 — Catalog + Models-screen selection.** New diarization models in the shared catalog, HF pull,
  user selection UX. No behavior change yet; just selectable.
- **Phase 2 — Nemotron 3 on the Mac gateway.** Wire `/v1/audio/diarize` to run it; A/B DER vs current on
  the eval set. Expected the big accuracy win.
- **Phase 3 — Adaptive VAD front gate.** Silero v6 + noise-floor tracker + near-field gate; measure noise
  false-accepts drop.
- **Phase 4 — Relevance/FVAD v1 (heuristic).** Owner + near-field + turn-interleave gate; measure
  conversation precision/recall; tune. Journal/to-dos consume only relevant conversations.
- **Phase 5 — On-device upgrade + polish.** Best on-device export we can run under sherpa; battery/latency
  pass; (optional) FVAD v2 if the eval says v1 isn't enough.

## Risks / open questions

- On-device runnability of Nemotron 3 / Sortformer (ONNX/CoreML export?) — verify in Phase 1; if none,
  on-device stays current stack, Mac tier carries accuracy.
- Licensing of the HF weights for redistribution/commercial use — check before shipping downloads.
- Latency/battery of a 24/7 VAD+diar pipeline on-device — the VAD front gate is the main mitigation
  (expensive stages only run on armed, near-field speech).
- Relevance policy is a **product decision** (how aggressively to filter owner-listening cases) — needs
  Sidd/lead sign-off on the definition before Phase 4.

## Sources

- Nemotron 3 Diarization — https://huggingface.co/nvidia/Nemotron-3-Diarization
- Streaming Sortformer 4spk v2.1 — https://huggingface.co/nvidia/diar_streaming_sortformer_4spk-v2.1
- Foreground VAD (speaker selectivity) — https://arxiv.org/abs/2609.19856
- Foreground speech in wearable ambient audio — https://pmc.ncbi.nlm.nih.gov/articles/PMC7858549/
- Silero VAD — https://github.com/snakers4/silero-vad
