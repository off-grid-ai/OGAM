#!/usr/bin/env bash
#
# Fetch the on-device sherpa-onnx Android blobs (not committed — same policy as the iOS xcframework):
#   - the sherpa-onnx 1.13.8 AAR (Kotlin API + JNI .so for arm64/armv7/x86/x86_64)  -> android/app/libs/
#   - the bundled models (pyannote segmentation 3.0 + CAM++ voiceprint)             -> android/app/src/main/assets/sherpa/
#
# Same version + models as iOS and the Mac path, so every voiceprint lives in one vector space.
# Run once after cloning (and in CI before an Android build). Idempotent.
set -euo pipefail

VERSION="1.13.8"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIBS="$ROOT/android/app/libs"
ASSETS="$ROOT/android/app/src/main/assets/sherpa"

AAR_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/v${VERSION}/sherpa-onnx-${VERSION}.aar"
SEG_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
EMB_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"

mkdir -p "$LIBS" "$ASSETS"

echo "→ AAR"
if [ -s "$LIBS/sherpa-onnx-${VERSION}.aar" ]; then
  echo "  already present"
else
  curl -fL --retry 3 -o "$LIBS/sherpa-onnx-${VERSION}.aar" "$AAR_URL"
fi

echo "→ segmentation model"
if [ -s "$ASSETS/segmentation.onnx" ]; then
  echo "  already present"
else
  TMP="$(mktemp -d)"
  curl -fL --retry 3 -o "$TMP/seg.tar.bz2" "$SEG_URL"
  tar xjf "$TMP/seg.tar.bz2" -C "$TMP"
  cp "$(find "$TMP" -name model.onnx | head -1)" "$ASSETS/segmentation.onnx"
  rm -rf "$TMP"
fi

echo "→ embedding model (CAM++)"
if [ -s "$ASSETS/embedding.onnx" ]; then
  echo "  already present"
else
  curl -fL --retry 3 -o "$ASSETS/embedding.onnx" "$EMB_URL"
fi

echo "✓ sherpa-onnx Android blobs ready:"
echo "    $LIBS/sherpa-onnx-${VERSION}.aar"
echo "    $ASSETS/segmentation.onnx"
echo "    $ASSETS/embedding.onnx"
