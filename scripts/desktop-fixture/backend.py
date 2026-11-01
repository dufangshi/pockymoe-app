"""Separate Pockymoe web/API origins + three fake supervisors; isolated data."""

import argparse
import concurrent.futures
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
LOCAL = ROOT / ".local"
STATE = LOCAL / "e2e-desktop-state.json"
ENV = LOCAL / "e2e-desktop-env.json"
EVIDENCE = Path("/tmp/rc-desktop/evidence/fixture/v2")
NAMES = ["MacBook Pro", "Studio Linux", "Build Box"]
# These are public, disposable test credentials, never inherited credentials.
USERNAME = "desktop"
PASSWORD = "desktop-local-test-1"


class FixtureError(Exception):
    pass


def write_json(path, data):
    temporary = path.with_suffix(".tmp")
    with temporary.open("w") as output:
        os.chmod(temporary, 0o600)
        json.dump(data, output, ensure_ascii=False, indent=2)
        output.write("\n")
    temporary.replace(path)


def read_state():
    if not STATE.exists():
        raise FixtureError("No recorded desktop fixture. Run start first.")
    state = json.loads(STATE.read_text())
    path = Path(state["dataDir"]).resolve()
    if path.parent != LOCAL.resolve() or not path.name.startswith("e2e-desktop."):
        raise FixtureError("Refusing state outside this fixture's .local/e2e-desktop.*/")
    return state


