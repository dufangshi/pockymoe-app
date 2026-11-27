#!/usr/bin/env python3
"""Release workflow gates, tested without building, reading signing keys or publishing."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
SPEC = importlib.util.spec_from_file_location('client_release_ci', Path(__file__).with_name('client_release_ci.py'))
ci = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ci)
release = ci.release
SHA = 'a' * 40
MAIN = {'GITHUB_REF': 'refs/heads/main', 'GITHUB_SHA': SHA}
BRANCH = {'GITHUB_REF': 'refs/heads/ci/client-release', 'GITHUB_SHA': SHA}
ALL_KEYS = {'CLIENT_ANDROID_KEYSTORE_BASE64': 'a2V5', 'CLIENT_ANDROID_STORE_PASSWORD': 'fixture-store',
            'CLIENT_MAC_SIGNING_P12_BASE64': 'cDEy', 'CLIENT_MAC_SIGNING_P12_PASSWORD': 'fixture-p12',
            'CLIENT_UPDATE_SIGNING_KEY_BASE64': 'a2V5'}


def quiet():
    return contextlib.redirect_stdout(io.StringIO())


class ChannelTests(unittest.TestCase):
    def test_release_key_channels_run_only_from_main(self):
        for channel in ('signed-dry-run', 'publish'):
            with self.subTest(channel=channel), patch.dict(os.environ, BRANCH), self.assertRaisesRegex(RuntimeError, 'only from main'):
                ci.channel_gate(channel)
            with patch.dict(os.environ, MAIN):
                ci.channel_gate(channel)
        with patch.dict(os.environ, BRANCH):
            ci.channel_gate('dry-run')
        with self.assertRaisesRegex(RuntimeError, 'Unknown channel'):
            ci.channel_gate('release')

    def test_dry_run_drops_every_secret_without_using_it(self):
        for platform in ('android', 'android-native', 'mac', 'publish', 'windows'):
            with self.subTest(platform=platform), patch.dict(os.environ, ALL_KEYS):
                self.assertEqual(ci.take_secrets(platform, 'dry-run'), {})
                self.assertFalse(any(name in os.environ for name in ALL_KEYS))

    def test_release_channels_fail_clearly_without_secrets(self):
        for platform, names in ci.REQUIRED.items():
            with self.subTest(platform=platform), patch.dict(os.environ, {}, clear=False):
                for name in ci.ALL_SECRETS:
                    os.environ.pop(name, None)
                with self.assertRaises(RuntimeError) as raised:
                    ci.take_secrets(platform, 'publish')
                for name in names:
                    self.assertIn(name, str(raised.exception))
                self.assertIn('nothing was signed or published', str(raised.exception))

    def test_release_channel_returns_only_its_own_secrets_and_clears_the_environment(self):
        with patch.dict(os.environ, ALL_KEYS):
            values = ci.take_secrets('mac', 'signed-dry-run')
            self.assertEqual(set(values), set(ci.SECRETS['mac']))
            self.assertFalse(any(name in os.environ for name in ALL_KEYS))

    def test_signing_kinds_follow_channel(self):
        self.assertEqual(ci.expected_signing('dry-run'), {'android': 'throwaway', 'mac': 'throwaway', 'windows': 'none', 'android-native': 'throwaway'})
        self.assertEqual(ci.expected_signing('publish'), {'android': 'release', 'mac': 'release', 'windows': 'none', 'android-native': 'release'})


class NotesTests(unittest.TestCase):
    def test_inline_or_repository_file_but_not_both(self):
        with patch.dict(os.environ, {'RELEASE_NOTES': 'Inline', 'RELEASE_NOTES_FILE': ''}):
            self.assertEqual(ci.notes_source(), 'Inline')
        with patch.dict(os.environ, {'RELEASE_NOTES': ' ', 'RELEASE_NOTES_FILE': ''}):
            self.assertIsNone(ci.notes_source())
        with patch.dict(os.environ, {'RELEASE_NOTES': '', 'RELEASE_NOTES_FILE': 'desktop/release-notes-template.md'}):
            self.assertIn('{version}', ci.notes_source())
        for name in ('../outside.md', '/etc/hostname', 'missing.md', 'desktop'):
            with self.subTest(name=name), patch.dict(os.environ, {'RELEASE_NOTES': '', 'RELEASE_NOTES_FILE': name}):
                with self.assertRaisesRegex(RuntimeError, 'inside the repository'):
                    ci.notes_source()
        with patch.dict(os.environ, {'RELEASE_NOTES': 'Inline', 'RELEASE_NOTES_FILE': 'README.md'}):
            with self.assertRaisesRegex(RuntimeError, 'not both'):
                ci.notes_source()


class PrepareTests(unittest.TestCase):
    def prepare(self, channel, env=MAIN, notes='Notes', exists=False, tip=SHA, override=''):
        args = type('Args', (), {'version': '1.2.3', 'channel': channel})
        values = {**env, 'RELEASE_NOTES': notes, 'RELEASE_NOTES_FILE': '', 'ALLOW_UNCHECKED_CI': override}
        with patch.dict(os.environ, values), patch.object(release, 'versions', return_value=8), \
                patch.object(ci, 'clean_commit', return_value=SHA), patch.object(ci, 'release_exists', return_value=exists), \
                patch.object(ci, 'main_tip', return_value=tip) as main_tip, patch.object(ci, 'require_aggregate') as aggregate, \
                patch.object(ci, 'outputs') as outputs, patch.object(ci, 'summary'), quiet():
            ci.prepare(args)
        return main_tip, aggregate, outputs

    def test_dry_run_from_a_branch_needs_no_aggregate_or_notes_and_may_rebuild_a_release(self):
        main_tip, aggregate, outputs = self.prepare('dry-run', env=BRANCH, notes='', exists=True)
        main_tip.assert_not_called()
        aggregate.assert_not_called()
        outputs.assert_called_once_with(sha=SHA, version_code=8, signing='throwaway')

    def test_publish_requires_aggregate_on_the_dispatched_main_tip(self):
        _, aggregate, outputs = self.prepare('publish')
        aggregate.assert_called_once_with(release.REPO, SHA, None)
        outputs.assert_called_once_with(sha=SHA, version_code=8, signing='release')
        _, aggregate, _ = self.prepare('publish', override='incident')
        aggregate.assert_called_once_with(release.REPO, SHA, 'incident')

    def test_publish_refusals(self):
        for kwargs, message in [({'env': BRANCH}, 'only from main'), ({'notes': ''}, 'requires notes'),
                                ({'exists': True}, 'immutable'), ({'tip': 'b' * 40}, 'main moved')]:
            with self.subTest(kwargs=kwargs), self.assertRaisesRegex(RuntimeError, message):
                self.prepare('publish', **kwargs)

    def test_signed_dry_run_needs_main_tip_but_no_aggregate(self):
        main_tip, aggregate, _ = self.prepare('signed-dry-run', notes='', exists=True)
        main_tip.assert_called_once()
        aggregate.assert_not_called()
        with self.assertRaisesRegex(RuntimeError, 'only to channel publish'):
            self.prepare('signed-dry-run', override='incident')


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pockymoe-release-ci-unit-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def job_outputs(self, signing='throwaway', commit=SHA, tamper=None):
        inputs = self.root / 'inputs'
        for platform, name in zip(ci.PLATFORMS, release.release_assets('1.2.3')):
            out = inputs / f'client-{platform}'
            out.mkdir(parents=True)
            (out / name).write_bytes(f'{platform}-bytes'.encode())
            kind = 'none' if platform == 'windows' else signing
            with patch.dict(os.environ, {'GITHUB_SHA': commit}), patch.object(ci, 'summary'):
                ci.write_manifest(out, platform, '1.2.3', out / name, kind)
            if tamper == platform:
                (out / name).write_bytes(b'tampered')
        return inputs

    def collect(self, channel, inputs):
        folder = self.root / 'assets'
        folder.mkdir()
        with patch.dict(os.environ, {'GITHUB_SHA': SHA}):
            return ci.collect(channel, '1.2.3', inputs, folder), folder

    def test_collects_exactly_four_verified_files(self):
        manifests, folder = self.collect('dry-run', self.job_outputs())
        self.assertEqual(sorted(p.name for p in folder.iterdir()), sorted(release.release_assets('1.2.3')))
        self.assertEqual(set(manifests), set(ci.PLATFORMS))

    def test_rejects_changed_bytes_other_commits_and_throwaway_signing_for_release(self):
        for kwargs, channel, message in [({'tamper': 'mac'}, 'dry-run', 'differs from the bytes'),
                                         ({'commit': 'b' * 40}, 'dry-run', 'does not match this run'),
                                         ({}, 'publish', 'does not match this run'),
                                         ({'signing': 'release'}, 'dry-run', 'does not match this run')]:
            with self.subTest(kwargs=kwargs, channel=channel):
                inputs = self.job_outputs(**kwargs)
                with self.assertRaisesRegex(RuntimeError, message):
                    self.collect(channel, inputs)
                for path in sorted(self.root.rglob('*'), reverse=True):
                    path.unlink() if path.is_file() else path.rmdir()

    def publish(self, channel, created=None, env=MAIN):
        bundle = self.root / 'bundle'
        inputs = self.job_outputs(signing='release')
        (bundle / 'assets').mkdir(parents=True)
        with patch.dict(os.environ, {'GITHUB_SHA': SHA}):
            manifests = ci.collect('publish', '1.2.3', inputs, bundle / 'assets')
        (bundle / 'manifests').mkdir()
        for platform, data in manifests.items():
            (bundle / 'manifests' / f'{platform}.json').write_text(json.dumps(data))
        calls, keys = [], []

        def write_notes(version, folder, notes, source, *, production):
            self.assertTrue(production)
            key = Path(os.environ['POCKYMOE_UPDATE_PRIVATE_KEY_FILE'])
            keys.append(key)
            self.assertEqual(key.stat().st_mode & 0o077, 0)
            notes.write_text(source + '\n<!-- pockymoe-updates-v1\n[]\n-->\n')

        args = type('Args', (), {'version': '1.2.3', 'channel': channel, 'bundle': bundle, 'work': self.root / 'work'})
        values = {**env, **ALL_KEYS, 'RELEASE_NOTES': 'Notes', 'RELEASE_NOTES_FILE': '', 'ALLOW_UNCHECKED_CI': ''}
        with patch.dict(os.environ, values), patch.object(release, 'versions', return_value=8), \
                patch.object(ci, 'clean_commit', return_value=SHA), patch.object(ci, 'main_contains', return_value=True), \
                patch.object(ci, 'release_exists', return_value=False), patch.object(ci, 'require_aggregate') as aggregate, \
                patch.object(release, 'write_release_notes', side_effect=write_notes), \
                patch.object(release, 'run', side_effect=lambda *a, **k: calls.append(a)), patch.object(ci, 'summary'), quiet():
            ci.publish(args)
        for key in keys:
            self.assertFalse(key.exists(), 'Release metadata key must be deleted after signing')
        return calls, aggregate

    def test_signed_dry_run_signs_with_release_key_but_never_creates_a_release(self):
        calls, aggregate = self.publish('signed-dry-run')
        self.assertEqual(calls, [])
        aggregate.assert_not_called()

    def test_publish_creates_latest_release_at_the_commit_with_four_assets(self):
        calls, aggregate = self.publish('publish')
        aggregate.assert_called_once_with(release.REPO, SHA, None)
        self.assertEqual(len(calls), 1)
        command = calls[0]
        self.assertEqual(command[:4], ('gh', 'release', 'create', 'v1.2.3'))
        self.assertEqual(command[command.index('--target') + 1], SHA)
        self.assertIn('--latest', command)
        self.assertEqual([Path(arg).name for arg in command[-4:]], release.release_assets('1.2.3'))

    def test_dry_run_or_branch_can_never_publish(self):
        with self.assertRaisesRegex(RuntimeError, 'Only signed-dry-run and publish'):
            self.publish('dry-run')
        for path in sorted(self.root.rglob('*'), reverse=True):
            path.unlink() if path.is_file() else path.rmdir()
        with self.assertRaisesRegex(RuntimeError, 'only from main'):
            self.publish('publish', env=BRANCH)


class SecretFileTests(unittest.TestCase):
    def test_decoded_secret_files_are_private_and_never_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = ci.write_private(Path(temporary) / 'keys/key.pem', ci.decode('FIXTURE', 'a2V5\n'))
            self.assertEqual(path.read_bytes(), b'key')
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                ci.write_private(path, b'other')
        with self.assertRaisesRegex(RuntimeError, 'FIXTURE is not valid base64') as raised:
            ci.decode('FIXTURE', 'not base64!')
        self.assertNotIn('not base64!', str(raised.exception))


class MetadataSignerGateTests(unittest.TestCase):
    def test_ci_gate_refuses_other_refs_and_commits_before_reading_the_release_key(self):
        tool = Path(__file__).with_name('update-signatures.cjs').resolve()
        with tempfile.TemporaryDirectory(prefix='pockymoe-signer-gate-') as temporary:
            root = Path(temporary)
            folder = root / 'assets'
            folder.mkdir()
            for name in release.asset_names('0.3.0'):
                (folder / name).write_bytes(b'disposable-artifact')
            marker = root / 'key-accessed'
            key = root / 'client-update-ed25519.pem'
            trap = root / 'forbid-key.cjs'
            trap.write_text("const fs=require('node:fs');\n" +
                            "for(const method of ['readFileSync','statSync','existsSync']){const original=fs[method];fs[method]=function(file,...args){if(String(file).endsWith('client-update-ed25519.pem')){fs.writeFileSync(" + json.dumps(str(marker)) + ",method);throw new Error('forbidden');}return original.call(this,file,...args);};}\n")
            head = subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True, cwd=Path(__file__).parent).stdout.strip()
            for ref, sha in [('refs/heads/ci/client-release', head), ('refs/heads/main', 'b' * 40)]:
                env = {**os.environ, 'GITHUB_ACTIONS': 'true', 'GITHUB_REF': ref, 'GITHUB_SHA': sha,
                       'POCKYMOE_UPDATE_PRIVATE_KEY_FILE': str(key)}
                result = subprocess.run(['node', '--require', str(trap), str(tool), 'sign', '0.3.0', str(folder),
                                         str(root / f'notes-{sha[:4]}.md'), '--publish'], capture_output=True, env=env)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(marker.exists(), 'CI gate must precede release key access')


if __name__ == '__main__':
    unittest.main()
