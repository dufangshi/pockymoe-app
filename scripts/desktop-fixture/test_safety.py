"""Regression checks for the fixture's production-isolation boundary."""

import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import backend


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
        with patch.object(backend, "identity", return_value="different birth time"), patch.object(os, "kill") as kill:
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
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(path.read_text()), {"hello": "世界"})
            self.assertFalse(path.with_suffix(".tmp").exists())

    def test_process_identity_survives_launcher_exec_and_ignores_zombies(self):
        from types import SimpleNamespace
        output = SimpleNamespace(returncode=0, stdout="Sun Nov  1 02:17:23 2026 S\n")
        with patch.object(backend.subprocess, "run", return_value=output):
            original = backend.identity(12345)
            output.stdout = "Sun Nov  1 02:17:23 2026 R+\n"
            self.assertEqual(backend.identity(12345), original)
            output.stdout = "Sun Nov  1 02:17:23 2026 Z\n"
            self.assertEqual(backend.identity(12345), "")


if __name__ == "__main__":
    unittest.main()
