#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLATFORM="${1:-both}"
JOURNEY="${2:-smoke}"
APP_ID="${DEVICE_E2E_APP_ID:-ai.offgridmobile.dev}"
OUTPUT_ROOT="${DEVICE_E2E_OUTPUT_ROOT:-$ROOT_DIR/.artifacts/device-e2e}"
RUN_DIR="$OUTPUT_ROOT/$(date +%Y%m%d-%H%M%S)"
ANDROID_SERIAL="${ANDROID_SERIAL:-}"
IOS_WDA_URL="${IOS_WDA_URL:-}"

usage() {
  echo "Usage: $0 [android|ios|both] [smoke|chat]" >&2
  echo "Set ANDROID_SERIAL for Android and IOS_WDA_URL for iOS." >&2
}

case "$PLATFORM" in
  android | ios | both) ;;
  *)
    usage
    exit 2
    ;;
esac

case "$JOURNEY" in
  smoke | chat) ;;
  *)
    usage
    exit 2
    ;;
esac

mkdir -p "$RUN_DIR"

write_metadata() {
  {
    echo "platform=$PLATFORM"
    echo "journey=$JOURNEY"
    echo "app_id=$APP_ID"
    echo "commit=$(git -C "$ROOT_DIR" rev-parse HEAD)"
    echo "started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$RUN_DIR/metadata.txt"
}

run_android_chat() {
  local home_xml="$1"
  local chat_xml="$RUN_DIR/android-01-chat.xml"
  local typed_xml="$RUN_DIR/android-02-typed.xml"
  local result_xml="$RUN_DIR/android-03-result.xml"
  local count attempt

  android_tap_id new-chat-button "$home_xml"
  android_wait_for_id chat-input "$chat_xml"
  android_tap_id chat-input "$chat_xml"
  adb -s "$ANDROID_SERIAL" shell input text 'Reply%swith%sexactly%sOK.'
  android_wait_for_id send-button "$typed_xml"
  android_tap_id send-button "$typed_xml"

  for attempt in $(seq 1 240); do
    android_dump "$result_xml" || true
    count="$(xmllint --xpath 'count(//node[@resource-id="message-text"])' "$result_xml" 2>/dev/null || echo 0)"
    if (( ${count%.*} >= 2 )) &&
      [[ "$(xmllint --xpath 'boolean(//node[@text="OK"])' "$result_xml" 2>/dev/null)" == "true" ]] &&
      [[ "$(xmllint --xpath 'boolean(//node[@resource-id="stop-button"])' "$result_xml" 2>/dev/null)" == "false" ]]; then
      adb -s "$ANDROID_SERIAL" shell input keyevent KEYCODE_BACK
      android_dump "$result_xml"
      adb -s "$ANDROID_SERIAL" exec-out screencap -p > "$RUN_DIR/android-03-result.png"
      echo "android: PASS (new chat -> exact OK reply)"
      return 0
    fi
    sleep 1
  done

  echo "Android timed out waiting for the exact OK assistant reply." >&2
  return 1
}

android_dump() {
  local destination="$1"
  adb -s "$ANDROID_SERIAL" shell uiautomator dump /sdcard/offgrid-window.xml >/dev/null
  adb -s "$ANDROID_SERIAL" pull /sdcard/offgrid-window.xml "$destination" >/dev/null
}

android_wait_for_id() {
  local resource_id="$1"
  local destination="$2"
  local attempt

  for attempt in $(seq 1 30); do
    android_dump "$destination" || true
    if [[ -s "$destination" ]] &&
      [[ "$(xmllint --xpath "boolean(//node[@resource-id='$resource_id'])" "$destination" 2>/dev/null)" == "true" ]]; then
      return 0
    fi
    sleep 1
  done

  echo "Android timed out waiting for resource-id=$resource_id" >&2
  return 1
}

android_tap_id() {
  local resource_id="$1"
  local source="$2"
  local bounds

  bounds="$(xmllint --xpath "string(//node[@resource-id='$resource_id']/@bounds)" "$source")"
  if [[ ! "$bounds" =~ \[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\] ]]; then
    echo "Android could not resolve bounds for resource-id=$resource_id" >&2
    return 1
  fi

  adb -s "$ANDROID_SERIAL" shell input tap \
    "$(((${BASH_REMATCH[1]} + ${BASH_REMATCH[3]}) / 2))" \
    "$(((${BASH_REMATCH[2]} + ${BASH_REMATCH[4]}) / 2))"
}

run_android() {
  local home_xml="$RUN_DIR/android-00-home.xml"
  local settings_xml="$RUN_DIR/android-01-settings.xml"

  if [[ -z "$ANDROID_SERIAL" ]]; then
    echo "ANDROID_SERIAL is required for Android." >&2
    return 1
  fi

  adb -s "$ANDROID_SERIAL" get-state >/dev/null
  adb -s "$ANDROID_SERIAL" reverse tcp:8081 tcp:8081
  adb -s "$ANDROID_SERIAL" shell am force-stop "$APP_ID"
  adb -s "$ANDROID_SERIAL" shell monkey -p "$APP_ID" \
    -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1

  android_wait_for_id home-screen "$home_xml"
  adb -s "$ANDROID_SERIAL" exec-out screencap -p > "$RUN_DIR/android-00-home.png"

  if [[ "$JOURNEY" == "chat" ]]; then
    run_android_chat "$home_xml"
    return
  fi

  android_tap_id settings-tab "$home_xml"
  android_wait_for_id settings-tab "$settings_xml"
  if [[ "$(xmllint --xpath 'string(//node[@resource-id="settings-tab"]/@selected)' "$settings_xml")" != "true" ]]; then
    echo "Android Settings tab did not become selected." >&2
    return 1
  fi
  adb -s "$ANDROID_SERIAL" exec-out screencap -p > "$RUN_DIR/android-01-settings.png"

  echo "android: PASS (Home -> Settings)"
}

ios_json_value() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);const v=x.value;process.stdout.write(typeof v==="string"?v:JSON.stringify(v))})'
}

ios_create_session() {
  curl -fsS --max-time 30 -X POST "$IOS_WDA_URL/session" \
    -H 'Content-Type: application/json' \
    --data "{\"capabilities\":{\"alwaysMatch\":{\"bundleId\":\"$APP_ID\",\"shouldTerminateApp\":false,\"shouldActivateApp\":true}}}"
}

ios_source() {
  local session_id="$1"
  local destination="$2"
  curl -fsS --max-time 15 "$IOS_WDA_URL/session/$session_id/source" |
    ios_json_value > "$destination"
}

ios_screenshot() {
  local session_id="$1"
  local destination="$2"
  curl -fsS --max-time 15 "$IOS_WDA_URL/session/$session_id/screenshot" |
    ios_json_value |
    base64 --decode > "$destination"
}

ios_find_element() {
  local session_id="$1"
  local accessibility_id="$2"
  curl -fsS --max-time 15 -X POST "$IOS_WDA_URL/session/$session_id/element" \
    -H 'Content-Type: application/json' \
    --data "{\"using\":\"accessibility id\",\"value\":\"$accessibility_id\"}" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const e=JSON.parse(s).value;if(!e)process.exit(1);process.stdout.write(e["element-6066-11e4-a52e-4f735466cecf"]||e.ELEMENT)})'
}

