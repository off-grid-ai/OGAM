#!/usr/bin/env bash
# On-device e2e (Android, adb): download a vision GGUF, load it, and PROVE multimodal initialised.
#
# This is a REAL device test — no Provit journey engine, just adb driving + the app's own debug log.
# It codifies the flow we hand-drove during the A1 (mmproj) verification so it is repeatable.
#
# Assertion (the mmproj-fix proof): after the model loads, offgrid-debug.log must contain
#   [WIRE-VISION] {... "initialized":true, "support":{"vision":true ...}}
# and MUST NOT contain "Multimodal support not enabled". The load-time init is the exact thing the
# fix restores; attaching an image is a bonus, not required to prove the fix.
#
# ⚠️ NAVIGATION RELIABILITY: the taps below are COORDINATE-based (calibrated for 1080x2378). The RN app
# does NOT expose its tab-bar/search/testIDs to `uiautomator`, so text/element-based taps aren't available
# on Android, and blind coordinate sequences DRIFT (a tap can hit a promo link → Chrome, or a permission
# dialog). Treat this script as a RECORDED reference: run it with a human watching (or screenshot-verify
# each step). The ASSERTIONS are hardened (they check the model's own GGUF on disk + a fresh model-named
# [WIRE-VISION] initialized:true), so it can never false-pass even if navigation drifts — it will FAIL
# loudly instead. iOS (WDA) exposes accessibility ids (home-tab/models-tab/…) and is more reliable there.
#
# Prereqs (see rules.md → On-device testing playbook):
#   - Debuggable Debug build installed (run-as works → log file readable).
#   - Metro running on the branch + `adb reverse tcp:8081 tcp:8081` (Android Debug loads JS from Metro).
#   - Device unlocked, Auto-Lock long. Coords below are calibrated for 1080x2378 (OnePlus CPH2707).
#
# Usage:  MODEL_QUERY="Qwen3.5-0.8B" bash visionModelOnDevice.android.e2e.sh
set -uo pipefail
export PATH="$PATH:$HOME/Library/Android/sdk/platform-tools"
PKG=ai.offgridmobile.dev
QUERY="${MODEL_QUERY:?set MODEL_QUERY, e.g. Qwen3.5-0.8B or gemma-4-E2B}"
LOG() { adb exec-out run-as "$PKG" cat files/offgrid-debug.log 2>/dev/null; }
TAP() { adb shell input tap "$1" "$2"; sleep "${3:-2}"; }
SHOT() { adb exec-out screencap -p > /tmp/e2e-android.png 2>/dev/null; }

echo "== reset app to Home =="
adb shell input keyevent 3; sleep 1
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 4
# skip onboarding if present (optional taps)
TAP 949 215 2   # Skip (intro) — no-op if absent
TAP 538 2299 2  # Skip for Now — no-op if absent

echo "== Models tab -> search '$QUERY' =="
TAP 757 2245 2  # Models tab (bottom nav, 4th)
TAP 402 740 1   # search field
adb shell input text "$QUERY"; sleep 4
TAP 538 1000 1  # dismiss keyboard (first tap on result)
TAP 538 1000 3  # open top result detail

echo "== download the smallest (topmost) file =="
SHOT
TAP 949 975 4   # download icon on the first (smallest) file row
TAP 538 2217 2  # dismiss any memory-warning "Download Anyway"/OK — no-op if absent

echo "== wait for download to finalize — assert the model's OWN GGUF lands on disk (not a log grep) =="
STEM=$(echo "$QUERY" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')  # e.g. qwen3508b
DL_OK=0
for i in $(seq 1 90); do
  ON_DISK=$(adb exec-out run-as "$PKG" sh -c 'ls files/models 2>/dev/null')
  # a matching WEIGHTS file (not the mmproj) whose name reduces to our query stem
  if echo "$ON_DISK" | grep -vi mmproj | tr -d '[:upper:] .-_' | grep -qi "$STEM"; then
    echo "download complete — files: $(echo "$ON_DISK" | tr '\n' ' ')"; DL_OK=1; break
  fi
  echo "  [$i] downloading… (on disk: $(echo "$ON_DISK" | tr '\n' ' '))"; sleep 20
done
[ "$DL_OK" = 1 ] || { echo "FAIL: $QUERY never landed on disk — navigation/download did not start"; exit 1; }

echo "== load the model (Home -> Select Model -> first local -> New Chat -> send text) =="
adb shell input keyevent 3; sleep 1
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; sleep 3
TAP 750 878 2   # Select Model (Home card)
TAP 538 1374 8  # first local model (the one just downloaded, top of LOCAL MODELS)
TAP 538 743 3   # New Chat
TAP 400 2266 1  # message input
adb shell input text "hello"; sleep 1
TAP 978 1451 20 # send (keyboard-up position) -> triggers load + [WIRE-VISION]

echo "== ASSERT: a FRESH [WIRE-VISION] for THIS model, initialised, no error =="
# Un-fakeable: the WIRE-VISION line must (a) name THIS model's on-disk file, (b) be initialized:true,
# (c) vision:true — a stale line for a different model (e.g. SmolVLM) can never satisfy this.
DUMP=$(LOG)
VISION=$(echo "$DUMP" | grep -aE "WIRE-VISION" | grep -i "$STEM" | tail -1)
echo "  $VISION"
if [ -n "$VISION" ] && echo "$VISION" | grep -q '"initialized":true' && echo "$VISION" | grep -q '"vision":true'; then
  echo "PASS: $QUERY vision initialised on Android"; exit 0
else
  echo "FAIL: no fresh initialised [WIRE-VISION] for $QUERY (model may not have loaded / wrong model loaded)"; exit 1
fi
