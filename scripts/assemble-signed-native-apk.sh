#!/usr/bin/env bash
# The native app's release APK (native/, package com.pockymoe.app), signed with the same release
# key as the WebView APK (android-release-signing.sh). Its version and versionCode come from
# android/app/build.gradle.kts (native/app.config.ts). Usage: assemble-signed-native-apk.sh [OUT_DIR]
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=android-release-signing.sh
source "$root/scripts/android-release-signing.sh"
export APP_VARIANT=production CI=1 EXPO_NO_TELEMETRY=1 EXPO_NO_GIT_STATUS=1

cd "$root/native"
npm ci --no-audit --no-fund
npx expo prebuild --platform android --clean --no-install
(cd android && ./gradlew :app:assembleRelease --quiet --no-daemon)
src="$root/native/android/app/build/outputs/apk/release/app-release.apk"
out_dir="${1:-$root/.local/release}"
mkdir -p "$out_dir"
cp "$src" "$out_dir/pockymoe-native-android.apk"
echo "$out_dir/pockymoe-native-android.apk"