def request(origin, path, method="GET", body=None, token=None, timeout=3):
    headers = {"content-type": "application/json"}
    if token:
        headers["authorization"] = "Bearer " + token
    req = urllib.request.Request(
        origin + path,
        data=None if body is None else json.dumps(body).encode(),
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        # Do not echo response bodies: auth/device responses can contain secrets.
        raise FixtureError(f"{method} {path.split('?')[0]}: HTTP {error.code}") from None


def device_api(state, device, path, method="GET", body=None):
    return request(state["relayOrigin"], f"/relay/devices/{device['id']}/api{path}",
                   method, body, state["accountToken"])


def retry(check, label, deadline):
    while time.monotonic() < deadline:
        try:
            result = check()
            if result:
                return result
        except (OSError, FixtureError, ValueError):
            pass
        time.sleep(0.08)
    raise FixtureError(f"Timed out waiting for {label}. Inspect logs in the recorded dataDir.")


def identity(pid):
    # PID + birth time survives launcher execs (macOS Python changes executable)
    # while refusing a recycled PID. Each launch also owns a fresh session group.
    result = subprocess.run(["ps", "-p", str(pid), "-o", "lstart=", "-o", "stat="],
                            text=True, capture_output=True, check=False)
    parts = result.stdout.strip().rsplit(None, 1)
    return parts[0].strip() if result.returncode == 0 and len(parts) == 2 and not parts[1].startswith("Z") else ""


def alive(process):
    return bool(process and process.get("identity") and
                identity(process["pid"]) == process["identity"])


def stop_process(process):
    if not alive(process):
        return
    def send(signum):
        if os.getpgid(process["pid"]) == process["pid"]:
            os.killpg(process["pid"], signum)
        else:
            os.kill(process["pid"], signum)
    send(signal.SIGTERM)
    deadline = time.monotonic() + 3
    while alive(process) and time.monotonic() < deadline:
        time.sleep(0.04)
    if alive(process):
        send(signal.SIGKILL)


def clean_environment():
    # Strip inherited thread identities and supervisor paths before constructing
    # any process environment. Also clear legacy aliases used in local mode.
    return {key: value for key, value in os.environ.items()
            if not key.startswith(("REMOTE_CODEX_", "POCKYMOE_")) and
            key not in {"DATABASE_URL", "WORKSPACE_ROOT", "PORT", "HOST"}}


def launch(state, command, directory, extra, arguments=None, cwd=None):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    env = clean_environment()
    env.update({
        "HOST": "127.0.0.1",
        "POCKYMOE_ADMIN_USERNAME": "fixture-admin",
        "POCKYMOE_ADMIN_PASSWORD": PASSWORD,
        "POCKYMOE_SESSION_SECRET": "isolated-desktop-fixture-session-secret",
        "POCKYMOE_RELAY_SESSION_SECRET": "isolated-desktop-fixture-relay-secret",
        "POCKYMOE_E2E_FAKE_RUNTIME": "1",
        "POCKYMOE_ENABLED_AGENT_PROVIDERS": "codex,claude,acp",
    })
    env.update({key: str(value) for key, value in extra.items()})
    with (directory / "process.log").open("ab") as log:
        child = subprocess.Popen(arguments or [state["binary"], command], cwd=cwd or directory,
                                 env=env, stdin=subprocess.DEVNULL, stdout=log,
                                 stderr=log, start_new_session=True)
    birth = retry(lambda: identity(child.pid), command + " process", time.monotonic() + 1)
    return {"pid": child.pid, "identity": birth}


def launch_device(state, device):
    directory = Path(device["dataDir"])
    device["process"] = launch(state, "relay-supervisor", directory, {
        "PORT": device["port"],
        "POCKYMOE_MODE": "relay",
        "POCKYMOE_RELAY_SUPERVISOR_HOST": "127.0.0.1",
        "POCKYMOE_RELAY_SUPERVISOR_PORT": device["port"],
        "POCKYMOE_RELAY_SERVER_URL": state["relayOrigin"],
        "POCKYMOE_RELAY_AGENT_TOKEN": device["deviceToken"],
        "POCKYMOE_DATABASE_PATH": directory / "supervisor.sqlite",
        "POCKYMOE_WORKSPACE_ROOT": directory / "workspaces",
        "DATABASE_URL": directory / "supervisor.sqlite",
        "WORKSPACE_ROOT": directory / "workspaces",
    })


def prepare_web(codex, relay_origin, dev_web):
    if dev_web:
        return None, 0
    supplied = os.environ.get("DESKTOP_E2E_WEB_DIST")
    if supplied:
        output = Path(supplied).resolve()
        if not (output / "index.html").is_file():
            raise FixtureError(f"Missing static build: {output}/index.html")
        return output, 0
    fingerprint = hashlib.sha256(relay_origin.encode())
    # Only tracked product/build inputs; never inspect private env/config files.
    for repository, paths in [(codex, ["apps/supervisor-web", "packages", "themes", "pnpm-lock.yaml"]),
                              (codex / "pockymoe-thread-ui", ["packages/thread-ui"])]:
        for command in [["git", "rev-parse", "HEAD"], ["git", "diff", "--no-ext-diff", "HEAD", "--", *paths]]:
            result = subprocess.run(command, cwd=repository, capture_output=True, check=True)
            fingerprint.update(result.stdout)
    output = LOCAL / "e2e-desktop-web" / fingerprint.hexdigest()[:20]
    if (output / "index.html").is_file():
        return output, 0
    output.mkdir(parents=True, exist_ok=True)
    env = clean_environment()
    env.update({"VITE_POCKYMOE_RELAY_ORIGIN": relay_origin, "POCKYMOE_WEB_DOMAIN": "desktop.fixture.test"})
    began = time.monotonic()
    # Same static mode/artifacts as pages-deploy.yml, isolated outDir so another
    # engineer's apps/supervisor-web/dist is never overwritten by this fixture.
    with (output / "build.log").open("w") as log:
        result = subprocess.run(["pnpm", "--filter", "@pockymoe/supervisor-web", "build:static", "--outDir", str(output)],
                                cwd=codex, env=env, stdout=log, stderr=log, check=False)
    if result.returncode:
        raise FixtureError(f"Static web build failed; inspect {output}/build.log")
    return output, round(time.monotonic() - began, 3)


def launch_web(state):
    if state["webMode"] == "dev":
        args = ["node", str(Path(__file__).with_name("dev_server.mjs")), state["webRoot"], str(state["webPort"])]
        cwd = state["webRoot"]
    else:
        args = [sys.executable, str(Path(__file__).with_name("static_server.py")),
                "--directory", state["webDist"], "--port", str(state["webPort"])]
        cwd = None
    return launch(state, "web", Path(state["dataDir"]) / "web", {
        "VITE_POCKYMOE_RELAY_ORIGIN": state["relayOrigin"], "POCKYMOE_WEB_DOMAIN": "desktop.fixture.test",
    }, arguments=args, cwd=cwd)


def web_healthy(state):
    with urllib.request.urlopen(state["webOrigin"] + "/", timeout=1) as response:
        return b"<html" in response.read().lower()


def browser_command(state, command):
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    env = clean_environment()
    env["PLAYWRIGHT_NO_COPY_PROMPT"] = "1"
    result = subprocess.run(["node", str(Path(__file__).with_name("browser.mjs")), command, str(STATE)],
                            env=env, check=False)
    if result.returncode:
        raise FixtureError(f"Browser {command} failed; see {EVIDENCE}")


def assert_free(ports):
    if len(set(ports)) != len(ports) or 45679 in ports:
        raise FixtureError("Ports must be distinct and must never include the active host port 45679.")
    for port in ports:
        try:
            with socket.socket() as listener:
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                listener.bind(("127.0.0.1", port))
        except OSError:
            raise FixtureError(f"Port {port} is occupied; choose isolated DESKTOP_E2E_* ports.") from None


def export_env(state):
    write_json(ENV, {
        "webOrigin": state["webOrigin"], "webPort": state["webPort"], "webMode": state["webMode"],
        "relayOrigin": state["relayOrigin"], "relayUrl": state["relayOrigin"],
        "relayPort": state["relayPort"], "username": USERNAME, "password": PASSWORD,
        "dataDir": state["dataDir"], "seededAt": state["seededAt"],
        "accountId": state.get("accountId"),
        "devices": [{key: device[key] for key in
                     ("index", "id", "name", "port", "dataDir", "workspaces", "threads", "scenarios")}
                    for device in state["devices"]],
    })


def stop(state):
    for device in state["devices"]:
        stop_process(device.get("process"))
        device["process"] = None
    stop_process(state.get("webProcess"))
    state["webProcess"] = None
    stop_process(state.get("relayProcess"))
    state["relayProcess"] = None
    state["ready"] = False
    write_json(STATE, state)


def public_status(state):
    health = None
    if alive(state.get("relayProcess")):
        try:
            health = request(state["relayOrigin"], "/healthz", timeout=0.5)
        except (OSError, FixtureError, ValueError):
            pass
    return {
        "ready": bool(state.get("ready", False) and health and alive(state.get("webProcess")) and
                      all(not d.get("process") or alive(d["process"]) for d in state["devices"])),
        "webOrigin": state.get("webOrigin"), "webMode": state.get("webMode"),
        "webRunning": alive(state.get("webProcess")),
        "relayOrigin": state["relayOrigin"], "relayRunning": alive(state.get("relayProcess")),
        "connectedSupervisors": (health or {}).get("connectedSupervisors", 0),
        "dataDir": state["dataDir"], "startupSeconds": state.get("startupSeconds"), "webBuildSeconds": state.get("webBuildSeconds"),
        "devices": [{"index": d["index"], "id": d["id"], "name": d["name"],
                     "running": alive(d.get("process")), "threads": len(d.get("threads", [])),
                     "workspaces": len(d.get("workspaces", []))} for d in state["devices"]],
    }


def start(dev_web=False):
    started = time.monotonic()
    if STATE.exists():
        previous = read_state()
        if previous.get("fixtureVersion") == 2 and previous.get("ready") and alive(previous.get("relayProcess")):
            if previous["webMode"] != ("dev" if dev_web else "static"):
                raise FixtureError("Web mode differs from running fixture; stop before changing --dev-web.")
            # Preserve intentionally offline devices on an idempotent start.
            for device in previous["devices"]:
                if device.get("process") and not alive(device["process"]):
                    raise FixtureError("A recorded device exited unexpectedly; use start-device or stop/start.")
            status = public_status(previous)
            if not status["ready"]:
                raise FixtureError("Recorded fixture is unhealthy; inspect its logs or run stop/start.")
            print(json.dumps(status, ensure_ascii=False, indent=2))
            return previous
        stop(previous)
    codex = Path(os.environ.get("DESKTOP_E2E_POCKYMOE_ROOT", os.environ.get(
        "DESKTOP_E2E_CODEX_ROOT", str(ROOT.parent / "remoteCodex.worktrees/desktop")))).resolve()
    binary = Path(os.environ.get("DESKTOP_E2E_BIN", str(codex / "target/debug/pockymoe"))).resolve()
    # A peer may be linking the agreed binary. Wait, never build a substitute.
    retry(lambda: binary.is_file() and os.access(binary, os.X_OK), "existing debug binary", started + 10)
    port = int(os.environ.get("DESKTOP_E2E_RELAY_PORT", "18890"))
    first = int(os.environ.get("DESKTOP_E2E_SUPERVISOR_PORT", "18891"))
    web_port = int(os.environ.get("DESKTOP_E2E_WEB_PORT", "18894"))
    assert_free([port, web_port, first, first + 1, first + 2])
    web, build_seconds = prepare_web(codex, f"http://127.0.0.1:{port}", dev_web)
    started = time.monotonic()
    data = Path(tempfile.mkdtemp(prefix="e2e-desktop.", dir=LOCAL))
    os.chmod(data, 0o700)
    ENV.unlink(missing_ok=True)
    from seed import iso_now, seed_device, backdate_device
    state = {"fixtureVersion": 2, "webRoot": str(codex), "webOrigin": f"http://127.0.0.1:{web_port}",
             "webPort": web_port, "webMode": "dev" if dev_web else "static", "webBuildSeconds": build_seconds,
             "webDist": str(web) if web else None, "testAccount": {"username": USERNAME, "password": PASSWORD},
             "binary": str(binary), "dataDir": str(data), "relayOrigin": f"http://127.0.0.1:{port}",
             "relayPort": port, "devices": [], "seededAt": iso_now(), "ready": False}
    write_json(STATE, state)
    try:
        state["relayProcess"] = launch(state, "relay", data / "relay", {
            "PORT": port, "POCKYMOE_RELAY_DATA_DIR": data / "relay",
            "POCKYMOE_WEB_ORIGIN": state["webOrigin"],
            "POCKYMOE_RELAY_REGISTRATION_ENABLED": "true",
            "POCKYMOE_PUBLIC_BASE_URL": state["relayOrigin"],
        })
        write_json(STATE, state)
        retry(lambda: request(state["relayOrigin"], "/healthz"), "relay health", started + 15)
        state["webProcess"] = launch_web(state)
        write_json(STATE, state)
        retry(lambda: web_healthy(state), "separate web origin", started + 15)
        browser_command(state, "bootstrap")
        provision = json.loads((data / "account.json").read_text())
        state["accountToken"] = provision["token"]
        state["accountId"] = provision["accountId"]
        for index, name in enumerate(NAMES, 1):
            created = request(state["relayOrigin"], "/relay/devices", "POST", {"name": name}, state["accountToken"])
            device = {"index": index, "name": name, "id": created["device"]["id"],
                      "deviceToken": created["token"], "port": first + index - 1,
                      "dataDir": str(data / f"device-{index}"), "workspaces": [], "threads": [], "scenarios": {}}
            state["devices"].append(device)
            (Path(device["dataDir"]) / "workspaces").mkdir(parents=True)
            launch_device(state, device)
            write_json(STATE, state)
        for device in state["devices"]:
            retry(lambda: device_api(state, device, "/agent-runtimes"), device["name"] + " tunnel", started + 20)
        # Independent devices seed concurrently; a lineage's parents stay ordered.
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            futures = [pool.submit(seed_device, state, device, device_api) for device in state["devices"]]
            for future in futures:
                future.result()
        # Runtime API deliberately cannot set historical timestamps. Stop ONLY our
        # recorded supervisors before backdating their fresh fixture SQLite files.
        for device in state["devices"]:
            stop_process(device["process"])
        for device in state["devices"]:
            backdate_device(state, device)
            launch_device(state, device)
        write_json(STATE, state)
        for device in state["devices"]:
            retry(lambda: device_api(state, device, "/threads?includeAgentThreads=true"),
                  device["name"] + " seeded tunnel", started + 27)
        seed_live(state)
        state["ready"] = True
        state["startupSeconds"] = round(time.monotonic() - started, 3)
        write_json(STATE, state)
        export_env(state)
        print(json.dumps(public_status(state), ensure_ascii=False, indent=2))
        return state
    except BaseException:
        stop(state)
        print(f"Desktop fixture startup failed. Logs retained under {data}", file=sys.stderr)
        raise


def get_device(state, index):
    if index not in (1, 2, 3):
        raise FixtureError("deviceIdx must be 1, 2 or 3")
    return state["devices"][index - 1]


def trigger(state, device, thread_id, event):
    if not alive(device.get("process")):
        raise FixtureError(f"Device {device['index']} is stopped. Run start-device first.")
    if thread_id not in {thread["id"] for thread in device["threads"]}:
        raise FixtureError("Thread does not belong to this fixture device.")
    return device_api(state, device, "/e2e/events", "POST", {"type": event, "threadId": thread_id})


def seed_live(state, only=None):
    for device in state["devices"]:
        if only is not None and device["index"] != only:
            continue
        scenarios = device["scenarios"]
        for event, name in [("start", "running"), ("approval", "approval"), ("input", "input"), ("fail", "failed")]:
            tid = scenarios[name]
            detail = device_api(state, device, f"/threads/{tid}")
            if detail["thread"]["status"] == "recovering":
                # Use the public reconnect path to settle the fixture's previous
                # held turn. Recovery deliberately blocks new prompt delivery.
                device_api(state, device, f"/threads/{tid}/resume", "POST", {})
                def reconnected():
                    current = device_api(state, device, f"/threads/{tid}")
                    return current if current["thread"]["status"] != "recovering" else None
                detail = retry(reconnected, "reconnected scenario", time.monotonic() + 3)
            if event == "start" and detail["thread"]["status"] == "running":
                continue
            pending = detail.get("pendingRequests", [])
            if event in ("approval", "input") and any(
                    r["kind"] == ("requestUserInput" if event == "input" else "permissionRequest") for r in pending):
                continue
            if event == "fail" and detail["thread"]["status"] == "failed":
                continue
            trigger(state, device, scenarios[name], event)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="?", default="start", choices=[
        "start", "serve", "stop", "status", "env", "stop-device", "start-device", "complete", "fail",
        "request-approval", "request-input", "start-turn", "burst", "verify", "verify-api", "verify-browser"])
    parser.add_argument("arguments", nargs="*")
    parser.add_argument("--dev-web", action="store_true", help="run Vite instead of the static Pages build")
    args = parser.parse_args()
    expected = {"stop-device": 1, "start-device": 1, "complete": 2, "fail": 2,
                "request-approval": 2, "request-input": 2, "start-turn": 2, "burst": 1}.get(args.command, 0)
    if len(args.arguments) != expected:
        parser.error(f"{args.command} expects {expected} argument(s); see script usage")
    LOCAL.mkdir(exist_ok=True)
    os.umask(0o077)
    # Serialize lifecycle/control commands across independent test runners.
    with (LOCAL / "e2e-desktop.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.command in ("start", "serve"):
            state = start(args.dev_web)
        elif args.command == "status":
            print(json.dumps(public_status(read_state()) if STATE.exists() else {"ready": False},
                             ensure_ascii=False, indent=2))
        elif args.command == "stop":
            if STATE.exists():
                stop(read_state())
            print("Desktop fixture stopped; logs retained.")
        elif args.command == "env":
            if not ENV.exists():
                raise FixtureError("No environment file. Run start first.")
            print(ENV.read_text(), end="")
        elif args.command in ("start-device", "stop-device"):
            state = read_state()
            device = get_device(state, int(args.arguments[0]))
            if args.command == "stop-device":
                stop_process(device.get("process"))
                device["process"] = None
            elif not alive(device.get("process")):
                if not alive(state.get("relayProcess")):
                    raise FixtureError("Relay is stopped. Run start first.")
                assert_free([device["port"]])
                launch_device(state, device)
                write_json(STATE, state)
                retry(lambda: device_api(state, device, "/agent-runtimes"), "restarted device", time.monotonic() + 8)
            if args.command == "start-device":
                seed_live(state, device["index"])
            write_json(STATE, state)
            print(f"Device {device['index']} {'running' if alive(device.get('process')) else 'stopped'}.")
        elif args.command == "verify-browser":
            browser_command(read_state(), "verify")
        elif args.command in ("verify", "verify-api"):
            from verify import verify
            verify(read_state())
            if args.command == "verify":
                browser_command(read_state(), "verify")
        elif args.command == "burst":
            state = read_state()
            count = int(args.arguments[0])
            candidates = [(d, t["id"]) for d in state["devices"] if alive(d.get("process"))
                          for t in d["threads"] if t.get("burst") and t["id"] not in d["scenarios"].values()]
            if not 1 <= count <= len(candidates):
                raise FixtureError(f"burst N requires 1..{len(candidates)} (distinct idle fixture threads)")
            started = time.monotonic()
            with concurrent.futures.ThreadPoolExecutor(max_workers=min(count, 24)) as pool:
                futures = [pool.submit(trigger, state, d, tid, "complete") for d, tid in candidates[:count]]
                for future in futures:
                    future.result()
            elapsed = time.monotonic() - started
            if elapsed >= 1:
                raise FixtureError(f"{count} completions took {elapsed:.3f}s (expected <1s)")
            print(f"Completed {count} turns in {elapsed:.3f}s.")
        else:
            state = read_state()
            device = get_device(state, int(args.arguments[0]))
            event = {"complete": "complete", "fail": "fail", "request-approval": "approval",
                     "request-input": "input", "start-turn": "start"}[args.command]
            trigger(state, device, args.arguments[1], event)
            print(f"{args.command} delivered on device {device['index']}.")
        fcntl.flock(lock, fcntl.LOCK_UN)
    if args.command == "serve":
        def shutdown(_signum, _frame):
            raise KeyboardInterrupt
        signal.signal(signal.SIGTERM, shutdown)
        signal.signal(signal.SIGINT, shutdown)
        try:
            while alive(state.get("relayProcess")):
                time.sleep(0.5)
        except KeyboardInterrupt:
            pass
        finally:
            with (LOCAL / "e2e-desktop.lock").open("a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                current = read_state()
                if current["dataDir"] == state["dataDir"]:
                    stop(current)


if __name__ == "__main__":
    try:
        main()
    except (FixtureError, OSError, ValueError, KeyError) as error:
        print(f"desktop-fixture: {error}", file=sys.stderr)
        sys.exit(1)
