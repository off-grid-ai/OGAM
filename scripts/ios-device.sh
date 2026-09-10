#!/usr/bin/env bash
# Build, install and launch the app on a physical iOS device.
#
# We default to AUTOMATIC signing with -allowProvisioningUpdates so Xcode
# registers whatever device is currently connected and mints a profile that
# carries the app's required entitlements (Extended Virtual Addressing +
# Increased Memory Limit — the large-model app needs these). The old hard-coded
# manual profile ("Off Grid iPhone 12") is device-specific and lacks those
# entitlements, so it fails on any other device; keep it only as an explicit
# fallback via IOS_PROFILE for offline/endpoint-timeout situations.
#
# We bypass `react-native run-ios --device` because it runs xcodebuild without
# these signing overrides.
#
# Override per-machine with env vars if your device/profile/team differ:
#   IOS_DEVICE_ID  — target a specific device UDID
#   IOS_TEAM       — development team id
#   IOS_PROFILE    — set to force MANUAL signing with a named profile (fallback)
#   FORCE_NATIVE_BUILD=1 — ignore the native-input cache and rebuild
#
# Metro reachability. A device build probes Metro at launch; AppDelegate bounds that probe to 2 s and
# falls back to the bundle shipped in the app, so on a network where the phone cannot reach the Mac:
#   FORCE_BUNDLING=1          — ship main.jsbundle in the Debug app (the fallback needs it)
#   SKIP_BUNDLING_METRO_IP=1  — do not bake the Mac's Wi-Fi address into the app
#   METRO_HOST=100.x.y.z      — bake a reachable address instead (a Tailscale IP, say)
set -euo pipefail

# Pick a target device, then make sure it is actually reachable. These are two
# DIFFERENT questions and this script used to ask only the second one.
#
# We ask `devicectl` (not `xctrace`) because a wired device that is paired-but-
# not-tethered-for-Instruments shows up under xctrace's "Devices Offline"
# section even though `devicectl`/`xcodebuild -destination id=` can still reach
# it. We do NOT filter on `transportType`: on modern setups the phone is reached
# over the CoreDevice network tunnel, so `transportType` reads "None" even for a
# fully-connected device, and an old `transportType != "None"` filter matched
# nothing.
#
# `tunnelState` is TRANSIENT: CoreDevice raises the tunnel on demand and lets it
# go idle. A wired, paired, trusted phone sits at tunnelState="disconnected"
# until something asks for it — so selecting only on tunnelState=="connected"
# (the previous predicate) reported "No connected iOS device found" for a device
# that was plugged in and perfectly usable. The states that matter:
#   unavailable  — a remembered device that is NOT physically here
#   disconnected — here, tunnel merely idle   <- must still be selectable
#   connected    — here, tunnel warm
#
# Step 1 (candidates): everything except "unavailable". Deliberately a denylist
# rather than an allowlist of known-good states — a false positive fails loudly
# in step 2 with a useful message, while a false negative is the bug above.
# Ranked: already-connected first, then wired, so the tethered phone wins when
# several devices are remembered.
# Step 2 (wake): `devicectl device info details` forces the tunnel up; re-poll
# until it reads "connected". Applies to IOS_DEVICE_ID too — an explicitly named
# device goes cold exactly the same way.
#
# Neither helper exits non-zero when nothing is found, so the friendly guards
# below can report it instead of `set -e` aborting mid-detection.
list_candidates() {
  local json
  json="$(mktemp)"
  xcrun devicectl list devices --json-output "$json" >/dev/null 2>&1 || { rm -f "$json"; return 0; }
  python3 - "$json" <<'PY'
import json, sys
try:
    devices = json.load(open(sys.argv[1]))["result"]["devices"]
except Exception:
    sys.exit(0)

def rank(conn):
    return (
        0 if conn.get("tunnelState") == "connected" else 1,
        0 if conn.get("transportType") == "wired" else 1,
    )

rows = []
for dev in devices:
    conn = dev.get("connectionProperties", {})
    if conn.get("tunnelState") == "unavailable":
        continue
    udid = dev.get("hardwareProperties", {}).get("udid")
    if udid:
        rows.append((rank(conn), udid, dev.get("deviceProperties", {}).get("name", "?")))
for _, udid, name in sorted(rows, key=lambda row: row[0]):
    print(f"{udid}\t{name}")
PY
  rm -f "$json"
}

