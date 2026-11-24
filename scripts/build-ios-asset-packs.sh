#!/usr/bin/env bash
# Packages the bundled chat model (LFM3-VL-2B) as Apple-hosted asset packs: build/asset-packs/<id>.aar.
#
# Each file comes from its catalog row (catalog/models.json: pinned URL and sha256), the same row the
# Android AI packs and src/services/bundledModel use. The model's licence goes in each pack.
# Manifests: ios/AssetPacks/<id>.json ("prefetch" on first install, iOS only).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=build/asset-packs
mkdir -p "$OUT"
cp third_party/LFM-Open-License-v1.0.txt "$OUT/LICENSE-LFM-Open-License-v1.0.txt"

python3 -I - "$OUT" <<'PY'
import hashlib, json, os, sys, urllib.request
out = sys.argv[1]
catalog = json.load(open('catalog/models.json'))
entry = next(m for m in catalog['sections']['models'] if m['id'] == 'LiquidAI/LFM3-VL-2B-GGUF')
for f in entry['files']:
    path = os.path.join(out, f['name'])
    if not (os.path.exists(path) and os.path.getsize(path) == f['sizeBytes']):
        print(f"downloading {f['name']} ({f['sizeBytes']} bytes)", flush=True)
        urllib.request.urlretrieve(f['url'], path + '.part')
        os.replace(path + '.part', path)
    digest = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            digest.update(chunk)
    if digest.hexdigest() != f['sha256']:
        os.remove(path)
        sys.exit(f"{f['name']}: sha256 {digest.hexdigest()} != catalog {f['sha256']}")
    print(f"{f['name']}: sha256 ok", flush=True)
PY

for manifest in ios/AssetPacks/*.json; do
  id=$(basename "$manifest" .json)
  # ba-package resolves file selectors against the working directory.
  (cd "$OUT" && xcrun ba-package "../../$manifest" -o "$id.aar")
  echo "packaged $OUT/$id.aar"
done
