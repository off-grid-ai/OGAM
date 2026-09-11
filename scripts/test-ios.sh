#!/usr/bin/env bash
set -euo pipefail

mobile_root="$(cd "$(dirname "$0")/.." && pwd)"
ios_root="$mobile_root/ios"
artifact_root="$mobile_root/.artifacts/test-ios"
full_log="$artifact_root/xcodebuild.log"

mkdir -p "$artifact_root"
cd "$ios_root"

# Simulator names change between Xcode releases and CI images. Select an available iPhone by its
# stable runtime identifier instead of assuming one named model is installed everywhere.
if [ -n "${IOS_SIMULATOR_ID:-}" ]; then
  simulator_id="$IOS_SIMULATOR_ID"
else
  simulator_id="$(xcrun simctl list devices available -j | python3 -c '
import json, re, sys

devices = json.load(sys.stdin).get("devices", {})
def runtime_version(runtime):
    return tuple(int(part) for part in re.findall(r"\d+", runtime))

for runtime in sorted(devices, key=runtime_version, reverse=True):
    for device in devices[runtime]:
        if device.get("isAvailable") and "iPhone" in device.get("deviceTypeIdentifier", ""):
            print(device["udid"])
            raise SystemExit(0)
raise SystemExit("No available iPhone simulator is installed.")
')"
fi

set +e
xcodebuild test \
  -workspace OffgridMobile.xcworkspace \
  -scheme OffgridMobile \
  -destination "platform=iOS Simulator,id=${simulator_id}" \
  -only-testing:OffgridMobileTests \
  2>&1 \
  | tee "$full_log" \
  | node "$mobile_root/scripts/format-ios-test-output.mjs"
xcode_status=${PIPESTATUS[0]}
set -e

if [ "$xcode_status" -ne 0 ]; then
  echo
  echo "iOS build or test failed. Relevant Xcode errors:"
  grep -E '(^|[[:space:]])(error:|fatal error:)|Testing failed:|The following build commands failed|\*\* TEST FAILED \*\*' "$full_log" \
    | tail -n 120 \
    || true
  echo "Full iOS log: $full_log"
  exit "$xcode_status"
fi

echo "Full iOS log: $full_log"
