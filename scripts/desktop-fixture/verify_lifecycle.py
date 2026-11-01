"""CLI regression: preserve identities, toggle device 3, restore its live requests."""

import json
from pathlib import Path
import subprocess

from backend import ROOT, device_api, read_state, request, retry, write_json
from verify import WebSocket


def main():
    script = str(ROOT / "scripts/e2e-desktop-backend.sh")
    report = {}

    def run(*arguments):
        result = subprocess.run([script, *arguments], text=True, capture_output=True, check=True)
        return result.stdout

    before = read_state()
    json.loads(run("start"))
    after = read_state()
    assert before["dataDir"] == after["dataDir"]
    assert before["relayProcess"] == after["relayProcess"]
    assert before["webProcess"] == after["webProcess"]
    assert [d["process"] for d in before["devices"]] == [d["process"] for d in after["devices"]]
    report["idempotentStart"] = "same data directory and all five process identities"
    env = json.loads(run("env"))
    assert env["username"] == "desktop" and env["password"]
    assert len(env["devices"]) == 3 and "accountToken" not in env
    assert all("deviceToken" not in d for d in env["devices"])
    report["env"] = "valid test account / origin / IDs; excludes provisioning tokens"
    for command in ["start-turn", "complete", "fail", "request-approval", "request-input", "complete"]:
        run(command, "1", before["devices"][0]["scenarios"]["events"])
    report["eventCommands"] = "all CLI control types passed"
    report["burstCommand"] = run("burst", "18").strip()
    third = before["devices"][2]
    try:
        run("stop-device", "3")

        def offline():
            presence = request(before["relayOrigin"], "/relay/devices", token=before["accountToken"])
            devices = presence if isinstance(presence, list) else presence["devices"]
            return not next(d for d in devices if d["id"] == third["id"])["connected"]

        import time
        retry(offline, "relay offline presence", time.monotonic() + 3)
        for device in before["devices"][:2]:
            assert len(device_api(before, device, "/threads?includeAgentThreads=true")) == 81
        report["offline"] = "device 3 disconnected in relay; devices 1 and 2 healthy"
        assert json.loads(run("start"))["devices"][2]["running"] is False
        report["offlineIdempotentStart"] = "intentional offline state preserved"
    finally:
        run("start-device", "3")
    after = read_state()
    third = after["devices"][2]
    assert third["id"] == before["devices"][2]["id"]
    assert len(device_api(after, third, "/threads?includeAgentThreads=true")) == 81
    ws = WebSocket(after["relayOrigin"] + f"/relay/devices/{third['id']}/ws", after["accountToken"])
    try:
        ws.send(json.dumps({"type": "supervisor.ping"}).encode())
        ws.until("supervisor.pong")
    finally:
        ws.close()
    for name in ("approval", "input"):
        assert device_api(after, third, f"/threads/{third['scenarios'][name]}")["pendingRequests"]
    assert json.loads(run("status"))["connectedSupervisors"] == 3
    report["restart"] = "same device ID, 81 threads, restored pending requests and working /ws"
    write_json(Path("/tmp/rc-desktop/evidence/fixture/v2/lifecycle.json"), report)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
