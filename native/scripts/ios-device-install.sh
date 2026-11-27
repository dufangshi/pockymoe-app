#!/usr/bin/env bash
# Builds the native app in Release (JS bundled, no Metro) and installs it on the iPhone connected
# by cable, signed by a free Apple ID's Personal Team. Steps and limits: docs/ios-install-personal.md.
#   POCKYMOE_IOS_TEAM_ID=XXXXXXXXXX native/scripts/ios-device-install.sh ["iPhone name"]
# Optional: POCKYMOE_IOS_BUNDLE_ID (if Xcode says the default id is unavailable to your team).
set -euo pipefail
cd "$(dirname "$0")/.."
[ "$(uname)" = Darwin ] || { echo "Run this on a Mac with Xcode." >&2; exit 1; }
export APP_VARIANT="${APP_VARIANT:-production}"
export POCKYMOE_IOS_SIGNING=personal
export POCKYMOE_IOS_BUNDLE_ID="${POCKYMOE_IOS_BUNDLE_ID:-com.pockymoe.app}"
if [ -z "${POCKYMOE_IOS_TEAM_ID:-}" ]; then
  echo "POCKYMOE_IOS_TEAM_ID is not set: Expo will ask for a development team (pick your Personal Team)."
fi
npm ci
# A clean prebuild so ios/ matches this signing mode (no push entitlement).
npx expo prebuild --platform ios --clean
npx expo run:ios --configuration Release --device ${1:+"$1"}