tunnel_state() {
  local json
  json="$(mktemp)"
  xcrun devicectl list devices --json-output "$json" >/dev/null 2>&1 || { rm -f "$json"; return 0; }
  python3 - "$json" "$1" <<'PY'
import json, sys
try:
    devices = json.load(open(sys.argv[1]))["result"]["devices"]
except Exception:
    sys.exit(0)
for dev in devices:
    if dev.get("hardwareProperties", {}).get("udid") == sys.argv[2]:
        print(dev.get("connectionProperties", {}).get("tunnelState", ""))
        break
PY
  rm -f "$json"
}

# Raise the CoreDevice tunnel for $1. `info details` is the cheapest call that
# forces it; the state can lag the call, so re-poll rather than trusting one read.
wake_device() {
  local udid="$1" attempt
  for attempt in 1 2 3; do
    [ "$(tunnel_state "$udid")" = "connected" ] && return 0
    xcrun devicectl device info details --device "$udid" >/dev/null 2>&1 || true
  done
  [ "$(tunnel_state "$udid")" = "connected" ]
}

if [ -n "${IOS_DEVICE_ID:-}" ]; then
  DEVICE_ID="$IOS_DEVICE_ID"
  DEVICE_NAME="IOS_DEVICE_ID override"
else
  CANDIDATE="$(list_candidates | head -1)"
  if [ -z "$CANDIDATE" ]; then
    echo "No iOS device is connected. Plug one in and trust it, or set IOS_DEVICE_ID." >&2
    echo "(Devices xcrun remembers but that are not physically present are ignored.)" >&2
    exit 1
  fi
  DEVICE_ID="${CANDIDATE%%$'\t'*}"
  DEVICE_NAME="${CANDIDATE#*$'\t'}"
fi

echo "Target device: $DEVICE_NAME ($DEVICE_ID)"
if ! wake_device "$DEVICE_ID"; then
  echo "Device $DEVICE_NAME is present but its CoreDevice tunnel will not come up." >&2
  echo "Unlock the phone, confirm the 'Trust This Computer' prompt, and re-run." >&2
  exit 1
fi
TEAM="${IOS_TEAM:-84V6KCAC49}"
# BUNDLE_ID is read from the built .app below, NOT hardcoded — the Debug config carries a
# `.dev` suffix (ai.offgridmobile.dev) while Release is ai.offgridmobile, and hardcoding it
# meant we installed the .dev build but launched the old ai.offgridmobile app.

MOBILE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$MOBILE_ROOT/ios"

APP="build/device/Build/Products/Debug-iphoneos/OffgridMobile.app"
NATIVE_STAMP="build/device/.offgrid-native-inputs.sha256"

native_input_hash() {
  {
    printf '%s\n' "team=$TEAM" "profile=${IOS_PROFILE:-}" \
      "forceBundle=${FORCE_BUNDLING:-}" \
      "skipMetroIp=${SKIP_BUNDLING_METRO_IP:-}"
    # Hash repository inputs, not Xcode's mutable user state. Files such as
    # xcuserdata and .xcode.env.local change during a build and would make every
    # later run look stale even when no native source changed.
    {
      git -C "$MOBILE_ROOT" ls-files -z -- ios patches package.json package-lock.json
      git -C "$MOBILE_ROOT" ls-files -z --others --exclude-standard -- \
        ios patches package.json package-lock.json
    } | while IFS= read -r -d '' path; do
      printf 'path=%s\n' "$path"
      shasum -a 256 "$MOBILE_ROOT/$path"
    done
  } | shasum -a 256 | awk '{print $1}'
}