ios_element_attribute() {
  local session_id="$1"
  local element_id="$2"
  local attribute="$3"
  curl -fsS --max-time 15 \
    "$IOS_WDA_URL/session/$session_id/element/$element_id/attribute/$attribute" |
    ios_json_value
}

ios_click_id() {
  local session_id="$1"
  local accessibility_id="$2"
  local element_id
  element_id="$(ios_find_element "$session_id" "$accessibility_id")"
  curl -fsS -X POST "$IOS_WDA_URL/session/$session_id/element/$element_id/click" \
    -H 'Content-Type: application/json' --data '{}' >/dev/null
}

ios_wait_for_source_pattern() {
  local session_id="$1"
  local pattern="$2"
  local destination="$3"
  local attempt

  for attempt in $(seq 1 30); do
    if ! ios_source "$session_id" "$destination"; then
      sleep 1
      continue
    fi
    if rg -q "$pattern" "$destination"; then
      return 0
    fi
    sleep 1
  done

  echo "iOS timed out waiting for accessibility pattern: $pattern" >&2
  return 1
}

run_ios_chat() {
  local session_id="$1"
  local input_id result_xml="$RUN_DIR/ios-03-result.xml"
  local deadline reply_id reply_label

  ios_click_id "$session_id" new-chat-button
  input_id="$(ios_find_element "$session_id" chat-input)"
  curl -fsS -X POST "$IOS_WDA_URL/session/$session_id/element/$input_id/value" \
    -H 'Content-Type: application/json' \
    --data '{"value":["Reply with exactly OK."]}' >/dev/null
  ios_click_id "$session_id" send-button

  deadline=$((SECONDS + 240))
  while ((SECONDS < deadline)); do
    # Targeted XCTest lookup avoids serializing the entire React Native tree while Metal is busy.
    # React Native exposes the assistant bubble as one accessibility element whose comma-delimited
    # label includes its visible response. Scope the assertion to that role and require an exact
    # label segment so the word inside the user prompt or model thought cannot satisfy the check.
    if reply_id="$(ios_find_element "$session_id" assistant-message 2>/dev/null)" &&
      reply_label="$(ios_element_attribute "$session_id" "$reply_id" label 2>/dev/null)" &&
      REPLY_LABEL="$reply_label" node -e \
        'process.exit(process.env.REPLY_LABEL.split(",").some(part => part.trim() === "OK") ? 0 : 1)'; then
      curl -fsS -X POST "$IOS_WDA_URL/session/$session_id/wda/keyboard/dismiss" \
        -H 'Content-Type: application/json' --data '{}' >/dev/null 2>&1 || true
      ios_source "$session_id" "$result_xml" || true
      ios_screenshot "$session_id" "$RUN_DIR/ios-03-result.png"
      printf 'assistant_accessibility_id=assistant-message\nelement_id=%s\nlabel=%s\n' \
        "$reply_id" "$reply_label" > "$RUN_DIR/ios-03-result.txt"
      echo "ios: PASS (new chat -> exact OK reply)"
      return 0
    fi
    sleep 1
  done

  echo "iOS timed out waiting for the exact OK assistant reply." >&2
  return 1
}

