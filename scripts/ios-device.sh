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

DEVICE_ID="${IOS_DEVICE_ID:-00008101-000919E936F0801E}"
PROFILE="${IOS_PROFILE:-Off Grid iPhone 12}"
TEAM="${IOS_TEAM:-84V6KCAC49}"
# Debug (default) runs from Metro with live reload but is slow and gives bogus
# perf numbers. Release embeds the JS bundle and compiles native with
# optimizations - use it to measure real on-device model performance:
#   IOS_CONFIG=Release npm run ios:device
CONFIG="${IOS_CONFIG:-Debug}"
BUNDLE_ID="ai.offgridmobile"

cd "$(dirname "$0")/../ios"

echo "Building ($CONFIG, manual signing, profile: $PROFILE) for device $DEVICE_ID ..."
xcodebuild -workspace OffgridMobile.xcworkspace -scheme OffgridMobile -configuration "$CONFIG" \
  -destination "id=$DEVICE_ID" \
  -derivedDataPath build/device \
  CODE_SIGN_STYLE=Manual \
  DEVELOPMENT_TEAM="$TEAM" \
  PROVISIONING_PROFILE_SPECIFIER="$PROFILE" \
  CODE_SIGN_IDENTITY="Apple Development" \
  build

APP="build/device/Build/Products/$CONFIG-iphoneos/OffgridMobile.app"
echo "Installing $APP ..."
xcrun devicectl device install app --device "$DEVICE_ID" "$APP"

echo "Launching $BUNDLE_ID ..."
xcrun devicectl device process launch --device "$DEVICE_ID" --terminate-existing "$BUNDLE_ID"
