#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/.video-build/source"
REVISION="$(cat "$ROOT/scripts/video/revision")"
mkdir -p "$ROOT/.video-build"
if [ ! -d "$SOURCE/.git" ]; then
  git clone --filter=blob:none --no-checkout https://github.com/leejet/stable-diffusion.cpp.git "$SOURCE"
fi
git -C "$SOURCE" fetch origin "$REVISION"
git -C "$SOURCE" checkout --detach "$REVISION"
git -C "$SOURCE" submodule update --init --depth 1 ggml
# Use the initialized Vulkan dispatcher for Vulkan 1.1 features. Direct symbols
# are absent from Android API 24's loader even when the device supports them.
PATCH="$ROOT/scripts/video/android-vulkan-dispatch.patch"
if ! git -C "$SOURCE/ggml" apply --reverse --check "$PATCH" 2>/dev/null; then
  git -C "$SOURCE/ggml" apply "$PATCH"
fi
# This overlay extends the scheduler inserted by android-hardware-fallback.patch.
# Remove it before checking the base patch, then apply it again in order below.
# Do not reset the source tree: other platform patches must remain intact.
ROUTING_PATCH="$ROOT/scripts/video/android-attention-query-routing.patch"
if git -C "$SOURCE" apply --reverse --check "$ROUTING_PATCH" 2>/dev/null; then
  git -C "$SOURCE" apply --reverse "$ROUTING_PATCH"
fi
for entry in "ggml:android-vulkan-device-fault.patch" "ggml:android-vulkan-pipeline-diagnostics.patch" "ggml:android-vulkan-matvec-fallback.patch" "ggml:android-vulkan-attention-fallback.patch" "ggml:android-hexagon.patch" "ggml:android-hexagon-buffer-validation.patch" "ggml:android-hexagon-precision.patch" ".:android-hardware-fallback.patch" ".:conditioning-errors.patch" ".:android-attention-buffer-ownership.patch" ".:android-attention-query-chunks.patch" ".:android-attention-query-routing.patch" ".:video-decode-observer.patch" ".:android-video-numerics.patch"; do
  target="${entry%%:*}"
  patch="$ROOT/scripts/video/${entry#*:}"
  if ! git -C "$SOURCE/$target" apply --reverse --check "$patch" 2>/dev/null; then
    git -C "$SOURCE/$target" apply "$patch"
  fi
done
# Match the header versions used by the runtime's Vulkan build. These are build
# inputs only; the device still supplies its Vulkan driver.
prepare_headers() {
  local project="$1" revision="$2" directory="$ROOT/.video-build/$1-source"
  if [ ! -d "$directory/.git" ]; then git clone --filter=blob:none --no-checkout "https://github.com/KhronosGroup/$project.git" "$directory"; fi
  git -C "$directory" fetch origin "$revision"
  git -C "$directory" checkout --detach "$revision"
  cmake -S "$directory" -B "$directory/build" -DCMAKE_INSTALL_PREFIX="$ROOT/.video-build/vulkan-header-prefix"
  cmake --install "$directory/build"
}
prepare_headers SPIRV-Headers 01e0577914a75a2569c846778c2f93aa8e6feddd
prepare_headers Vulkan-Headers 19725e4d48082fe78e26622b15d3080ccd54112b

if [ "${1:-}" = "--android" ]; then
  bash "$ROOT/scripts/video/build-shaderc.sh"
  bash "$ROOT/scripts/video/build-hexagon.sh"
fi

touch "$ROOT/.video-build/runtime-ready"
