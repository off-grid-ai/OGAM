# Physical-device UI automation

This is the replayable physical-device smoke path for Off Grid Mobile. It uses only deterministic
native accessibility automation: Android UIAutomator through ADB and iOS XCTest through
WebDriverAgent (WDA). There is no screenshot interpretation, vision model, LLM judgment, or Provit
dependency.

The checked-in `smoke` flow is identical on both platforms:

1. Launch the installed debug app.
2. Poll the native accessibility tree for `home-screen`.
3. Save the Home tree and screenshot.
4. Select `settings-tab` by its accessibility identifier.
5. Assert that `settings-tab` is selected.
6. Save the Settings tree and screenshot.

Polling has a bounded 30-second retry window. It avoids timing-dependent sleeps without allowing a
hung app to pass.

The `chat` flow launches a new conversation, types `Reply with exactly OK.` through the native text
input, presses the real Send control, and waits up to four minutes for an exact visible `OK` assistant
reply. The longer bound accommodates cold physical-device model loading; the run still fails if the
Stop control remains or only the user prompt is visible.

## Evidence and scope

- Device runs exercise the real installed app with taps, typing, swipes, Back, and relaunches.
- Assertions use stable accessibility identifiers and user-visible selected state.
- Timestamped XML trees, PNG screenshots, app ID, and Git commit are written under
  `.artifacts/device-e2e/`.
- Device automation complements the rendered App/navigation integration suite; it does not replace
  the no-mockist integration tests required by `AGENTS.md`.
- A hardware-only row remains partial/device-gated unless the recorded flow proves the actual
  behavior on the physical device.

## Shared setup

Keep Metro running and install a fresh debug build on each connected device:

```bash
npm start -- --reset-cache
adb devices -l
adb -s <android-serial> reverse tcp:8081 tcp:8081
npm run android

IOS_DEVICE_ID=<ios-udid> npm run ios:device
```

Do not start a second Metro server if port 8081 is already listening.

## Run Android with UIAutomator

The phone must be unlocked with USB debugging enabled. The runner launches the app, obtains the
accessibility XML using `uiautomator dump`, resolves the exact `resource-id` bounds, taps their
center through ADB, and asserts the resulting tree.

```bash
ANDROID_SERIAL=<android-serial> scripts/run-device-e2e.sh android smoke
ANDROID_SERIAL=<android-serial> scripts/run-device-e2e.sh android chat
```

Useful direct diagnostics use the same deterministic mechanism:

```bash
adb -s <android-serial> shell uiautomator dump /sdcard/offgrid-window.xml
adb -s <android-serial> pull /sdcard/offgrid-window.xml /tmp/offgrid-window.xml
xmllint --xpath '//node[@resource-id]/@resource-id' /tmp/offgrid-window.xml
adb -s <android-serial> exec-out screencap -p > /tmp/offgrid-android.png
```

## Start iOS WebDriverAgent

The iPhone must be paired, trusted, unlocked, and set to Auto-Lock: Never for the run. Install
Appium's XCUITest driver once; this supplies the upstream WDA Xcode project:

```bash
npm install -g appium
appium driver install xcuitest
appium driver list --installed
```

Start WDA from this repository in a dedicated terminal:

```bash
IOS_DEVICE_ID=<ios-udid> \
IOS_DEVELOPMENT_TEAM=<apple-team-id> \
scripts/start-ios-wda.sh
```

The script records the working Xcode 26/physical iOS sequence: build and sign for a generic iOS
device, install with `devicectl`, and execute the generated test bundle against the live UDID. Xcode
prints a line containing `ServerURLHere->http://<device-ip>:8100<-ServerURLHere`; keep that terminal
open and use the URL below.

## Run iOS with XCTest/WDA

The runner talks directly to WDA's WebDriver endpoint. It creates an app session, queries elements
by accessibility ID, clicks them, and asserts the returned XCTest accessibility XML.

```bash
curl -fsS http://<device-ip>:8100/status
IOS_WDA_URL=http://<device-ip>:8100 scripts/run-device-e2e.sh ios smoke
IOS_WDA_URL=http://<device-ip>:8100 scripts/run-device-e2e.sh ios chat
```

Run both physical phones sequentially with one command:

```bash
ANDROID_SERIAL=<android-serial> \
IOS_WDA_URL=http://<device-ip>:8100 \
scripts/run-device-e2e.sh both
```

Pass `chat` after `both` to run the real local-generation journey on both devices.

Override `DEVICE_E2E_APP_ID` only when intentionally testing another bundle ID. Override
`DEVICE_E2E_OUTPUT_ROOT` to place run evidence elsewhere.

## Adding a journey step

Add a stable `testID`/accessibility identifier to the shared production component when the user
control has no reliable identity. Then extend both platform functions in
`scripts/run-device-e2e.sh` with the same gesture and visible assertion. Never select localized
copy when a semantic identifier exists, and never make pixel coordinates the recorded contract.

For Android, dump the tree, resolve the target's bounds with `xmllint`, and drive it with `adb shell
input`. For iOS, query WDA with `using: accessibility id`, operate on the returned element, then
assert the next source tree. Keep each wait bounded and save a tree plus screenshot at meaningful
state transitions.

## Recovery

Android:

- Re-run `adb reverse tcp:8081 tcp:8081` after reconnecting.
- Wake the device, dismiss the keyguard, and confirm `ai.offgridmobile.dev` is foregrounded.
- For product diagnosis, pull the dev-only `offgrid-debug.log` described in `AGENTS.md`.

iOS:

- Keep the phone unlocked; a locked phone suspends WDA.
- If `devicectl` reports unavailable, unlock/reconnect and verify `xcrun devicectl list devices`.
- If port 8100 is stale, stop the previous WDA `xcodebuild` before starting another.
- Reinstalling the Appium XCUITest driver restores its WDA files; rerun `start-ios-wda.sh` afterward.

Both:

- Do not erase app data or terminate a model download unless that is the behavior under test.
- Treat local-model work as asynchronous and poll an observable state with a retry cap.
- Preserve unrelated worktree and Pro submodule changes.
