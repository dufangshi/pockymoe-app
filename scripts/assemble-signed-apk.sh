#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -n "${REMOTE_CODEX_ANDROID_STORE_FILE:-}" ]]; then
  # Release workflow: client_release_ci.py decodes the keystore and passes the
  # signing values in the environment, so no properties file is read.
  store_file="$REMOTE_CODEX_ANDROID_STORE_FILE"
  store_password="${REMOTE_CODEX_ANDROID_STORE_PASSWORD:-}"
  key_alias="${REMOTE_CODEX_ANDROID_KEY_ALIAS:-remote-codex-release}"
  key_password="${REMOTE_CODEX_ANDROID_KEY_PASSWORD:-$store_password}"
else
  props="${REMOTE_CODEX_ANDROID_KEYSTORE_PROPERTIES:-$HOME/dev/remoteCodex/.local/mobile-release/android-release-keystore.properties}"
  if [[ ! -f "$props" ]]; then
    echo "missing keystore properties: $props" >&2
    exit 1
  fi

  store_file=""
  store_password=""
  key_alias="remote-codex-release"
  key_password=""
  while IFS='=' read -r key value; do
    key="${key//[[:space:]]/}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    case "$key" in
      storeFile) store_file="$value" ;;
      storePassword) store_password="$value" ;;
      keyAlias) key_alias="$value" ;;
      keyPassword) key_password="$value" ;;
    esac
  done < "$props"
  key_password="${key_password:-$store_password}"

  if [[ "$store_file" != /* ]]; then
    store_file="$HOME/dev/remoteCodex/$store_file"
  fi
fi
if [[ ! -f "$store_file" ]]; then
  echo "missing keystore: $store_file" >&2
  exit 1
fi

export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export REMOTE_CODEX_ANDROID_STORE_FILE="$store_file"
export REMOTE_CODEX_ANDROID_STORE_PASSWORD="$store_password"
export REMOTE_CODEX_ANDROID_KEY_ALIAS="$key_alias"
export REMOTE_CODEX_ANDROID_KEY_PASSWORD="$key_password"

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
