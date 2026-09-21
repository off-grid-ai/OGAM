# Producing the speaker-embedding `.pte` models

Voice fingerprinting runs the embedding model **on-device via `react-native-executorch`**, which
downloads a `.pte` from the catalog URL on first use and caches it — exactly like the whisper models.
There is **no Python at runtime and none for users**. The only one-time step is building the `.pte`
artifact (once, by us) and hosting it, because — unlike whisper's ready-made ggml files — no
pre-exported `.pte` speaker model exists to point at.

## What the app expects

- Catalog: `shared/packages/models/src/catalog/speaker-embedding.ts` → each model's `url` is a HuggingFace
  resolve URL (repo `off-grid-ai/speaker-embedding`), exactly like whisper (`ggerganov/whisper.cpp`) and
  Kokoro TTS (`software-mansion/executorch-kokoro`). No bespoke host needed.
- The graph must be **waveform-in → embedding-out**: input `[1, N]` float32 mono 16 kHz, output
  `[1, dim]` (the mel/fbank front-end is baked in, so the phone hands over raw samples). `dim` must
  match the catalog entry (ECAPA = 192).

## Build the default model (ECAPA-TDNN-512, id `ecapa-tdnn-512`)

```bash
# any machine with Python 3.10+ (one-time; NOT on device, NOT per user)
pip install torch executorch speechbrain torchaudio
python scripts/export_ecapa_executorch.py --out ecapa-tdnn-512.pte
```

This wraps SpeechBrain's `spkrec-ecapa-voxceleb` so the fbank front-end is inside the graph, runs
`torch.export`, lowers to XNNPACK, and writes `ecapa-tdnn-512.pte` (~24 MB).

## Host it on HuggingFace (same as every other model)

1. Create the HF model repo `off-grid-ai/speaker-embedding` (once).
2. Upload `ecapa-tdnn-512.pte` to it (`huggingface-cli upload off-grid-ai/speaker-embedding ecapa-tdnn-512.pte`).
3. That's it — the catalog already points at `https://huggingface.co/off-grid-ai/speaker-embedding/resolve/main/<id>.pte`.
   On first enroll/identify the app downloads + caches it via ExecuTorch's ResourceFetcher (just like it
   pulls the Kokoro `.pte` and the whisper `ggml` files) and runs it on-device. Nothing else to wire.

## The other catalog entries

`ecapa-tdnn-256`, `campplus`, `eres2net-base` are swappable options in the catalog but come from the
3D-Speaker / modelscope zoo, so each needs its own export (same waveform-in → `[1, dim]` contract;
CAM++ is 512-dim). Until their `.pte` is hosted, leave them out of the picker or mark them unavailable
— `ecapa-tdnn-512` is the working default.
