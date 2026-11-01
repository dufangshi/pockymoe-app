#!/usr/bin/env bash
# Desktop E2E backend (Python 3 standard library; existing debug Rust binary).
# Usage: ./scripts/e2e-desktop-backend.sh start|serve|stop|status|env
#        ./scripts/e2e-desktop-backend.sh stop-device 3|start-device 3
#        ./scripts/e2e-desktop-backend.sh complete|fail|request-approval|request-input|start-turn DEVICE_IDX THREAD_ID
#        ./scripts/e2e-desktop-backend.sh burst N
#        ./scripts/e2e-desktop-backend.sh verify
#
# start is idempotent; serve owns the run until Ctrl-C. stop preserves logs/data.
# env prints .local/e2e-desktop-env.json (LOCAL TEST credentials only; do not share).
# Defaults: relay 18890, supervisors 18891..18893. Override DESKTOP_E2E_RELAY_PORT,
# DESKTOP_E2E_SUPERVISOR_PORT (first port), DESKTOP_E2E_CODEX_ROOT,
# DESKTOP_E2E_BIN or DESKTOP_E2E_WEB_DIST. No builds or production services touched.
# A new run always gets .local/e2e-desktop.*/ with separate SQLite/workspace/logs.
# Public HTTP creates accounts/devices/workspaces/threads. See desktop-fixture/README.md
# for historical SQLite seeding and the required fake-runtime controls.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec python3 "$ROOT/scripts/desktop-fixture/backend.py" "$@"
