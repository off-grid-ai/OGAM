#!/usr/bin/env python3
"""
Export SpeechBrain's ECAPA-TDNN speaker encoder to an ExecuTorch .pte for on-device voiceprints.

Model:   speechbrain/spkrec-ecapa-voxceleb  (Apache-2.0, 6.2M params, 192-dim x-vector)
Output:  ecapa_speaker_192.pte  (XNNPACK-lowered), consumed by executorchSpeakerEmbedderFactory.ts

The exported graph takes a raw mono 16 kHz waveform [1, N] float and returns a [1, 192] embedding —
the mel front-end (Fbank) is wrapped INTO the graph so the phone side only hands over float samples.

Run offline in a Python env (not on device):
    pip install torch executorch speechbrain torchaudio
    python scripts/export_ecapa_executorch.py --out ecapa_speaker_192.pte
Then bundle/download the .pte and point createExecutorchSpeakerEmbedder() at it.
"""
import argparse
import torch
from speechbrain.inference.speaker import EncoderClassifier
from executorch.exir import to_edge, EdgeCompileConfig
from executorch.backends.xnnpack.partition.xnnpack_partitioner import XnnpackPartitioner


class EcapaWaveform(torch.nn.Module):
    """Wrap SpeechBrain's classifier so the graph is waveform-in, 192-d-embedding-out."""

    def __init__(self) -> None:
        super().__init__()
        self.model = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            run_opts={"device": "cpu"},
        )

    def forward(self, wav: torch.Tensor) -> torch.Tensor:
        # wav: [1, N] float32 in [-1, 1]; encode_batch returns [1, 1, 192].
        emb = self.model.encode_batch(wav)
        return emb.squeeze(1)  # -> [1, 192]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="ecapa_speaker_192.pte")
    ap.add_argument("--sample-len", type=int, default=48000)  # 3s @ 16kHz for the export trace
    args = ap.parse_args()

    model = EcapaWaveform().eval()
    example = (torch.randn(1, args.sample_len),)

    with torch.no_grad():
        exported = torch.export.export(model, example)
    edge = to_edge(
        exported,
        compile_config=EdgeCompileConfig(
            _core_aten_ops_exception_list=[torch.ops.aten.unfold.default],
        ),
    )
    edge = edge.to_backend(XnnpackPartitioner())
    program = edge.to_executorch()

    with open(args.out, "wb") as f:
        f.write(program.buffer)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
