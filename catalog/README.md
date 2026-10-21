# Model catalog

`models.json` lists models added after a release. The app fetches it when someone taps
"check for new models" on the Models screen, and keeps the last good copy.

- An entry adds a model, or replaces the bundled one with the same key.
- Nothing here removes a bundled model. Leave a section empty to change nothing.
- Keys: `text` and `transcription` by `id`, `coreml` by `repo` + `variant`, `litert` by `fileName`.
- Bump `updatedAt` on every edit. Keep `schemaVersion` at 1.
- An entry with a missing or wrong required field is skipped.

One example entry per section:

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-10-21",
  "sections": {
    "text": [
      {
        "id": "unsloth/Qwen3.5-2B-GGUF",
        "name": "Qwen 3.5 2B",
        "params": 2,
        "description": "Fast everyday chat",
        "minRam": 4,
        "type": "text",
        "org": "Qwen",
        "isNew": true
      }
    ],
    "transcription": [
      {
        "id": "large-v3-turbo",
        "name": "Large v3 Turbo",
        "size": 809,
        "lang": "multi",
        "url": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
        "description": "Fast + accurate, 99 languages"
      }
    ],
    "coreml": [
      {
        "repo": "apple/coreml-stable-diffusion-2-1-base-palettized",
        "name": "SD 2.1 Palettized (Low RAM)",
        "description": "6-bit quantized, 512×512, CPU/GPU",
        "variant": "original"
      }
    ],
    "litert": [
      {
        "fileName": "gemma-4-E2B-it.litertlm",
        "hfRepoId": "litert-community/gemma-4-E2B-it-litert-lm",
        "commitHash": "6e5c4f1e395deb959c494953478fa5cec4b8008f",
        "sizeBytes": 2588147712,
        "displayName": "Gemma 4 E2B",
        "highlight": "Up to 2x faster than CPU via GPU",
        "liteRTVision": true,
        "liteRTAudio": true,
        "maxContextTokens": 32000
      }
    ]
  }
}
```

Optional fields: `text` takes `maxRam`, `isNew`, `activeParams` (MoE active billions) and
`nonCommercial`; `coreml` takes `variant: "original"` (CPU/GPU; omit for the ANE build);
`litert` takes `maxContextTokens` and `confirmDownload: { "title", "message" }`.
`transcription.size` is in MB. Every URL must be `https://`.
