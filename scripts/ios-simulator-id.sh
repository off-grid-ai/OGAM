#!/usr/bin/env bash
# Print the id of the iPhone simulator the iOS tests run on: an available iPhone on the newest
# runtime. Simulator names change between Xcode releases and CI images, so the stable runtime
# identifier picks it, not a named model.
set -euo pipefail

xcrun simctl list devices available -j | python3 -c '
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
'
