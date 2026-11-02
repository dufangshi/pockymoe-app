"""Regression checks for the fixture's production-isolation boundary."""

import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import backend
import processes


class IsolationTests(unittest.TestCase):
    def test_inherited_managed_thread_settings_are_removed(self):
        inherited = {"REMOTE_CODEX_DATABASE_PATH": "/production.sqlite",
                     "REMOTE_CODEX_RELAY_AGENT_TOKEN": "not-a-real-token",
                     "POCKYMOE_DATABASE_PATH": "/production-pockymoe.sqlite",
                     "POCKYMOE_RELAY_SERVER_URL": "https://production.invalid",
                     "POCKYMOE_THREAD_ID": "production-thread", "DATABASE_URL": "/legacy.sqlite",
                     "WORKSPACE_ROOT": "/production", "PORT": "45679", "HOST": "0.0.0.0",
                     "PATH": "/bin", "HOME": "/unchanged"}
        with patch.dict(os.environ, inherited, clear=True):
            self.assertEqual(backend.clean_environment(), {"PATH": "/bin", "HOME": "/unchanged"})

    def test_active_host_port_cannot_be_used(self):
        with self.assertRaisesRegex(backend.FixtureError, "45679"):
            backend.assert_free([45679, 18901, 18902, 18903])

    def test_reused_pid_is_not_signalled(self):
        with patch.object(processes, "identity", return_value="different birth time"), patch.object(os, "kill") as kill:
            backend.stop_process({"pid": 12345, "identity": "original process birth time"})
            kill.assert_not_called()

    def test_state_cannot_point_at_production_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp) / "state.json"
            state.write_text(json.dumps({"dataDir": "/production/supervisor"}))
            with patch.object(backend, "STATE", state):
                with self.assertRaisesRegex(backend.FixtureError, "Refusing state"):
                    backend.read_state()

    def test_json_files_are_private_and_atomic(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.json"
            backend.write_json(path, {"hello": "世界"})
            if os.name != "nt":
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(path.read_text()), {"hello": "世界"})
            self.assertFalse(path.with_suffix(".tmp").exists())

    @unittest.skipIf(os.name == "nt", "Unix ps parser; Windows uses creation FILETIME")
    def test_process_identity_survives_launcher_exec_and_ignores_zombies(self):
        from types import SimpleNamespace
        output = SimpleNamespace(returncode=0, stdout="Sun Nov  1 02:17:23 2026 S\n")
        with patch.object(backend.subprocess, "run", return_value=output):
            original = backend.identity(12345)
            output.stdout = "Sun Nov  1 02:17:23 2026 R+\n"
            self.assertEqual(backend.identity(12345), original)
            output.stdout = "Sun Nov  1 02:17:23 2026 Z\n"
            self.assertEqual(backend.identity(12345), "")

    @unittest.skipIf(os.name == "nt", "Atomic Web rebuild is Mac/Linux-only; release Web startup is separate")
    def test_rebuild_swaps_whole_artifact_and_retains_old_lazy_chunks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "e2e-desktop-web" / "served"
            (target / "assets").mkdir(parents=True)
            (target / "index.html").write_text("old entry")
            (target / "assets" / "old-hash.js").write_text("old lazy chunk")
            run = root / "run"
            (run / "web").mkdir(parents=True)
            state = {"webMode": "static", "webProcess": {}, "webDist": str(target),
                     "dataDir": str(run), "webRoot": str(root), "relayOrigin": "http://127.0.0.1:18890"}

            def build(_root, origin, output):
                (output / "index.html").write_text("new entry " + origin)
                (output / "404.html").write_text("new entry " + origin)
                (output / "relayServiceWorker.js").write_text("new worker")

            with patch.object(backend, "LOCAL", root), patch.object(backend, "STATE", root / "state.json"), \
                    patch.object(backend, "alive", return_value=True), patch.object(backend, "build_static_web", side_effect=build):
                result = backend.rebuild_web(state)
            self.assertEqual(set(result), {"path", "durationSeconds"})
            self.assertEqual((target / "index.html").read_text(), "new entry " + state["relayOrigin"])
            self.assertEqual((target / "assets" / "old-hash.js").read_text(), "old lazy chunk")
            self.assertEqual((Path(state["previousWebDist"]) / "index.html").read_text(), "old entry")

    def test_failed_rebuild_keeps_served_artifact(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "e2e-desktop-web" / "served"
            target.mkdir(parents=True)
            (target / "index.html").write_text("old entry")
            (root / "run" / "web").mkdir(parents=True)
            state = {"webMode": "static", "webProcess": {}, "webDist": str(target),
                     "dataDir": str(root / "run"), "webRoot": str(root), "relayOrigin": "http://127.0.0.1:18890"}
            with patch.object(backend, "LOCAL", root), patch.object(backend, "alive", return_value=True), \
                    patch.object(backend, "build_static_web", side_effect=backend.FixtureError("failed")):
                with self.assertRaisesRegex(backend.FixtureError, "failed"):
                    backend.rebuild_web(state)
            self.assertEqual((target / "index.html").read_text(), "old entry")


if __name__ == "__main__":
    unittest.main()


class OwnedProcessTests(unittest.TestCase):
    def test_identity_and_cleanup_of_only_our_child(self):
        import subprocess
        import sys
        import time
        child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])
        try:
            deadline = time.monotonic() + 3
            birth = processes.identity(child.pid)
            while not birth and time.monotonic() < deadline:
                time.sleep(.01)
                birth = processes.identity(child.pid)
            self.assertTrue(birth)
            owned = {"pid": child.pid, "identity": birth}
            self.assertTrue(processes.alive(owned))
            self.assertFalse(processes.alive({"pid": child.pid, "identity": "different birth"}))
            processes.stop_process(owned)
            child.wait(timeout=5)
            self.assertFalse(processes.alive(owned))
        finally:
            if child.poll() is None:
                child.terminate(); child.wait(timeout=5)

    def test_windows_rebuild_reports_supported_platform_requirement(self):
        with patch.object(backend.sys, 'platform', 'win32'):
            with self.assertRaisesRegex(backend.FixtureError, 'macOS or Linux'):
                backend.exchange_directories(Path('first'), Path('second'))
