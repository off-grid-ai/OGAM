#!/bin/bash
# Route Xcode's C, C++ and Objective-C compiles through ccache, for CI.
#
# Usage: scripts/xcode-ccache.sh <directory>
# Writes clang and clang++ wrappers and <directory>/ccache.xcconfig. Export
# XCODE_XCCONFIG_FILE=<directory>/ccache.xcconfig for the xcodebuild step: it overrides CC and CXX
# for every target, so the tracked Xcode project stays as committed.
#
# React Native's own wrapper (node_modules/react-native/scripts/xcode/ccache-clang.sh) runs
# `$CCACHE_BINARY clang`, but Xcode does not pass that build setting into the compiler's
# environment, so it ran plain clang and cached nothing. These wrappers hold the ccache path, the
# cache directory and React Native's ccache settings themselves.
set -euo pipefail
OUT="${1:?usage: xcode-ccache.sh <directory>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CCACHE="$(command -v ccache)" || { echo "xcode-ccache.sh: ccache is not installed" >&2; exit 1; }
CACHE_DIR="${CCACHE_DIR:?xcode-ccache.sh: set CCACHE_DIR to the directory the cache step saves}"
CONFIG="$ROOT/node_modules/react-native/scripts/xcode/ccache.conf"
[ -f "$CONFIG" ] || { echo "xcode-ccache.sh: $CONFIG not found (run npm ci first)" >&2; exit 1; }
mkdir -p "$OUT"
for compiler in clang clang++; do
  cat > "$OUT/ccache-$compiler" <<WRAPPER
#!/bin/sh
export CCACHE_DIR="$CACHE_DIR"
export CCACHE_CONFIGPATH="$CONFIG"
exec "$CCACHE" $compiler "\$@"
WRAPPER
  chmod +x "$OUT/ccache-$compiler"
done
printf 'CC = %s\nCXX = %s\n' "$OUT/ccache-clang" "$OUT/ccache-clang++" > "$OUT/ccache.xcconfig"
cat "$OUT/ccache.xcconfig"
