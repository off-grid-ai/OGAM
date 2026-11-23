import json, torch, timm
from huggingface_hub import hf_hub_download
from executorch.backends.xnnpack.partition.xnnpack_partitioner import XnnpackPartitioner
from executorch.exir import to_edge_transform_and_lower

repo = "Marqo/nsfw-image-detection-384"
model = timm.create_model(f"hf_hub:{repo}", pretrained=True).eval()
cfg = timm.data.resolve_model_data_config(model)
print("cfg", cfg)
print("labels", model.pretrained_cfg.get("label_names"))
size = cfg["input_size"][1:]
ex = (torch.rand(1, 3, *size),)
ep = torch.export.export(model, ex)
prog = to_edge_transform_and_lower(ep, partitioner=[XnnpackPartitioner()]).to_executorch()
open("nsfw_384_xnnpack_fp32.pte", "wb").write(prog.buffer)
json.dump({"repo": repo, "cfg": {k: list(v) if isinstance(v, tuple) else v for k, v in cfg.items()}, "labels": model.pretrained_cfg.get("label_names")}, open("meta.json", "w"), indent=1)
