#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REVISION="$(cat "$ROOT/scripts/video/revision")"
CACHE="${OFFGRID_VIDEO_BUILD_DIR:-$ROOT/.video-build}"
SOURCE="${OFFGRID_SD_SOURCE:-$CACHE/source}"
OUTPUT="$ROOT/native/video/OffgridVideoRuntime.xcframework"
# The build key covers every iOS patch in scripts/video/patches.txt, so a new one rebuilds the framework.
IOS_PATCHES=()
while IFS= read -r patch; do IOS_PATCHES+=("$patch"); done < <(bash "$ROOT/scripts/video/apply-patches.sh" --list ios)
BUILD_KEY="${OFFGRID_IOS_DEVICE_ONLY:-0}-$(cat "$ROOT/scripts/video/revision" "$ROOT/scripts/video/exports.txt" "$ROOT/scripts/video/CMakeLists.txt" "$ROOT/scripts/video/patches.txt" "${IOS_PATCHES[@]}" | shasum -a 256 | cut -d' ' -f1)"
if [ -f "$OUTPUT/ios-arm64/OffgridVideoRuntime.framework/Headers/stable-diffusion.h" ] && [ -f "$OUTPUT/revision" ] && [ "$(cat "$OUTPUT/revision")" = "$BUILD_KEY" ]; then exit 0; fi
mkdir -p "$CACHE"
if [ ! -d "$SOURCE/.git" ]; then
  git clone --filter=blob:none --no-checkout https://github.com/leejet/stable-diffusion.cpp.git "$SOURCE"
fi
# A --no-checkout clone already has HEAD at upstream's tip, with nothing checked out; when the pin
# is that tip, only an explicit checkout fills the tree (and the ggml submodule entry).
if ! git -C "$SOURCE" cat-file -e "$REVISION^{commit}" 2>/dev/null; then
  git -C "$SOURCE" fetch origin "$REVISION"
fi
git -C "$SOURCE" checkout --detach "$REVISION"
git -C "$SOURCE" submodule update --init --depth 1 ggml
# The iOS patches in scripts/video/patches.txt, among them ggml's Metal GroupNorm fix: it normalized
# only the first image of a batch, so CFG's second UNet pass came back unwritten and every picture
# rendered blank.
bash "$ROOT/scripts/video/apply-patches.sh" ios "$SOURCE"
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
