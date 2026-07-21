#!/bin/bash
# Off Grid Mobile — one-command release gate.
#
# Composes every MECHANICAL gate into a single PASS/FAIL verdict. A green run here
# means the logic layer is shippable; it does NOT replace the irreducible on-device
# smoke (real RAM ceiling / thermal / ANE / native load). See docs/RELEASE_TONIGHT_CHECKOFF.md.
#
# Mirrors .github/workflows/ci.yml so local == CI, and adds the two things CI's per-job
# split hides: a single verdict, and the Android RELEASE build gate (typecheck + tests do
# NOT catch build/route errors — CLAUDE.md).
#
# Usage:
#   ./scripts/release-gate.sh                 # full gate (default)
#   ./scripts/release-gate.sh --fast          # skip the Android release build (JS gates only)
#   ./scripts/release-gate.sh --base <ref>    # diff-coverage base (default: origin/main)
set -uo pipefail
cd "$(dirname "$0")/.."

BASE_REF="origin/main"
RUN_BUILD=1
for arg in "$@"; do
  case "$arg" in
    --fast) RUN_BUILD=0 ;;
    --base) shift; BASE_REF="${1:-origin/main}" ;;
  esac
  shift 2>/dev/null || true
done

declare -a NAMES RESULTS
run() { # run <name> <command...> — a HARD gate: a failure makes the verdict RED
  local name="$1"; shift
  printf '\n\033[1m▶ %s\033[0m\n' "$name"
  if "$@"; then NAMES+=("$name"); RESULTS+=("PASS"); else NAMES+=("$name"); RESULTS+=("FAIL"); fi
}
run_advisory() { # run_advisory <name> <command...> — reported but NEVER fails the verdict
  local name="$1"; shift
  printf '\n\033[1m▶ %s (advisory)\033[0m\n' "$name"
  if "$@"; then NAMES+=("$name"); RESULTS+=("ADVISORY-PASS"); else NAMES+=("$name"); RESULTS+=("ADVISORY-WARN"); fi
}

run "typecheck"        npx tsc --noEmit
run "lint (js)"        npx eslint .
run "no-pro-mocks"     npm run --silent check:no-pro-mocks
run "arch (depcruise)" npm run --silent depcruise
run "dead-code (knip)" npm run --silent knip
# --maxWorkers=1 + --workerIdleMemoryLimit (NOT --runInBand): serial execution, but the worker is
# recycled before it accumulates the whole suite's leaked memory — fixes late-test timeout flakiness.
run "jest + coverage"  npx jest --coverage --coverageReporters=json --coverageReporters=text-summary --maxWorkers=1 --workerIdleMemoryLimit=1536MB --forceExit
# Advisory: 100%-on-changed-lines is a PER-PR forward gate. Against a long-lived release branch the
# "changed lines" are the entire branch vs main, so it reports accumulated debt, not a regression —
# useful signal, not a release blocker. Wire it as a HARD gate in per-PR CI where the diff is small.
run_advisory "diff-coverage" node scripts/diff-coverage.mjs --base "$BASE_REF"
if [ "$RUN_BUILD" -eq 1 ]; then
  run "android release build" bash -c "cd android && ./gradlew assembleRelease"
fi

# ── Verdict ──
printf '\n\033[1m══════════════ RELEASE GATE ══════════════\033[0m\n'
fail=0
for i in "${!NAMES[@]}"; do
  case "${RESULTS[$i]}" in
    PASS)          printf '  \033[32m✓ PASS\033[0m      %s\n' "${NAMES[$i]}" ;;
    ADVISORY-PASS) printf '  \033[32m✓ ADVISORY\033[0m  %s\n' "${NAMES[$i]}" ;;
    ADVISORY-WARN) printf '  \033[33m⚠ ADVISORY\033[0m  %s (informational — does not block)\n' "${NAMES[$i]}" ;;
    *)             printf '  \033[31m✗ FAIL\033[0m      %s\n' "${NAMES[$i]}"; fail=1 ;;
  esac
done
printf '\033[1m══════════════════════════════════════════\033[0m\n'
if [ "$fail" -eq 0 ]; then
  printf '\033[32m\033[1mGATE GREEN — logic layer shippable.\033[0m Now run the irreducible on-device smoke (docs/RELEASE_TONIGHT_CHECKOFF.md) before release.\n'
  exit 0
else
  printf '\033[31m\033[1mGATE RED — do not release.\033[0m Fix the FAIL rows above.\n'
  exit 1
fi
