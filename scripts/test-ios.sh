#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../ios"

if [ -n "${IOS_SIMULATOR_ID:-}" ]; then
  simulator_id="$IOS_SIMULATOR_ID"
else
  simulator_id="$(bash ../scripts/ios-simulator-id.sh)"
fi

# Boot it, or wait for a boot already under way, until the simulator reports the boot finished. A
# freshly created simulator spends its first minutes on set-up work; tests that started during it
# stalled for seconds at a time (a 256-byte file move took 5.5 s) and missed their waits.
xcrun simctl bootstatus "$simulator_id" -b

xcodebuild test \
  -workspace OffgridMobile.xcworkspace \
  -scheme OffgridMobile \
  -destination "platform=iOS Simulator,id=${simulator_id}" \
  -only-testing:OffgridMobileTests \
  | (xcpretty 2>/dev/null || cat)
