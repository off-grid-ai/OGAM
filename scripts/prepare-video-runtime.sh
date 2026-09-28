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
fi
