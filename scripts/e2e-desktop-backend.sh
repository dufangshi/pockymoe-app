#!/usr/bin/env bash
# Pockymoe desktop E2E backend (Python 3, Node/pnpm, headless Chromium).
# Usage: ./scripts/e2e-desktop-backend.sh start|serve [--dev-web]
#        ./scripts/e2e-desktop-backend.sh stop|status|env
#        ./scripts/e2e-desktop-backend.sh rebuild-web
#        ./scripts/e2e-desktop-backend.sh stop-device 3|start-device 3
#        ./scripts/e2e-desktop-backend.sh complete|fail|request-approval|request-input|start-turn DEVICE_IDX THREAD_ID
#        ./scripts/e2e-desktop-backend.sh burst N
#        ./scripts/e2e-desktop-backend.sh verify|verify-api|verify-browser
#
# start is idempotent; serve owns the run until Ctrl-C. stop preserves logs/data.
# env prints .local/e2e-desktop-env.json (LOCAL TEST credentials only; do not share).
# Defaults: API relay 18890, supervisors 18891..18893, separate web 18894.
# Override DESKTOP_E2E_RELAY_PORT, DESKTOP_E2E_SUPERVISOR_PORT (first),
# DESKTOP_E2E_WEB_PORT, DESKTOP_E2E_POCKYMOE_ROOT, DESKTOP_E2E_BIN or
# DESKTOP_E2E_WEB_DIST. Rust binary defaults to the current desktop worktree.
# Static mode builds/caches Pages artifacts; --dev-web runs Vite for iteration.
# No Rust builds, production services, or the parent's :18900/:18901 are touched.
# A new run always gets .local/e2e-desktop.*/ with separate SQLite/workspace/logs.
# Public HTTP creates accounts/devices/workspaces/threads. See desktop-fixture/README.md
# for historical SQLite seeding and the required fake-runtime controls.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec python3 "$ROOT/scripts/desktop-fixture/backend.py" "$@"
