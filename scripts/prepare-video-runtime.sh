#!/bin/bash
set -euo pipefail
# Gradle shows only the exit code, so name the command that failed.
trap 'echo "prepare-video-runtime.sh: line $LINENO failed: $BASH_COMMAND" >&2' ERR
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# The engine-update job checks a newer release here before it bumps the pin (--patches-only).
# That check resets the tree for each platform, so it never runs on the build's own checkout.
if [ "${1:-}" = "--patches-only" ] && [ -z "${OFFGRID_SD_SOURCE:-}" ]; then
  echo "--patches-only resets its checkout: set OFFGRID_SD_SOURCE to a scratch directory" >&2
  exit 2
fi
SOURCE="${OFFGRID_SD_SOURCE:-$ROOT/.video-build/source}"
REVISION="${OFFGRID_SD_REVISION:-$(cat "$ROOT/scripts/video/revision")}"
mkdir -p "$(dirname "$SOURCE")"
if [ ! -d "$SOURCE/.git" ]; then
  git clone --filter=blob:none --no-checkout https://github.com/leejet/stable-diffusion.cpp.git "$SOURCE"
fi
git -C "$SOURCE" fetch origin "$REVISION"
git -C "$SOURCE" checkout --detach "$REVISION"
git -C "$SOURCE" submodule update --init --depth 1 ggml
if [ "${1:-}" = "--patches-only" ]; then
  # Every platform's patches, each on a clean tree of the revision, as each build applies them.
  for platform in android ios; do
    git -C "$SOURCE" checkout --force --detach "$REVISION"
    git -C "$SOURCE" clean -fdq
    git -C "$SOURCE" submodule update --init --force --depth 1 ggml
    git -C "$SOURCE/ggml" clean -fdq
    bash "$ROOT/scripts/video/apply-patches.sh" "$platform" "$SOURCE"
  done
  exit 0
fi
# Use the initialized Vulkan dispatcher for Vulkan 1.1 features (android-vulkan-dispatch.patch).
# Direct symbols are absent from Android API 24's loader even when the device supports them.
#
# android-attention-query-routing.patch extends the scheduler inserted by
# android-hardware-fallback.patch. Remove it before checking the base patch; the list applies it
# again after it. Do not reset the source tree: other platform patches must remain intact.
ROUTING_PATCH="$ROOT/scripts/video/android-attention-query-routing.patch"
if git -C "$SOURCE" apply --reverse --check "$ROUTING_PATCH" 2>/dev/null; then
  git -C "$SOURCE" apply --reverse "$ROUTING_PATCH"
fi
bash "$ROOT/scripts/video/apply-patches.sh" android "$SOURCE"
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
