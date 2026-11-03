#!/usr/bin/env bash
# No shell tracing: signing credentials are inherited only by the APK builder.
set -euo pipefail
exec python3 "$(cd "$(dirname "$0")" && pwd)/release_client.py" "$@"
