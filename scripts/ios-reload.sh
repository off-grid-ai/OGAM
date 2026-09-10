#!/usr/bin/env sh
# Reload the already-installed Debug app through its existing Metro session.
# Native code, signing, Pods, and Shared package output do not change on this path.
set -eu

METRO_STATUS_URL="${METRO_STATUS_URL:-http://127.0.0.1:8081/status}"
METRO_RELOAD_URL="${METRO_RELOAD_URL:-http://127.0.0.1:8081/reload}"

if [ "$(curl -fsS --max-time 2 "$METRO_STATUS_URL" 2>/dev/null || true)" != "packager-status:running" ]; then
  echo "Metro is not running. Start it with npm start, then run this command again." >&2
  exit 1
fi

curl -fsS --max-time 10 -X POST "$METRO_RELOAD_URL" >/dev/null
echo "Reload requested. No native rebuild was run."
