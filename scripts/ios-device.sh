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
set -euo pipefail

# Auto-detect the currently-connected physical iOS device (first reachable one).
# Override with IOS_DEVICE_ID to target a specific device. We ask `devicectl`
# (not `xctrace`) because a wired device that is paired-but-not-tethered-for-
# Instruments shows up under xctrace's "Devices Offline" section even though
# `devicectl`/`xcodebuild -destination id=` can still reach it.
#
# We select on `connectionProperties.tunnelState == "connected"` — the field
# `devicectl` actually uses to decide reachability (its own `list devices` prints
# State=connected for exactly these). We do NOT filter on `transportType`: on
# modern setups the phone is reached over the CoreDevice network tunnel, so
# `transportType` reads "None" even for a fully-connected device, and the old
# `transportType != "None"` filter matched nothing. This never exits non-zero
# when no device is found, so the friendly guard below can report it instead of
# `set -e` aborting the script mid-detection.
detect_device_id() {
  local json
  json="$(mktemp)"
  xcrun devicectl list devices --json-output "$json" >/dev/null 2>&1 || { rm -f "$json"; return 0; }
  python3 - "$json" <<'PY'
import json, sys
try:
    devices = json.load(open(sys.argv[1]))["result"]["devices"]
except Exception:
    sys.exit(0)
for dev in devices:
    if dev.get("connectionProperties", {}).get("tunnelState") == "connected":
        udid = dev.get("hardwareProperties", {}).get("udid")
        if udid:
            print(udid)
            break
PY
  rm -f "$json"
}

DEVICE_ID="${IOS_DEVICE_ID:-$(detect_device_id)}"
if [ -z "$DEVICE_ID" ]; then
  echo "No connected iOS device found. Plug in and trust a device, or set IOS_DEVICE_ID." >&2
  exit 1
fi
TEAM="${IOS_TEAM:-84V6KCAC49}"
# BUNDLE_ID is read from the built .app below, NOT hardcoded — the Debug config carries a
# `.dev` suffix (ai.offgridmobile.dev) while Release is ai.offgridmobile, and hardcoding it
# meant we installed the .dev build but launched the old ai.offgridmobile app.

cd "$(dirname "$0")/../ios"

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

APP="build/device/Build/Products/Debug-iphoneos/OffgridMobile.app"
echo "Installing $APP ..."
xcrun devicectl device install app --device "$DEVICE_ID" "$APP"

# Launch the SAME bundle we just built/installed — read its real CFBundleIdentifier from the
# built Info.plist (Debug = ai.offgridmobile.dev). Fall back to the .dev id if the read fails.
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist" 2>/dev/null || echo 'ai.offgridmobile.dev')"
echo "Launching $BUNDLE_ID ..."
xcrun devicectl device process launch --device "$DEVICE_ID" --terminate-existing "$BUNDLE_ID"