run_ios() {
  local session_response session_id

  if [[ -z "$IOS_WDA_URL" ]]; then
    echo "IOS_WDA_URL is required for iOS." >&2
    return 1
  fi

  curl -fsS --max-time 5 "$IOS_WDA_URL/status" >/dev/null
  session_response="$(ios_create_session)"
  session_id="$(printf '%s' "$session_response" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);process.stdout.write(x.sessionId||x.value.sessionId)})')"
  trap 'curl -fsS -X DELETE "$IOS_WDA_URL/session/$session_id" >/dev/null 2>&1 || true' RETURN

  # Reset navigation without clearing app data. A previous run may have left the app inside Chat,
  # where the bottom-tab Home control is intentionally absent.
  curl -fsS -X POST "$IOS_WDA_URL/session/$session_id/wda/apps/terminate" \
    -H 'Content-Type: application/json' --data "{\"bundleId\":\"$APP_ID\"}" >/dev/null
  curl -fsS -X POST "$IOS_WDA_URL/session/$session_id/wda/apps/launch" \
    -H 'Content-Type: application/json' --data "{\"bundleId\":\"$APP_ID\"}" >/dev/null

  ios_wait_for_source_pattern "$session_id" 'name="home-screen"' "$RUN_DIR/ios-00-home.xml"
  ios_screenshot "$session_id" "$RUN_DIR/ios-00-home.png"

  if [[ "$JOURNEY" == "chat" ]]; then
    run_ios_chat "$session_id"
    return
  fi

  ios_click_id "$session_id" settings-tab
  ios_wait_for_source_pattern "$session_id" \
    'name="settings-tab"[^>]*traits="[^"]*Selected' "$RUN_DIR/ios-01-settings.xml"
  ios_screenshot "$session_id" "$RUN_DIR/ios-01-settings.png"

  echo "ios: PASS (Home -> Settings)"
}

write_metadata

case "$PLATFORM" in
  android) run_android ;;
  ios) run_ios ;;
  both)
    run_android
    run_ios
    ;;
esac

echo "artifacts: $RUN_DIR"
