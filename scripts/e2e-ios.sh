#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.local/e2e-env.json"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode-beta.app/Contents/Developer}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE; run scripts/e2e-backend.sh start first" >&2
  exit 1
fi

eval "$(python3 - "$ENV_FILE" <<'PY'
import json, sys, shlex
from pathlib import Path
data=json.loads(Path(sys.argv[1]).read_text())
# New shared fixtures separate the Web from the relay proxy. Keep older env files usable.
data['iosWebUrl'] = data.get('webUrl', data['relayUrl'])
for key, field in {'RELAY_URL':'iosWebUrl','SEPARATE_RELAY_URL':'relayUrl','TOKEN':'token','DEVICE_ID':'deviceId','WORKSPACE_ID':'workspaceId','DEVICE_API':'deviceApi','USERNAME':'username','PASSWORD':'password'}.items():
    print('export TEST_RUNNER_E2E_' + key + '=' + shlex.quote(str(data[field])))
PY
)"

cd "$ROOT/ios"
xcodegen generate
if [[ -z "${IOS_SIMULATOR_ID:-}" ]]; then
  echo 'Set IOS_SIMULATOR_ID to your own iPhone 17 Pro simulator UUID.' >&2
  exit 1
fi
DEST="platform=iOS Simulator,id=$IOS_SIMULATOR_ID"
xcodebuild \
  -project RemoteCodex.xcodeproj \
  -scheme RemoteCodex \
  -derivedDataPath "$ROOT/.local/ios-build" \
  -parallel-testing-enabled NO \
  -destination "$DEST" \
  -destination-timeout 30 \
  -test-timeouts-enabled YES \
  -maximum-test-execution-time-allowance 90 \
  -only-testing:"${IOS_ONLY_TESTING:-RemoteCodexUITests/RemoteCodexUITests}" \
  -resultBundlePath "$ROOT/.local/ios-results-$(date +%s).xcresult" \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- \
  test
