#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
export ANDROID_AVD_HOME="$ROOT/.local/avd"
export ANDROID_USER_HOME="$ROOT/.local/android-user"
AVD=pockymoe_aosp
PORT="${ANDROID_EMULATOR_PORT:-5580}"
SERIAL="emulator-$PORT"
ENV_FILE="$ROOT/.local/e2e-env.json"
ARTIFACTS="$ROOT/.local/android-e2e"
mkdir -p "$ARTIFACTS" "$ANDROID_AVD_HOME" "$ANDROID_USER_HOME"
rm -rf "$ARTIFACTS/screenshots"
rm -f "$ARTIFACTS/oauth-process-death-result.txt" "$ARTIFACTS/oauth-process-ids.json" "$ARTIFACTS/oauth-recovery.xml" "$ARTIFACTS/oauth-process-death.png" "$ARTIFACTS/fresh-install-test.log" "$ARTIFACTS/fresh-install-evidence.json" "$ARTIFACTS/instrumentation.log" "$ARTIFACTS/system-theme-test.log" "$ARTIFACTS/light-prepare-test.log" "$ARTIFACTS/cold-first-dark.mp4" "$ARTIFACTS/cold-first-launch.mp4" "$ARTIFACTS/cold-web-dark.mp4" "$ARTIFACTS/cold-web-light.mp4"
[[ -f "$ENV_FILE" ]] || { echo 'Start scripts/e2e-backend.sh on isolated ports first.' >&2; exit 1; }
RELAY_PORT="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["relayPort"])' "$ENV_FILE")"
[[ "$RELAY_PORT" != 45679 ]] || exit 1
# Always own the emulator; never attach to a worker's already-running instance.
if adb devices | awk '{print $1}' | rg -qx "$SERIAL"; then echo "$SERIAL already exists; choose another ANDROID_EMULATOR_PORT" >&2; exit 1; fi
IMAGE="${ANDROID_SYSTEM_IMAGE:-system-images;android-37.0;default;arm64-v8a}"
IMAGE_ROOT="$ROOT/.local/sdk"
IMAGE_DIR="$IMAGE_ROOT/$(printf '%s' "$IMAGE" | tr ';' '/')"
mkdir -p "$IMAGE_ROOT"
if [[ ! -e "$IMAGE_ROOT/licenses" ]]; then cp -R "$ANDROID_HOME/licenses" "$IMAGE_ROOT/licenses"; fi
if [[ ! -f "$IMAGE_DIR/system.img" ]]; then
  "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$IMAGE_ROOT" "$IMAGE"
fi
if [[ ! -f "$ANDROID_AVD_HOME/$AVD.ini" || "$(cat "$ANDROID_AVD_HOME/$AVD.image" 2>/dev/null || true)" != "$IMAGE" ]]; then
  # avdmanager derives its SDK from its own location, so keep the tool copy isolated too.
  mkdir -p "$IMAGE_ROOT/cmdline-tools"
  if [[ ! -x "$IMAGE_ROOT/cmdline-tools/latest/bin/avdmanager" ]]; then cp -R "$ANDROID_HOME/cmdline-tools/latest" "$IMAGE_ROOT/cmdline-tools/latest"; fi
  printf 'no\n' | ANDROID_SDK_ROOT="$IMAGE_ROOT" "$IMAGE_ROOT/cmdline-tools/latest/bin/avdmanager" create avd -f -n "$AVD" -k "$IMAGE" -d pixel_7 -p "$ANDROID_AVD_HOME/$AVD.avd"
  printf '%s\n' "$IMAGE" > "$ANDROID_AVD_HOME/$AVD.image"
