#!/bin/bash
# Pure C++ tests of the video runtime's helpers (no ggml, no device): native/video/common/tests.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
for test in "$ROOT"/native/video/common/tests/*Test.cpp; do
  c++ -std=c++17 -Wall -Werror -o "$OUT/test" "$test"
  "$OUT/test"
done
