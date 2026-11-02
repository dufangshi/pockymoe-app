"""Create via HTTP; backdate history only while fixture supervisors are stopped."""

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3
import uuid

WORKSPACES = ["pockymoe", "支付与结算", "design-system", "mobile-client", "infra-archive", "研究笔记"]
TITLES = [
    "修复登录后设备列表偶发空白", "Reduce cold-start latency in the relay handshake",
    "给消息队列加上幂等重试与可观测性", "Review keyboard navigation and focus restoration",
    "Investigate flaky Windows path normalization", "重构多设备线程地图与离线缓存同步策略",
    "Add structured tracing to approval requests", "整理 API 错误码与中文排障文档",
    "Audit SQLite migrations for interrupted upgrades", "Complete accessibility pass for the thread map",
    "为跨设备线程地图实现稳定布局、局部缩放、超长中文标题截断和已关闭子 agent 的按需展示，并验证三套主题的浅色与深色模式",
    "Investigate a reconnect race when the laptop wakes from sleep while a delegated build task is waiting for approval",
]
DELEGATES = ["reviewer", "backend", "tests", "accessibility", "docs", "release"]


def iso_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def seed_device(state, device, api):
    for wi, label in enumerate(WORKSPACES):
        directory = Path(device["dataDir"]) / "workspaces" / label
        directory.mkdir(parents=True)
        (directory / "README.md").write_text(f"# {label}\n\nIsolated desktop E2E workspace.\n", encoding="utf-8")
        workspace = api(state, device, "/workspaces", "POST", {"absPath": str(directory), "label": label})
        device["workspaces"].append(workspace)
        if wi in (0, 2):
            api(state, device, f"/workspaces/{workspace['id']}/favorite", "POST", {"isFavorite": True})
        roots = []
        for ti in range(10):
            provider = ["codex", "claude", "acp"][(wi + ti + device["index"]) % 3]
            thread = api(state, device, "/threads/start", "POST", {
                "workspaceId": workspace["id"], "provider": provider, "agentId": provider,
                "model": "ios-e2e-stream", "approvalMode": "guarded",
                "title": TITLES[(ti + wi * 2 + device["index"] - 1) % len(TITLES)],
            })
            roots.append(thread)
            device["threads"].append({"id": thread["id"], "workspaceIndex": wi, "position": ti,
                                      "burst": wi < 4 and ti >= 4, "provider": provider})
        # One through six delegates per root; sixth workspace includes depth 3.
        previous = roots[0]["id"]
        for di in range(wi + 1):
            parent = previous if wi == 5 and di < 3 else roots[0]["id"]
            thread = api(state, device, "/threads/start", "POST", {
                "workspaceId": workspace["id"], "provider": "codex", "agentId": "codex",
                "model": "ios-e2e-stream", "approvalMode": "guarded", "parentThreadId": parent,
                "title": f"{DELEGATES[di]} · {TITLES[(wi + di) % len(TITLES)]}",
            })
            device["threads"].append({"id": thread["id"], "workspaceIndex": wi, "position": 10 + di,
                                      "agentName": DELEGATES[di], "closed": di % 3 == 1, "provider": "codex"})
            previous = thread["id"]
        if wi == 0:
            device["scenarios"] = {name: roots[index]["id"] for index, name in enumerate(
                ["running", "approval", "input", "events", "completed", "failed"])}


def backdate_device(state, device):
    directory = Path(device["dataDir"]).resolve()
    run = Path(state["dataDir"]).resolve()
    assert directory.parent == run and run.parent == Path(__file__).resolve().parents[2] / ".local"
    database = directory / "supervisor.sqlite"
    assert database.is_file() and not database.is_symlink()
    anchor = datetime.fromisoformat(state["seededAt"].replace("Z", "+00:00"))

    def at(days, seconds=0):
        return (anchor - timedelta(days=days, seconds=seconds)).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    with sqlite3.connect(database) as connection:
        # Current upstream's search triggers call these deterministic helpers.
        # Fixture messages are plain supervisor prose, never imported transcripts.
        connection.create_function("search_fold", 1, lambda text: text.lower(), deterministic=True)
        connection.create_function("search_body", 3, lambda text, kind, source: text or "", deterministic=True)
        for thread in device["threads"]:
            wi, position = thread["workspaceIndex"], thread["position"]
            # Last two workspaces are wholly inactive and unpinned (>14 days).
            days = (20 + (position * 4 + wi * 3) % 41) if wi >= 4 else [0.02, 0.08, 0.2, 0.5, 2, 6, 8, 13, 25, 60][position % 10]
            ended, started = at(days, position * 37), at(days, position * 37 + 130 + position * 11)
            failed = position == 5
            status = "failed" if failed else "completed"
            error = "Fixture: dependency registry unavailable; retry after reconnect." if failed else None
            prompt = "请检查相关代码，完成改动并运行有针对性的测试。"
            reply = error or "Implemented the change and verified the focused regression checks.\n已完成代码审查与验证。"
            pinned = wi < 4 and position in (0, 8)
            connection.execute(
                "UPDATE threads SET created_at=?,updated_at=?,last_turn_started_at=?,last_turn_completed_at=?,"
                "is_pinned=?,summary_text=?,last_error=?,status=?,agent_name=?,closed_at=? WHERE id=?",
                (at(75), ended, started, ended, int(pinned), reply, error, "idle" if not failed else "failed",
                 thread.get("agentName"), ended if thread.get("closed") else None, thread["id"]))
            usage = {"inputTokens": 1200 + position * 137, "outputTokens": 400 + wi * 93,
                     "totalTokens": 1600 + position * 137 + wi * 93, "cachedInputTokens": 256}
            turn_count = 1 + ((position * 3 + wi + device["index"]) % 9) * 2
            duration_seconds = [240, 1080, 4800, 12600, 16200][(position + wi) % 5]
            for ordinal in range(1, turn_count + 1):
                age_hours = (turn_count - ordinal) * (6 if wi < 4 else 18)
                turn_ended = at(days + age_hours / 24, position * 37)
                turn_started = at(days + age_hours / 24, position * 37 + duration_seconds)
                history_id = str(uuid.uuid5(uuid.NAMESPACE_URL, thread["id"] + f":history:{ordinal}"))
                last = ordinal == turn_count
                turn_status = status if last else "completed"
                turn_error = error if last else None
                turn_usage = {"total": {key: value * ordinal for key, value in usage.items()}}
                connection.execute(
                    "INSERT INTO thread_turns(id,thread_id,status,error,model,reasoning_effort,token_usage_json,"
                    "pricing_model_key,display_prompt,started_at,completed_at,ordinal) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                    (history_id, thread["id"], turn_status, turn_error, "ios-e2e-stream", "medium",
                     json.dumps(turn_usage), "gpt-5.4", prompt, turn_started, turn_ended, ordinal))
                for kind, text, timestamp in [("userMessage", prompt, turn_started), ("agentMessage", reply, turn_ended)]:
                    item_id = history_id + ":" + kind
                    item = {"id": item_id, "kind": kind, "text": text, "createdAt": timestamp,
                            "status": turn_status, "sourceTurnId": history_id}
                    connection.execute(
                        "INSERT INTO thread_history_items(id,thread_id,turn_id,item_id,item_json,created_at,updated_at) "
                        "VALUES(?,?,?,?,?,?,?)", (item_id, thread["id"], history_id, item_id, json.dumps(item), timestamp, timestamp))
            connection.execute("UPDATE threads SET last_turn_started_at=? WHERE id=?", (turn_started, thread["id"]))
        connection.execute("UPDATE workspaces SET created_at=?", (at(75),))
