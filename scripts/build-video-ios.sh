#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REVISION="$(cat "$ROOT/scripts/video/revision")"
CACHE="${OFFGRID_VIDEO_BUILD_DIR:-$ROOT/.video-build}"
SOURCE="${OFFGRID_SD_SOURCE:-$CACHE/source}"
OUTPUT="$ROOT/native/video/OffgridVideoRuntime.xcframework"
BUILD_KEY="${OFFGRID_IOS_DEVICE_ONLY:-0}-$(cat "$ROOT/scripts/video/revision" "$ROOT/scripts/video/exports.txt" "$ROOT/scripts/video/CMakeLists.txt" "$ROOT/scripts/video/conditioning-errors.patch" "$ROOT/scripts/video/video-decode-observer.patch" | shasum -a 256 | cut -d' ' -f1)"
if [ -f "$OUTPUT/ios-arm64/OffgridVideoRuntime.framework/Headers/stable-diffusion.h" ] && [ -f "$OUTPUT/revision" ] && [ "$(cat "$OUTPUT/revision")" = "$BUILD_KEY" ]; then exit 0; fi
mkdir -p "$CACHE"
if [ ! -d "$SOURCE/.git" ]; then
  git clone --filter=blob:none --no-checkout https://github.com/leejet/stable-diffusion.cpp.git "$SOURCE"
fi
if [ "$(git -C "$SOURCE" rev-parse HEAD)" != "$REVISION" ]; then
  git -C "$SOURCE" fetch origin "$REVISION"
  git -C "$SOURCE" checkout --detach "$REVISION"
fi
git -C "$SOURCE" submodule update --init --depth 1 ggml
for PATCH in "$ROOT/scripts/video/conditioning-errors.patch" "$ROOT/scripts/video/video-decode-observer.patch"; do
  if ! git -C "$SOURCE" apply --reverse --check "$PATCH" 2>/dev/null; then
    git -C "$SOURCE" apply "$PATCH"
  fi
done
SDKS=(iphoneos)
if [ "${OFFGRID_IOS_DEVICE_ONLY:-0}" != "1" ]; then SDKS+=(iphonesimulator); fi
for SDK in "${SDKS[@]}"; do
  cmake -S "$ROOT/scripts/video" -B "$CACHE/$SDK" -G Xcode \
    -DSD_SOURCE="$SOURCE" -DCMAKE_SYSTEM_NAME=iOS -DCMAKE_OSX_SYSROOT="$SDK" \
    -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET=17.0
  cmake --build "$CACHE/$SDK" --config Release --target stable-diffusion -- -quiet CODE_SIGNING_ALLOWED=NO
 done
# Replace only this generated build artifact.
rm -rf "$OUTPUT"
FRAMEWORKS=()
for SDK in "${SDKS[@]}"; do FRAMEWORKS+=(-framework "$CACHE/$SDK/bin/Release/OffgridVideoRuntime.framework"); done
xcodebuild -create-xcframework "${FRAMEWORKS[@]}" -output "$OUTPUT"
printf '%s\n' "$BUILD_KEY" > "$OUTPUT/revision"
cp "$SOURCE/LICENSE" "$ROOT/native/video/RUNTIME-LICENSE"
