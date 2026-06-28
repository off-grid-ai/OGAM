#!/usr/bin/env bash
# Build, install and launch the app on a physical iOS device using MANUAL
# signing. We bypass `react-native run-ios --device` because it runs xcodebuild
# without signing overrides, and this project's automatic signing fails when
# Apple's developerservices2 provisioning endpoint times out. The manual profile
# below was created once via the developer portal.
#
# Override per-machine with env vars if your device/profile/team differ:
#   IOS_DEVICE_ID, IOS_PROFILE, IOS_TEAM
set -euo pipefail

# Auto-detect the currently-connected physical iOS device (first one online).
# Override with IOS_DEVICE_ID to target a specific device. We read the hardware
# UDID from `xctrace` — what `xcodebuild -destination id=` and `devicectl
# --device` both accept — taking only the "== Devices ==" (connected) section and
# skipping the Mac (no OS-version in parens) and the offline-devices section.
detect_device_id() {
  xcrun xctrace list devices 2>/dev/null \
    | awk '/^== Devices ==/{s=1;next} /^==/{s=0} s' \
    | grep -E '\([0-9]+\.[0-9.]+\)' \
    | sed -E 's/.*\(([0-9A-Fa-f-]+)\)[[:space:]]*$/\1/' \
    | head -1
}

DEVICE_ID="${IOS_DEVICE_ID:-$(detect_device_id)}"
if [ -z "$DEVICE_ID" ]; then
  echo "No connected iOS device found. Plug in and trust a device, or set IOS_DEVICE_ID." >&2
  exit 1
fi
PROFILE="${IOS_PROFILE:-Off Grid iPhone 12}"
TEAM="${IOS_TEAM:-84V6KCAC49}"
BUNDLE_ID="ai.offgridmobile"

cd "$(dirname "$0")/../ios"

echo "Building (manual signing, profile: $PROFILE) for device $DEVICE_ID ..."
xcodebuild -workspace OffgridMobile.xcworkspace -scheme OffgridMobile -configuration Debug \
  -destination "id=$DEVICE_ID" \
  -derivedDataPath build/device \
  CODE_SIGN_STYLE=Manual \
  DEVELOPMENT_TEAM="$TEAM" \
  PROVISIONING_PROFILE_SPECIFIER="$PROFILE" \
  CODE_SIGN_IDENTITY="Apple Development" \
  build

APP="build/device/Build/Products/Debug-iphoneos/OffgridMobile.app"
echo "Installing $APP ..."
xcrun devicectl device install app --device "$DEVICE_ID" "$APP"

echo "Launching $BUNDLE_ID ..."
xcrun devicectl device process launch --device "$DEVICE_ID" --terminate-existing "$BUNDLE_ID"
