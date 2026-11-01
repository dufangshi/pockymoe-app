"""Focused HTTP/WS contract check, with no third-party Python dependencies."""

import base64
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import socket
import struct
import time
import urllib.request
from urllib.parse import urlsplit

from backend import EVIDENCE, FixtureError, device_api, request, trigger, write_json


class WebSocket:
    def __init__(self, url, token):
        parsed = urlsplit(url)
        self.socket = socket.create_connection((parsed.hostname, parsed.port), timeout=3)
        self.buffer = b""
        key = base64.b64encode(os.urandom(16)).decode()
        header = (f"GET {parsed.path} HTTP/1.1\r\nHost: {parsed.netloc}\r\n"
                  "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\n"
                  f"Sec-WebSocket-Key: {key}\r\nAuthorization: Bearer {token}\r\n\r\n")
        self.socket.sendall(header.encode())
        while b"\r\n\r\n" not in self.buffer:
            data = self.socket.recv(4096)
            if not data:
                raise FixtureError("WebSocket closed during handshake")
            self.buffer += data
        headers, self.buffer = self.buffer.split(b"\r\n\r\n", 1)
        if not headers.startswith(b"HTTP/1.1 101"):
            self.close()
            raise FixtureError("Device WebSocket upgrade failed")
        accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest())
        if b"sec-websocket-accept: " + accept.lower() not in headers.lower():
            raise FixtureError("Invalid WebSocket handshake accept key")

    def take(self, count):
        while len(self.buffer) < count:
            data = self.socket.recv(max(4096, count - len(self.buffer)))
            if not data:
                raise FixtureError("Device WebSocket unexpectedly closed")
            self.buffer += data
        result, self.buffer = self.buffer[:count], self.buffer[count:]
        return result

    def send(self, payload, opcode=1):
        mask = os.urandom(4)
        length = len(payload)
        header = bytes([0x80 | opcode])
        if length < 126:
            header += bytes([0x80 | length])
        elif length < 65536:
            header += bytes([0x80 | 126]) + struct.pack("!H", length)
        else:
            header += bytes([0x80 | 127]) + struct.pack("!Q", length)
        self.socket.sendall(header + mask + bytes(c ^ mask[i % 4] for i, c in enumerate(payload)))

    def receive(self):
        while True:
            first, second = self.take(2)
            opcode, length = first & 15, second & 127
            if length == 126:
                length = struct.unpack("!H", self.take(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", self.take(8))[0]
            mask = self.take(4) if second & 128 else None
            data = self.take(length)
            if mask:
                data = bytes(c ^ mask[i % 4] for i, c in enumerate(data))
            if opcode == 9:
                self.send(data, 10)
            elif opcode == 8:
                raise FixtureError("Device WebSocket sent close")
            elif opcode == 1:
                return json.loads(data)

    def until(self, event_type, thread_id=None, timeout=3):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.socket.settimeout(max(0.01, deadline - time.monotonic()))
            event = self.receive()
            if event.get("type") == event_type and (thread_id is None or event.get("threadId") == thread_id):
                return event
        raise FixtureError(f"Missing {event_type} via relay device /ws")

    def close(self):
        self.socket.close()


def verify(state):
    evidence = EVIDENCE
    evidence.mkdir(parents=True, exist_ok=True)
    token = state["accountToken"]
    session = request(state["relayOrigin"], "/relay/auth/session", token=token)
    assert session["authenticated"] and session["user"]["id"] == state["accountId"]
    assert state["webOrigin"] != state["relayOrigin"]
    with urllib.request.urlopen(state["webOrigin"] + "/devices/fixture/spa-fallback", timeout=3) as response:
        if b"<html" not in response.read().lower():
            raise FixtureError("Separate static web origin did not serve the SPA fallback")
    report = {"session": "vault account session passed", "webUi": "separate web origin + SPA fallback passed", "devices": []}
    sockets = []
    try:
        total = 0
        for device in state["devices"]:
            rows = device_api(state, device, "/threads?includeAgentThreads=true")
            workspaces = device_api(state, device, "/workspaces")
            assert len(rows) >= 50 and len(workspaces) >= 4
            assert max(t["lineageDepth"] for t in rows) == 3
            assert any(t.get("closedAt") for t in rows)
            assert any(t.get("isPinned") for t in rows)
            assert any(w.get("isFavorite") for w in workspaces)
            activity = device_api(state, device, "/thread-activity?hours=24")["threads"]
            heated = [row for row in activity if row["activeMs"] > 0]
            assert len(heated) >= 10 and max(row["turns"] for row in activity) >= 10
            assert len({row["activeMs"] // 600000 for row in heated}) >= 3
            timestamps = sorted(t["updatedAt"] for t in rows)
            total += len(rows)
            ws = WebSocket(state["relayOrigin"] + f"/relay/devices/{device['id']}/ws", token)
            sockets.append(ws)
            ws.send(json.dumps({"type": "supervisor.ping", "timestamp": "fixture-ready"}).encode())
            ws.until("supervisor.pong")
            tid = device["scenarios"]["events"]
            seen = []
            for event, observed in [("start", "thread.turn.started"), ("complete", "thread.turn.completed"),
                                    ("fail", "thread.turn.failed"), ("approval", "thread.request.created")]:
                trigger(state, device, tid, event)
                envelope = ws.until(observed, tid)
                seen.append(envelope["type"])
            detail = device_api(state, device, f"/threads/{tid}")
            pending = detail.get("pendingRequests", [])
            assert pending, "Approval must persist in thread detail, not only its event"
            request_id = pending[0]["id"]
            device_api(state, device, f"/threads/{tid}/requests/{request_id}/respond", "POST", {"allow": True})
            ws.until("thread.request.resolved", tid)
            trigger(state, device, tid, "input")
            ws.until("thread.request.created", tid)
            detail = device_api(state, device, f"/threads/{tid}")
            pending = detail.get("pendingRequests", [])
            assert len(pending) == 1 and pending[0]["kind"] == "requestUserInput"
            device_api(state, device, f"/threads/{tid}/requests/{pending[0]['id']}/respond", "POST",
                       {"answers": {"environment": "Staging"}})
            ws.until("thread.request.resolved", tid)
            assert not device_api(state, device, f"/threads/{tid}").get("pendingRequests")
            # Leave the verification thread completed, preserving seeded scenarios.
            trigger(state, device, tid, "complete")
            ws.until("thread.turn.completed", tid)
            for scenario in ("approval", "input"):
                detail = device_api(state, device, f"/threads/{device['scenarios'][scenario]}")
                assert detail.get("pendingRequests"), f"Missing seeded {scenario} request"
            report["devices"].append({"index": device["index"], "name": device["name"],
                                      "threadCount": len(rows), "workspaceCount": len(workspaces),
                                      "heatedThreads": len(heated), "maxTurns": max(row["turns"] for row in activity),
                                      "oldestUpdatedAt": timestamps[0], "newestUpdatedAt": timestamps[-1],
                                      "relayWsEvents": seen + ["thread.request.resolved", "thread.request.created (input)",
                                                               "thread.request.resolved (input)"],
                                      "pendingApprovalAndInput": True})
        assert total >= 240
        # One burst crosses all three device streams. Distinct thread identities
        # prove count and timing rather than counting unrelated traffic.
        # Round-robin to ensure each device receives burst events.
        pools = [[t["id"] for t in d["threads"] if t.get("burst") and t["id"] not in d["scenarios"].values()]
                 for d in state["devices"]]
        pairs = [(d, pools[i][n]) for n in range(6) for i, d in enumerate(state["devices"])]
        started = time.monotonic()
        with concurrent.futures.ThreadPoolExecutor(max_workers=18) as pool:
            futures = [pool.submit(trigger, state, d, tid, "complete") for d, tid in pairs]
            for future in futures:
                future.result()
        event_times = []
        for device, ws in zip(state["devices"], sockets):
            expected = {tid for d, tid in pairs if d["id"] == device["id"]}
            deadline = time.monotonic() + 3
            while expected:
                ws.socket.settimeout(max(0.01, deadline - time.monotonic()))
                event = ws.receive()
                if event.get("type") == "thread.turn.completed" and event.get("threadId") in expected:
                    expected.remove(event["threadId"])
                    event_times.append(event["timestamp"])
        elapsed = time.monotonic() - started
        from datetime import datetime
        dates = [datetime.fromisoformat(at.replace("Z", "+00:00")) for at in event_times]
        span = (max(dates) - min(dates)).total_seconds()
        assert len(dates) == 18 and span < 1 and elapsed < 1, "Burst must complete within 1s"
        report["burst"] = {"count": len(dates), "eventSpanSeconds": span, "observedSeconds": round(elapsed, 3)}
        report["totalThreads"] = total
        write_json(evidence / "verification.json", report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
    finally:
        for ws in sockets:
            ws.close()
