#!/usr/bin/env bash

set -eu

# Source .env if present (for local dev — CI sets SONAR_TOKEN directly)
if [[ -f ".env" ]]; then
  # shellcheck disable=SC1091
  . ./.env
fi

if [[ -z "${SONAR_TOKEN:-}" ]]; then
  echo "SONAR_TOKEN is not set. Skipping Sonar scan."
  exit 0
fi

run_sonar() {
  if [[ -x "./node_modules/.bin/sonar-scanner" ]]; then
    ./node_modules/.bin/sonar-scanner "$@"
  elif command -v sonar-scanner >/dev/null 2>&1; then
    sonar-scanner "$@"
  else
    echo "sonar-scanner is not installed. Skipping Sonar scan."
    echo "Install it with: npm install --save-dev sonar-scanner"
    return 0
  fi
}

if ! output=$(run_sonar "$@" 2>&1); then
  # The authoritative Sonar analysis for this project is SERVER-SIDE (SonarCloud Automatic
  # Analysis), so a local/manual scan is best-effort and must NEVER block a push. Skip (not
  # fail) on the known can't-run-locally cases: automatic-analysis is on, OR the token is
  # read-only / the project isn't manually scannable with it ("Not authorized or project not
  # found" — what a local scan gets when Automatic Analysis owns the project). Any OTHER
  # scanner error still hard-fails.
  if echo "$output" | grep -qE "running manual analysis while Automatic Analysis is enabled|Not authorized or project not found"; then
    echo "Skipping local Sonar scan — analysis runs server-side (SonarCloud Automatic Analysis) on push."
    exit 0
  fi
  echo "$output" >&2
  exit 1
fi
echo "$output"
