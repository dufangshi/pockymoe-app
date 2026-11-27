#!/bin/bash
# Isolated lab backend for the native client: a relay with registration, relay devices
# with the fake runtime, and a direct local Supervisor. Never the owner's relay or
# Supervisor. Every process has its own HOME and an `env -i` environment.
#   LAB=<dir> BIN=<pockymoe> lab.sh start|device <name> <token> <port>|local <port>|stop|status
set -euo pipefail
LAB=${LAB:?set LAB to a scratch directory}
BIN=${BIN:-$LAB/pockymoe}
RELAY_PORT=${RELAY_PORT:-19201}
WEB_DIST=${WEB_DIST:-}
mkdir -p "$LAB/home" "$LAB/pids" "$LAB/logs"
[ -f "$LAB/secret" ] || (umask 077; head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$LAB/secret")
SECRET=$(cat "$LAB/secret")
base_env=(HOME="$LAB/home" USER="$USER" LANG=C.UTF-8 PATH=/usr/local/bin:/usr/bin:/bin HOST=127.0.0.1 RUST_LOG=info
  POCKYMOE_E2E_FAKE_RUNTIME=1 POCKYMOE_ADMIN_USERNAME=lab-admin POCKYMOE_ADMIN_PASSWORD="$SECRET" POCKYMOE_SESSION_SECRET="$SECRET" POCKYMOE_RELAY_SESSION_SECRET="$SECRET")
spawn() { local name=$1; shift; env -i "${base_env[@]}" "$@" > "$LAB/logs/$name.log" 2>&1 & echo $! > "$LAB/pids/$name"; }
case "${1:-}" in
  start)
    spawn relay PORT="$RELAY_PORT" POCKYMOE_RELAY_DATA_DIR="$LAB/relay" POCKYMOE_RELAY_REGISTRATION_ENABLED=true \
      POCKYMOE_PUBLIC_BASE_URL="http://localhost:$RELAY_PORT" ${WEB_DIST:+POCKYMOE_RELAY_WEB_DIST_DIR="$WEB_DIST"} \
      "$BIN" relay
    for _ in $(seq 60); do curl -sf "http://127.0.0.1:$RELAY_PORT/healthz" >/dev/null && break; sleep 0.5; done
    echo "relay http://localhost:$RELAY_PORT";;
  device)
    name=$2 token=$3 port=$4; mkdir -p "$LAB/$name/ws"
    spawn "$name" PORT="$port" POCKYMOE_RELAY_SUPERVISOR_PORT="$port" POCKYMOE_RELAY_SERVER_URL="http://localhost:$RELAY_PORT" \
      POCKYMOE_RELAY_AGENT_TOKEN="$token" POCKYMOE_DATABASE_PATH="$LAB/$name/db.sqlite" DATABASE_URL="$LAB/$name/db.sqlite" \
      POCKYMOE_WORKSPACE_ROOT="$LAB/$name/ws" WORKSPACE_ROOT="$LAB/$name/ws" "$BIN" relay-supervisor;;
  local)
    port=$2; mkdir -p "$LAB/local/ws"
    spawn local POCKYMOE_MODE=local PORT="$port" POCKYMOE_DATABASE_PATH="$LAB/local/db.sqlite" DATABASE_URL="$LAB/local/db.sqlite" \
      POCKYMOE_WORKSPACE_ROOT="$LAB/local/ws" WORKSPACE_ROOT="$LAB/local/ws" "$BIN" supervisor
    for _ in $(seq 60); do curl -sf "http://127.0.0.1:$port/healthz" >/dev/null && break; sleep 0.5; done
    echo "local http://localhost:$port";;
  stop)
    for f in "$LAB"/pids/*; do [ -f "$f" ] || continue; pid=$(cat "$f"); kill "$pid" 2>/dev/null && echo "stopped $(basename "$f") $pid"; rm -f "$f"; done;;
  status)
    for f in "$LAB"/pids/*; do [ -f "$f" ] || continue; pid=$(cat "$f"); if kill -0 "$pid" 2>/dev/null; then echo "$(basename "$f") $pid up"; else echo "$(basename "$f") $pid down"; fi; done;;
  *) echo "usage: lab.sh start|device <name> <token> <port>|local <port>|stop|status"; exit 2;;
esac
