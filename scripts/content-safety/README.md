# On-device image safety classifier

`nsfw_384_xnnpack_fp32.pte` (in `android/app/src/main/assets/models/` and `ios/`) is
[Marqo/nsfw-image-detection-384](https://huggingface.co/Marqo/nsfw-image-detection-384)
(Apache-2.0, timm ViT-tiny, 384×384 input, mean/std 0.5, labels `NSFW`, `SFW`) exported to an
executorch XNNPACK program. `src/services/contentSafety/imageSafety.ts` runs it on every generated
image before the image is shown or saved.

Rebuild:

```bash
uv venv -p 3.12 .venv && . .venv/bin/activate
uv pip install "executorch==1.0.0" timm pillow huggingface_hub
python scripts/content-safety/export_nsfw_classifier.py
```

The exported program matched the PyTorch model to within 1e-6 on the logits.
