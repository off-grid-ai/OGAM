#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REVISION=d393a813c9b67c709d37b329203d72beb69d719e
SOURCE="$ROOT/.video-build/shaderc-source"
PREFIX="$ROOT/.video-build/shaderc"
if [ -x "$PREFIX/bin/glslc" ] && [ "$(cat "$PREFIX/revision" 2>/dev/null || true)" = "$REVISION" ]; then exit 0; fi
# A host package of this exact release is also suitable for shader compilation.
if command -v glslc >/dev/null && [[ "$(glslc --version)" == "shaderc v2026.4 "* ]]; then
  mkdir -p "$PREFIX/bin"
  ln -sf "$(command -v glslc)" "$PREFIX/bin/glslc"
  printf '%s\n' "$REVISION" > "$PREFIX/revision"
  exit 0
fi
mkdir -p "$ROOT/.video-build"
if [ ! -d "$SOURCE/.git" ]; then
  git clone --filter=blob:none --no-checkout https://github.com/google/shaderc.git "$SOURCE"
fi
git -C "$SOURCE" fetch origin "$REVISION"
git -C "$SOURCE" checkout --detach "$REVISION"
(cd "$SOURCE" && python3 utils/git-sync-deps)
cmake -S "$SOURCE" -B "$SOURCE/build-host" -G "Unix Makefiles" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DSHADERC_SKIP_TESTS=ON -DSHADERC_SKIP_EXAMPLES=ON -DSHADERC_SKIP_COPYRIGHT_CHECK=ON
cmake --build "$SOURCE/build-host" --target glslc --parallel "${VIDEO_BUILD_JOBS:-4}"
mkdir -p "$PREFIX/bin"
cp "$SOURCE/build-host/glslc/glslc" "$PREFIX/bin/glslc"
printf '%s\n' "$REVISION" > "$PREFIX/revision"
