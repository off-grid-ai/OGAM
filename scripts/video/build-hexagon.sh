#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD="$ROOT/.video-build"
SDK_VERSION=6.4.0.2
SDK_SHA256=b4a57a774795cf12da19a777a5d306e970905bf9758a4c4765e5e4593428ae0b
SDK="$BUILD/hexagon-sdk/$SDK_VERSION"
# Reuse the DSP artifacts when their source revision and SDK match.
REVISION="$(cat "$ROOT/scripts/video/revision")"
READY="$BUILD/hexagon-runtime/ready"
COMPLETE=true
for file in htp_iface_stub.c htp_iface.h; do
  [ -s "$BUILD/hexagon-runtime/$file" ] || COMPLETE=false
done
for arch in v73 v75 v79 v81; do
  [ -s "$BUILD/hexagon-assets/video-hexagon/liboffgrid-video-htp-$arch.so" ] || COMPLETE=false
done
if $COMPLETE && [ "$(cat "$READY" 2>/dev/null || true)" = "$REVISION:$SDK_VERSION" ]; then exit 0; fi
mkdir -p "$BUILD/hexagon-sdk" "$BUILD/hexagon-runtime" "$BUILD/hexagon-assets/video-hexagon"
if [ ! -f "$SDK/hexagon_sdk.json" ]; then
  curl -fL --retry 3 -C - "https://github.com/snapdragon-toolchain/hexagon-sdk/releases/download/v$SDK_VERSION/hexagon-sdk-v$SDK_VERSION-amd64-lnx.tar.xz" -o "$BUILD/hexagon-sdk.tar.xz"
  printf '%s  %s\n' "$SDK_SHA256" "$BUILD/hexagon-sdk.tar.xz" | shasum -a 256 -c -
  tar -xJf "$BUILD/hexagon-sdk.tar.xz" -C "$BUILD/hexagon-sdk"
fi
# The official Hexagon tools run on Linux. Only this build directory is mounted.
docker run --rm --platform linux/amd64 -v "$BUILD:/work" -w /work ubuntu:22.04 bash -euc '
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ninja-build python3 python3-pip build-essential libncurses5 libtinfo5
  python3 -m pip install --no-cache-dir cmake==3.31.6
  export HEXAGON_SDK_ROOT=/work/hexagon-sdk/6.4.0.2
  export HEXAGON_TOOLS_ROOT=$HEXAGON_SDK_ROOT/tools/HEXAGON_Tools/19.0.04
  export DEFAULT_HLOS_ARCH=64 DEFAULT_TOOLS_VARIANT=toolv19 DEFAULT_NO_QURT_INC=0
  for arch in v73 v75 v79 v81; do
    cmake -S source/ggml/src/ggml-hexagon/htp -B hexagon-build/$arch -G Ninja \
      -DCMAKE_TOOLCHAIN_FILE=/work/source/ggml/src/ggml-hexagon/htp/cmake-toolchain.cmake \
      -DCMAKE_BUILD_TYPE=Release -DHEXAGON_SDK_ROOT=$HEXAGON_SDK_ROOT \
      -DHEXAGON_TOOLS_ROOT=$HEXAGON_TOOLS_ROOT -DDSP_VERSION=$arch \
      -DPREBUILT_LIB_DIR=toolv19_$arch -DHEXAGON_HTP_DEBUG=OFF
    cmake --build hexagon-build/$arch --parallel 2
    cp hexagon-build/$arch/libggml-htp-$arch.so hexagon-assets/video-hexagon/liboffgrid-video-htp-$arch.so
  done
  cp hexagon-build/v73/htp_iface_stub.c hexagon-build/v73/htp_iface.h hexagon-runtime/
'
cp "$ROOT/scripts/video/revision" "$BUILD/hexagon-runtime/revision"
printf '%s:%s\n' "$REVISION" "$SDK_VERSION" > "$READY"
