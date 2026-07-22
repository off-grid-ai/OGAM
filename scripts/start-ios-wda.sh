#!/usr/bin/env bash

set -euo pipefail

IOS_DEVICE_ID="${IOS_DEVICE_ID:?Set IOS_DEVICE_ID to the physical iPhone UDID.}"
IOS_DEVELOPMENT_TEAM="${IOS_DEVELOPMENT_TEAM:?Set IOS_DEVELOPMENT_TEAM to the Apple development team ID.}"
WDA_ROOT="${WDA_ROOT:-$HOME/.appium/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent}"
WDA_PROJECT="$WDA_ROOT/WebDriverAgent.xcodeproj"
WDA_DERIVED_DATA="${WDA_DERIVED_DATA:-/tmp/offgrid-wda-derived-data}"
WDA_BUNDLE_ID="${WDA_BUNDLE_ID:-ai.offgridmobile.WebDriverAgentRunner}"
WDA_APP="$WDA_DERIVED_DATA/Build/Products/Debug-iphoneos/WebDriverAgentRunner-Runner.app"
ICON_SCRIPT="$WDA_ROOT/Scripts/embed-runner-icon.sh"

if [[ ! -f "$WDA_PROJECT/project.pbxproj" ]]; then
  echo "WebDriverAgent not found at $WDA_ROOT." >&2
  echo "Install it with: appium driver install xcuitest" >&2
  exit 1
fi

# Xcode 26 can fail WDA's cosmetic icon post-action. Preserve the original once and disable only
# that cosmetic script; reinstalling the Appium XCUITest driver restores the upstream file.
if [[ -f "$ICON_SCRIPT" ]] && ! rg -q 'Off Grid device automation' "$ICON_SCRIPT"; then
  [[ -f "$ICON_SCRIPT.offgrid-original" ]] || cp "$ICON_SCRIPT" "$ICON_SCRIPT.offgrid-original"
  printf '%s\n' '#!/bin/bash' '# Disabled by Off Grid device automation: cosmetic and incompatible with Xcode 26.' 'exit 0' > "$ICON_SCRIPT"
  chmod +x "$ICON_SCRIPT"
fi

if [[ ! -d "$WDA_APP" ]]; then
  xcodebuild build-for-testing \
    -project "$WDA_PROJECT" \
    -scheme WebDriverAgentRunner \
    -destination 'generic/platform=iOS' \
    -derivedDataPath "$WDA_DERIVED_DATA" \
    -allowProvisioningUpdates \
    -allowProvisioningDeviceRegistration \
    CODE_SIGN_STYLE=Automatic \
    DEVELOPMENT_TEAM="$IOS_DEVELOPMENT_TEAM" \
    'CODE_SIGN_IDENTITY=Apple Development' \
    PRODUCT_BUNDLE_IDENTIFIER="$WDA_BUNDLE_ID"
fi

xcrun devicectl device install app --device "$IOS_DEVICE_ID" "$WDA_APP"
XCTESTRUN="$(find "$WDA_DERIVED_DATA/Build/Products" -maxdepth 1 -name 'WebDriverAgentRunner_*.xctestrun' -print -quit)"
if [[ -z "$XCTESTRUN" ]]; then
  echo "WDA xctestrun file was not produced." >&2
  exit 1
fi

echo "Starting WDA. Keep this terminal open and the iPhone unlocked."
echo "Copy the ServerURLHere URL into IOS_WDA_URL for scripts/run-device-e2e.sh."
exec xcodebuild test-without-building \
  -xctestrun "$XCTESTRUN" \
  -destination "id=$IOS_DEVICE_ID"
