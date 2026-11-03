#!/usr/bin/env bash
# Build in place using ignored ios/Local.xcconfig; never echo private settings.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode-beta.app/Contents/Developer}"
DEVICE="${1:-}"
BUILD_DIR="${POCKYMOE_IOS_BUILD_DIR:-/tmp/rc-ios/device-build}"
mkdir -p "$BUILD_DIR"
if [[ -z "$DEVICE" ]]; then
    xcrun devicectl list devices --json-output "$BUILD_DIR/devices.json" > /dev/null
    DEVICE="$(python3 - "$BUILD_DIR/devices.json" <<'PYDEVICE'
import json, sys
items = json.load(open(sys.argv[1]))['result']['devices']
items = [d['identifier'] for d in items if d.get('hardwareProperties', {}).get('reality') == 'physical'
         and d.get('connectionProperties', {}).get('transportType') in ['wired', 'localNetwork']
         and d.get('deviceProperties', {}).get('developerModeStatus') == 'enabled']
if len(items) != 1: sys.exit('Connect one developer device or pass its device identifier as the first argument.')
print(items[0])
PYDEVICE
)"
fi
[[ -f "$ROOT/ios/Local.xcconfig" ]] || { echo 'Configure ignored ios/Local.xcconfig first; see docs/ios-shell.md.' >&2; exit 1; }
xcodegen generate --spec "$ROOT/ios/project.yml" >"$BUILD_DIR/generate.log" 2>&1
if ! xcodebuild build -project "$ROOT/ios/RemoteCodex.xcodeproj" -scheme RemoteCodex \
    -configuration Release -destination "id=$DEVICE" -derivedDataPath "$BUILD_DIR" \
    CODE_SIGN_STYLE=Automatic CODE_SIGN_IDENTITY='Apple Development' \
    -allowProvisioningUpdates -allowProvisioningDeviceRegistration >"$BUILD_DIR/build.log" 2>&1; then
    echo "Build failed. Private local log: $BUILD_DIR/build.log" >&2; exit 1
fi
xcrun devicectl device install app --device "$DEVICE" "$BUILD_DIR/Build/Products/Release-iphoneos/Pockymoe.app" >"$BUILD_DIR/install.log" 2>&1 || {
    echo "Install failed. Private local log: $BUILD_DIR/install.log" >&2; exit 1;
}
echo 'Release build installed. Existing app data was preserved.'