NATIVE_HASH="$(native_input_hash)"
if [ "${FORCE_NATIVE_BUILD:-0}" != "1" ] && [ -d "$APP" ] && \
   [ -f "$NATIVE_STAMP" ] && [ "$(cat "$NATIVE_STAMP")" = "$NATIVE_HASH" ]; then
  BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist" 2>/dev/null || echo 'ai.offgridmobile.dev')"
  echo "Native inputs are unchanged. Reusing the installed $BUNDLE_ID app."
  if xcrun devicectl device process launch --device "$DEVICE_ID" --terminate-existing "$BUNDLE_ID"; then
    exit 0
  fi
  echo "The cached app is not installed. Installing it without rebuilding ..."
  xcrun devicectl device install app --device "$DEVICE_ID" "$APP"
  xcrun devicectl device process launch --device "$DEVICE_ID" --terminate-existing "$BUNDLE_ID"
  exit 0
fi

# Build against a GENERIC iOS destination, not `id=$DEVICE_ID`. Targeting the
# live device makes xcodebuild block until the device is fully "available",
# which fails ("developer disk image could not be mounted") whenever the phone
# locks or the tunnel hiccups mid-build — even though nothing about compiling
# needs the device. We compile for the arm64 device slice and let the install /
# launch steps below reach the device via `devicectl`.
#
# Default: automatic signing (Xcode registers the connected device + mints a
# profile with the required entitlements). Set IOS_PROFILE to force manual.
if [ -n "${IOS_PROFILE:-}" ]; then
  echo "Building (manual signing, profile: $IOS_PROFILE) for device $DEVICE_ID ..."
  xcodebuild -workspace OffgridMobile.xcworkspace -scheme OffgridMobile -configuration Debug \
    -destination "generic/platform=iOS" \
    -derivedDataPath build/device \
    CODE_SIGN_STYLE=Manual \
    DEVELOPMENT_TEAM="$TEAM" \
    PROVISIONING_PROFILE_SPECIFIER="$IOS_PROFILE" \
    CODE_SIGN_IDENTITY="Apple Development" \
    build
else
  echo "Building (automatic signing) for device $DEVICE_ID ..."
  xcodebuild -workspace OffgridMobile.xcworkspace -scheme OffgridMobile -configuration Debug \
    -destination "generic/platform=iOS" \
    -derivedDataPath build/device \
    -allowProvisioningUpdates \
    CODE_SIGN_STYLE=Automatic \
    DEVELOPMENT_TEAM="$TEAM" \
    build
fi

# A physical iPhone cannot use the Mac's localhost. The React Native build phase
# writes the first Wi-Fi address it finds to ip.txt, but some networks isolate
# clients even when both devices are on the same subnet. Prefer an explicit host;
# otherwise use this Mac's Tailscale address when Metro is reachable there. The
# Debug builds load from this Metro address so Fast Refresh remains available after installation.
METRO_HOST="${IOS_METRO_HOST:-}"
if [ -z "$METRO_HOST" ] && command -v tailscale >/dev/null 2>&1; then
  TAILSCALE_HOST="$(tailscale ip -4 2>/dev/null | head -1 || true)"
  if [ -n "$TAILSCALE_HOST" ] && [ "$(curl -fsS --max-time 2 "http://$TAILSCALE_HOST:8081/status" 2>/dev/null || true)" = "packager-status:running" ]; then
    METRO_HOST="$TAILSCALE_HOST"
  fi
fi
if [ -n "$METRO_HOST" ]; then
  printf '%s\n' "$METRO_HOST" > "$APP/ip.txt"
  echo "Debug Metro host: $METRO_HOST:8081"
fi

echo "Installing $APP ..."
xcrun devicectl device install app --device "$DEVICE_ID" "$APP"
printf '%s\n' "$NATIVE_HASH" > "$NATIVE_STAMP"

# Launch the SAME bundle we just built/installed — read its real CFBundleIdentifier from the
# built Info.plist (Debug = ai.offgridmobile.dev). Fall back to the .dev id if the read fails.
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist" 2>/dev/null || echo 'ai.offgridmobile.dev')"
echo "Launching $BUNDLE_ID ..."
xcrun devicectl device process launch --device "$DEVICE_ID" --terminate-existing "$BUNDLE_ID"
