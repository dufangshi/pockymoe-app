#!/usr/bin/env python3
"""Release gates tested without building, reading signing keys, or publishing."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('release_client', Path(__file__).with_name('release_client.py'))
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)
SHA = 'a' * 40
OTHER_SHA = 'b' * 40


class SourceGateTests(unittest.TestCase):
    def gate(self, dirty='', branch='main', head=SHA, origin=SHA, validation=False):
        values = {('status', '--porcelain'): dirty, ('branch', '--show-current'): branch,
                  ('rev-parse', 'HEAD'): head, ('rev-parse', 'origin/main'): origin}
        with patch.object(release, 'git', side_effect=lambda *args: values[args]), patch.object(release, 'run') as run:
            result = release.source_gate(validation)
        return result, run

    def test_clean_main_must_match_freshly_fetched_origin(self):
        result, run = self.gate()
        self.assertEqual(result, SHA)
        run.assert_called_once_with('git', 'fetch', 'origin', 'main')

    def test_dirty_checkout_is_rejected_before_fetch(self):
        with patch.object(release, 'git', return_value='?? untracked'), patch.object(release, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'clean checkout'):
                release.source_gate()
            run.assert_not_called()

    def test_release_rejects_branch_and_outdated_main(self):
        for kwargs, message in [({'branch': 'feat/candidate'}, 'require main'), ({'origin': OTHER_SHA}, 'match freshly fetched')]:
            with self.subTest(kwargs=kwargs), self.assertRaisesRegex(RuntimeError, message):
                self.gate(**kwargs)

    def test_validation_only_skips_main_origin_check(self):
        result, run = self.gate(branch='feat/candidate', validation=True)
        self.assertEqual(result, SHA)
        run.assert_not_called()
        with self.assertRaisesRegex(RuntimeError, 'clean checkout'):
            self.gate(dirty=' M tracked', validation=True)


class ArtifactGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pockymoe-release-unit-')
        self.root = Path(self.temp.name)
        self.desktop = self.root / 'desktop'
        self.desktop.mkdir()
        (self.root / 'android/app').mkdir(parents=True)
        self.patches = [patch.object(release, 'ROOT', self.root), patch.object(release, 'DESKTOP', self.desktop)]
        for item in self.patches:
            item.start()
        self.addCleanup(self.temp.cleanup)
        for item in self.patches:
            self.addCleanup(item.stop)
        self.write_versions()

    def write_versions(self, desktop='1.2.3', android='1.2.3', code=8):
        (self.desktop / 'package.json').write_text(json.dumps({'version': desktop}))
        (self.root / 'android/app/build.gradle.kts').write_text(f'versionName = "{android}"\nversionCode = {code}\n')

    def test_versions_agree_and_returns_android_code(self):
        self.assertEqual(release.versions('1.2.3'), 8)
        for invalid in ['v1.2.3', '1.2.3-beta.1', '01.2.3', '1.2', '1.2.4']:
            with self.subTest(version=invalid), self.assertRaises(RuntimeError):
                release.versions(invalid)
        self.write_versions(android='1.2.2')
        with self.assertRaisesRegex(RuntimeError, 'must agree'):
            release.versions('1.2.3')

    def test_exact_three_named_regular_files_only(self):
        output = self.root / 'output'
        output.mkdir()
        names = release.asset_names('1.2.3')
        self.assertEqual(names, ['Pockymoe-1.2.3-android.apk', 'Pockymoe-1.2.3-mac-arm64.dmg', 'Pockymoe-1.2.3-win-x64.exe'])
        for name in names:
            (output / name).write_bytes(b'fixture')
        release.exact_output(output, '1.2.3')
        for extra in ['latest.yml', 'Pockymoe-1.2.3-win-x64.exe.blockmap', '.hidden']:
            (output / extra).touch()
            with self.assertRaisesRegex(RuntimeError, 'exactly the three'):
                release.exact_output(output, '1.2.3')
            (output / extra).unlink()
        target = output / names[0]
        target.unlink()
        with self.assertRaises(RuntimeError):
            release.exact_output(output, '1.2.3')
        target.mkdir()
        with self.assertRaises(RuntimeError):
            release.exact_output(output, '1.2.3')
        target.rmdir()
        source = self.root / 'external'
        source.write_bytes(b'fixture')
        target.symlink_to(source)
        with self.assertRaises(RuntimeError):
            release.exact_output(output, '1.2.3')

    def test_version_code_must_exceed_previous_public_apk(self):
        def run(*args, **_kwargs):
            if args[:3] == ('gh', 'release', 'view'):
                return json.dumps({'tagName': 'v1.2.2', 'assets': [{'name': 'Pockymoe-1.2.2-android.apk'}]}).encode()
            if args[1:3] == ('dump', 'badging'):
                return b"package: name='fixture' versionCode='7' versionName='1.2.2'"
            return b''
        with patch.object(release, 'run', side_effect=run), patch.object(release, 'sdk_tool', return_value='/fixture/aapt'), contextlib.redirect_stdout(io.StringIO()):
            for code in [6, 7, 8]:
                work = self.root / f'work-{code}'
                work.mkdir()
                if code <= 7:
                    with self.assertRaisesRegex(RuntimeError, 'must rise'):
                        release.previous_apk(work, code)
                else:
                    self.assertEqual(release.previous_apk(work, code).name, 'Pockymoe-1.2.2-android.apk')

    def test_public_build_strips_fixture_feed_and_signing_environment(self):
        class StopAfterBuildEnvironment(Exception):
            pass

        inherited = {'POCKYMOE_UPDATER_TEST_BUILD': '1', 'POCKYMOE_UPDATER_TEST_FEED': 'http://fixture.invalid/latest',
                     'POCKYMOE_UPDATER_TEST_PUBLIC_KEY': '/fixture/public.pem', 'CSC_NAME': 'Fixture signer',
                     'APPLE_ID': 'fixture@example.invalid', 'WIN_CSC_LINK': '/fixture/signing.p12'}
        captured = []

        def run(*args, **kwargs):
            if args == ('pnpm', 'build'):
                captured.append(kwargs['env'])
                raise StopAfterBuildEnvironment()
            return b''

        with patch.dict(release.os.environ, inherited), patch.object(release, 'previous_apk', return_value=None), patch.object(release, 'run', side_effect=run):
            with self.assertRaises(StopAfterBuildEnvironment):
                release.build('1.2.3', 8, self.root / 'output', self.root / 'work')
        self.assertEqual(len(captured), 1)
        for key in inherited:
            self.assertNotIn(key, captured[0])
        self.assertEqual(captured[0]['CSC_IDENTITY_AUTO_DISCOVERY'], 'false')

    def test_signer_details_are_captured_and_only_digest_is_returned(self):
        output = b'Signer #1 certificate DN: CN=Fixture only\nSigner #1 certificate SHA-256 digest: ' + b'c' * 64 + b'\n'
        with patch.object(release, 'sdk_tool', return_value='/fixture/apksigner'), patch.object(release, 'run', return_value=output) as run:
            with contextlib.redirect_stdout(io.StringIO()) as printed:
                self.assertEqual(release.apk_certificate(self.root / 'fixture.apk'), ['c' * 64])
            self.assertEqual(printed.getvalue(), '')
            self.assertTrue(run.call_args.kwargs['capture'])


class CommandTests(unittest.TestCase):
    def invoke(self, arguments, *, changed_source=False):
        with tempfile.TemporaryDirectory(prefix='pockymoe-release-command-') as temporary:
            root = Path(temporary)
            output = root / 'output'
            notes = root / 'notes.md'
            notes.write_text('Reviewed notes\n\n<!-- pockymoe-updates-v1\nold\n-->\n')
            calls = []

            def build(version, _code, folder, _work):
                for name in release.asset_names(version):
                    (folder / name).write_bytes(b'fixture')

            def run(*args, **kwargs):
                calls.append(args)
                if args[:2] == ('node', release.ROOT / 'scripts/update-signatures.cjs'):
                    Path(args[-1]).write_text('<!-- pockymoe-updates-v1\n[{"signature":"fixture-signature"}]\n-->\n')
                return b''

            argv = ['release-client.sh', '1.2.3', '--output', str(output), '--notes-file', str(notes), *arguments]
            source = [SHA, OTHER_SHA] if changed_source else [SHA, SHA]
            with patch('sys.argv', argv), patch.object(release.platform, 'system', return_value='Darwin'), patch.object(release.platform, 'machine', return_value='arm64'), patch.object(release, 'source_gate', side_effect=source) as gate, patch.object(release, 'versions', return_value=8), patch.object(release, 'build', side_effect=build), patch.object(release, 'run', side_effect=run), patch.object(release, 'scan') as scan, contextlib.redirect_stdout(io.StringIO()):
                release.main()
            prepared = (root / '1.2.3-release-notes.md').read_text()
            return prepared, calls, gate.call_args_list, scan.call_args_list

    def test_validation_prepares_one_signed_comment_outside_three_file_folder(self):
        prepared, calls, gates, scans = self.invoke(['--validate'])
        self.assertEqual(prepared.count('<!-- pockymoe-updates-v1'), 1)
        self.assertIn('Reviewed notes', prepared)
        self.assertNotIn('\nold\n', prepared)
        self.assertIn('fixture-signature', prepared)
        self.assertFalse(any(call[:3] == ('gh', 'release', 'create') for call in calls))
        self.assertTrue(all(call.args == (True,) for call in gates))
        self.assertEqual(len(scans), 1)

    def test_publish_explicitly_targets_full_sha_latest_notes_and_exact_three_assets(self):
        _, calls, gates, _ = self.invoke(['--publish'])
        publish = [call for call in calls if call[:3] == ('gh', 'release', 'create')]
        self.assertEqual(len(publish), 1)
        command = publish[0]
        self.assertEqual(command[command.index('--target') + 1], SHA)
        self.assertIn('--latest', command)
        self.assertEqual(Path(command[command.index('--notes-file') + 1]).name, '1.2.3-release-notes.md')
        self.assertEqual([Path(arg).name for arg in command[-3:]], release.asset_names('1.2.3'))
        self.assertTrue(all(call.args == (False,) for call in gates))

    def test_source_change_after_build_prevents_signing_or_publishing(self):
        with self.assertRaisesRegex(RuntimeError, 'Source changed'):
            self.invoke(['--publish'], changed_source=True)

    def test_validation_and_publish_cannot_be_combined(self):
        with patch('sys.argv', ['release-client.sh', '1.2.3', '--validate', '--publish']), patch.object(release.platform, 'system', return_value='Darwin'), patch.object(release.platform, 'machine', return_value='arm64'), patch.object(release, 'source_gate') as gate, contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                release.main()
            gate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
