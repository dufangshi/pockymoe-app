#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=android-release-signing.sh
source "$root/scripts/android-release-signing.sh"

cd "$root/android"
./gradlew :app:assembleRelease --quiet
src="$root/android/app/build/outputs/apk/release/app-release.apk"
out_dir="${1:-$root/.local/release}"
mkdir -p "$out_dir"
cp "$src" "$out_dir/remote-codex-android.apk"
if command -v shasum >/dev/null; then
  shasum -a 256 "$out_dir/remote-codex-android.apk" | awk '{print $1}' > "$out_dir/remote-codex-android.apk.sha256"
else
  sha256sum "$out_dir/remote-codex-android.apk" | awk '{print $1}' > "$out_dir/remote-codex-android.apk.sha256"
fi
echo "$out_dir/remote-codex-android.apk"