fi
started=false
cleanup() {
  if $started; then
    adb -s "$SERIAL" logcat -d -s PockymoeStartup:I '*:S' > "$ARTIFACTS/startup-layers.log" 2>/dev/null || true
    adb -s "$SERIAL" logcat -d -s PockymoeE2E:I '*:S' > "$ARTIFACTS/live-updates.log" 2>/dev/null || true
    adb -s "$SERIAL" shell appops get com.remotecodex.app.debug > "$ARTIFACTS/notification-appops.txt" 2>/dev/null || true
    adb -s "$SERIAL" pull /sdcard/Android/data/com.remotecodex.app.debug/files/fresh-install-evidence.json "$ARTIFACTS/" >/dev/null 2>&1 || true
    adb -s "$SERIAL" pull /sdcard/Android/data/com.remotecodex.app.debug/files/integration-evidence.json "$ARTIFACTS/" >/dev/null 2>&1 || true
    adb -s "$SERIAL" pull /sdcard/Android/data/com.remotecodex.app.debug/files/screenshots "$ARTIFACTS/" >/dev/null 2>&1 || true
    adb -s "$SERIAL" shell run-as com.remotecodex.app.debug rm -f files/e2e-env.json >/dev/null 2>&1 || true
    adb -s "$SERIAL" emu kill >/dev/null 2>&1 || true
    wait "$EMULATOR_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM
"$ANDROID_HOME/emulator/emulator" -avd "$AVD" -port "$PORT" -sysdir "$IMAGE_DIR" -no-snapshot -no-boot-anim -no-audio -no-window -gpu swiftshader_indirect -memory 3072 -cores 4 >"$ARTIFACTS/emulator.log" 2>&1 &
EMULATOR_PID=$!
started=true
for _ in $(seq 1 120); do
  [[ "$(adb -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]] && break
  kill -0 "$EMULATOR_PID" || { echo "Owned emulator stopped; see $ARTIFACTS/emulator.log" >&2; exit 1; }
  sleep 2
done
[[ "$(adb -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]] || { echo "Owned emulator boot timed out" >&2; exit 1; }
adb -s "$SERIAL" shell input keyevent 82
adb -s "$SERIAL" shell settings put global window_animation_scale 0
adb -s "$SERIAL" shell settings put global transition_animation_scale 0
adb -s "$SERIAL" shell settings put global animator_duration_scale 0
adb -s "$SERIAL" shell settings put system screen_off_timeout 2147483647
adb -s "$SERIAL" shell cmd overlay enable --user current com.android.internal.systemui.navbar.gestural
# Recover only known AOSP boot dialogs, before measuring or testing the app.
dismiss_boot_anr() {
adb -s "$SERIAL" shell uiautomator dump /sdcard/pockymoe-boot.xml >/dev/null
adb -s "$SERIAL" pull /sdcard/pockymoe-boot.xml "$ARTIFACTS/boot-ui.xml" >/dev/null 2>&1
BOOT_CLOSE="$(python3 - "$ARTIFACTS/boot-ui.xml" <<'PYBOOT'
import sys, xml.etree.ElementTree as ET, re
root=ET.parse(sys.argv[1]).getroot()
if any(any(label in n.get('text', '') for label in ["System UI isn't responding", "Quickstep isn't responding"]) for n in root.iter()):
    for n in root.iter():
        if n.get('resource-id') == 'android:id/aerr_close':
            a,b,c,d=map(int,re.findall(r'\d+',n.get('bounds')))
            print((a+c)//2,(b+d)//2)
            break
PYBOOT
)"
if [[ -n "$BOOT_CLOSE" ]]; then
  adb -s "$SERIAL" shell input tap $BOOT_CLOSE
  echo 'Dismissed AOSP System UI/Quickstep startup ANR before launching app.'
  sleep 2
  return 0
fi
return 1
}
dismiss_boot_anr || true
adb -s "$SERIAL" reverse "tcp:$RELAY_PORT" "tcp:$RELAY_PORT"
CONTROL_PORT="$(python3 -c 'import json,sys,urllib.parse; d=json.load(open(sys.argv[1])); print(urllib.parse.urlparse(d.get("hostRelayUrl",d["relayUrl"])).port)' "$ENV_FILE")"
if [[ "$CONTROL_PORT" != "$RELAY_PORT" ]]; then adb -s "$SERIAL" reverse "tcp:$CONTROL_PORT" "tcp:$CONTROL_PORT"; fi
WEB_PORT="$(python3 -c 'import json,sys,urllib.parse; d=json.load(open(sys.argv[1])); print(urllib.parse.urlparse(d.get("webUrl",d["relayUrl"])).port)' "$ENV_FILE")"
if [[ "$WEB_PORT" != "$RELAY_PORT" ]]; then adb -s "$SERIAL" reverse "tcp:$WEB_PORT" "tcp:$WEB_PORT"; fi
cd "$ROOT/android"
./gradlew :app:assembleDebug :app:assembleDebugAndroidTest --max-workers=2
# The isolated SDK home has its own debug key. These are fresh-install tests,
# so remove only this task's test app rather than inheriting a different key/data.
adb -s "$SERIAL" uninstall com.remotecodex.app.debug >/dev/null 2>&1 || true
adb -s "$SERIAL" install app/build/outputs/apk/debug/app-debug.apk >/dev/null
adb -s "$SERIAL" uninstall com.remotecodex.app.debug.test >/dev/null 2>&1 || true
adb -s "$SERIAL" install app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk >/dev/null
record_cold() {
  local name="$1"
  adb -s "$SERIAL" shell am force-stop com.remotecodex.app.debug
  adb -s "$SERIAL" logcat -c
  adb -s "$SERIAL" shell screenrecord --bit-rate 8000000 --time-limit 8 "/sdcard/Download/$name.mp4" > "$ARTIFACTS/$name-record.log" 2>&1 &
  local recorder=$!
  sleep 0.7
  adb -s "$SERIAL" shell am start -W -n com.remotecodex.app.debug/com.remotecodex.app.MainActivity > "$ARTIFACTS/$name-launch.log"
  wait "$recorder"
  adb -s "$SERIAL" pull "/sdcard/Download/$name.mp4" "$ARTIFACTS/$name.mp4" >/dev/null 2>&1
  adb -s "$SERIAL" logcat -d -s PockymoeStartup:I '*:S' > "$ARTIFACTS/$name-layers.log"
  adb -s "$SERIAL" shell am force-stop com.remotecodex.app.debug
}
# First-ever launches have no remembered paint and must match the OS theme.
adb -s "$SERIAL" shell cmd uimode night yes
record_cold cold-first-dark
if dismiss_boot_anr; then record_cold cold-first-dark; fi
adb -s "$SERIAL" uninstall com.remotecodex.app.debug >/dev/null 2>&1 || true
adb -s "$SERIAL" install app/build/outputs/apk/debug/app-debug.apk >/dev/null
adb -s "$SERIAL" shell cmd uimode night no
record_cold cold-first-launch
if dismiss_boot_anr; then record_cold cold-first-launch; fi

# Grant the test app's user-controlled Live Update access on this disposable device.
adb -s "$SERIAL" shell appops set com.remotecodex.app.debug POST_PROMOTED_NOTIFICATIONS allow > "$ARTIFACTS/promotion-permission.log" 2>&1 || true
adb -s "$SERIAL" shell getprop ro.build.version.sdk > "$ARTIFACTS/api-level.txt"
adb -s "$SERIAL" shell pm list packages com.google.android.gms > "$ARTIFACTS/gms-packages.txt"
adb -s "$SERIAL" shell appops get com.remotecodex.app.debug > "$ARTIFACTS/notification-appops.txt"
# Fixture credentials travel as a local file, never command-line values or console output.
adb -s "$SERIAL" shell run-as com.remotecodex.app.debug mkdir -p files
adb -s "$SERIAL" shell "run-as com.remotecodex.app.debug sh -c 'cat > files/e2e-env.json'" < "$ENV_FILE"
adb -s "$SERIAL" shell am instrument -w -r -e class 'com.remotecodex.app.ProductParityTest#freshInstallConnectsOnlyToEnteredService' -e envFile /data/user/0/com.remotecodex.app.debug/files/e2e-env.json com.remotecodex.app.debug.test/androidx.test.runner.AndroidJUnitRunner | tee "$ARTIFACTS/fresh-install-test.log"
rg -q 'OK \([0-9]+ tests?\)' "$ARTIFACTS/fresh-install-test.log"
# Exercise the redirect/upgrade and actual system-browser callback paths before signing in.
for case in storedRelayIsProbedOnceAndConnectionErrorsStayEditable oauthReturnWithLivingActivity; do
  adb -s "$SERIAL" shell am instrument -w -r -e class "com.remotecodex.app.ProductParityTest#$case" -e envFile /data/user/0/com.remotecodex.app.debug/files/e2e-env.json com.remotecodex.app.debug.test/androidx.test.runner.AndroidJUnitRunner | tee "$ARTIFACTS/$case.log"
  rg -q 'OK \([0-9]+ tests?\)' "$ARTIFACTS/$case.log"
done
# Run the app normally, outside instrumentation, so am kill really destroys its JS proof.
WEB_ORIGIN="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["webUrl"])' "$ENV_FILE")"
adb -s "$SERIAL" shell am start -W -n com.remotecodex.app.debug/com.remotecodex.app.MainActivity --es e2eAuthUrl "$WEB_ORIGIN/relay/auth/e2e-tab" > "$ARTIFACTS/oauth-process-start.log"
for _ in $(seq 1 60); do
  adb -s "$SERIAL" shell dumpsys activity activities > "$ARTIFACTS/oauth-browser-state.txt"
  if python3 - "$ARTIFACTS/oauth-browser-state.txt" <<'PYBROWSER'
import pathlib,re,sys
text=pathlib.Path(sys.argv[1]).read_text()
resumed=re.findall(r'(?:mResumedActivity|topResumedActivity):.*',text)
raise SystemExit(0 if resumed and all('com.remotecodex.app.debug/' not in row for row in resumed) else 1)
PYBROWSER
  then break; fi
  sleep 0.25
done
OLD_APP_PID="$(adb -s "$SERIAL" shell pidof com.remotecodex.app.debug | tr -d '\r')"
[[ -n "$OLD_APP_PID" ]]
adb -s "$SERIAL" shell am kill com.remotecodex.app.debug
for _ in $(seq 1 40); do
  [[ -z "$(adb -s "$SERIAL" shell pidof com.remotecodex.app.debug | tr -d '\r')" ]] && break
  sleep 0.25
done
[[ -z "$(adb -s "$SERIAL" shell pidof com.remotecodex.app.debug | tr -d '\r')" ]] || { echo 'OAuth app process did not die'; exit 1; }
adb -s "$SERIAL" shell am start -W -a android.intent.action.VIEW -d 'remotecodex://auth/callback?id=local-fixture' -p com.remotecodex.app.debug > "$ARTIFACTS/oauth-process-return.log"
NEW_APP_PID=""
for _ in $(seq 1 40); do
  NEW_APP_PID="$(adb -s "$SERIAL" shell pidof com.remotecodex.app.debug | tr -d '\r' || true)"
  [[ -n "$NEW_APP_PID" && "$NEW_APP_PID" != "$OLD_APP_PID" ]] && break
  sleep 0.25
done
[[ -n "$NEW_APP_PID" && "$NEW_APP_PID" != "$OLD_APP_PID" ]]
printf '{"oldProcessId":%s,"newProcessId":%s}\n' "$OLD_APP_PID" "$NEW_APP_PID" > "$ARTIFACTS/oauth-process-ids.json"
for _ in $(seq 1 40); do
  adb -s "$SERIAL" shell uiautomator dump /sdcard/oauth-recovery.xml >/dev/null
  adb -s "$SERIAL" pull /sdcard/oauth-recovery.xml "$ARTIFACTS/oauth-recovery.xml" >/dev/null 2>&1
  if rg -q 'Sign-in was interrupted. Please sign in again.' "$ARTIFACTS/oauth-recovery.xml"; then break; fi
  sleep 0.25
done
rg -q 'Sign-in was interrupted. Please sign in again.' "$ARTIFACTS/oauth-recovery.xml"
adb -s "$SERIAL" exec-out screencap -p > "$ARTIFACTS/oauth-process-death.png"
printf '%s\n' 'PASS: actual app process killed under the system browser; callback created a new process with sign-in and the lost-proof notice.' > "$ARTIFACTS/oauth-process-death-result.txt"
adb -s "$SERIAL" shell am instrument -w -r -e class 'com.remotecodex.app.ProductParityTest#thinShellAndLiveUpdates' -e envFile /data/user/0/com.remotecodex.app.debug/files/e2e-env.json com.remotecodex.app.debug.test/androidx.test.runner.AndroidJUnitRunner | tee "$ARTIFACTS/instrumentation.log"
rg -q 'OK \([0-9]+ tests?\)' "$ARTIFACTS/instrumentation.log"
adb -s "$SERIAL" shell settings put global animator_duration_scale 1
record_cold cold-web-dark
if dismiss_boot_anr; then record_cold cold-web-dark; fi

# Exercise system-follow without locking Web media to the persisted launch mode.
adb -s "$SERIAL" shell am instrument -w -r -e class 'com.remotecodex.app.ProductParityTest#systemThemeChangesKeepTheSameWebView' -e envFile /data/user/0/com.remotecodex.app.debug/files/e2e-env.json com.remotecodex.app.debug.test/androidx.test.runner.AndroidJUnitRunner | tee "$ARTIFACTS/system-theme-test.log"
rg -q 'OK \([0-9]+ tests?\)' "$ARTIFACTS/system-theme-test.log"
# Prepare and record a real configured light page as well as the dark page.
adb -s "$SERIAL" shell am instrument -w -r -e class 'com.remotecodex.app.ProductParityTest#prepareColdStart' -e paint light -e envFile /data/user/0/com.remotecodex.app.debug/files/e2e-env.json com.remotecodex.app.debug.test/androidx.test.runner.AndroidJUnitRunner | tee "$ARTIFACTS/light-prepare-test.log"
rg -q 'OK \([0-9]+ tests?\)' "$ARTIFACTS/light-prepare-test.log"
record_cold cold-web-light
if dismiss_boot_anr; then record_cold cold-web-light; fi
