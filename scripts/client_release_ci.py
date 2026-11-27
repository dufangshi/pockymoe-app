#!/usr/bin/env python3
"""Job steps for .github/workflows/client-release.yml.

Every build, signing and verification step comes from release_client.py, which
the local Mac fallback uses too. This file adds only what CI needs: the channel
and source gates, secrets handling, per-job manifests and the final publish.

Channels:
  dry-run         any ref; throwaway signing keys; never reads secrets or publishes
  signed-dry-run  main only; release keys from the `client-release` environment; never publishes
  publish         main only; release keys; `Client checks complete` must have
                  passed on the commit; creates the immutable release vX.Y.Z
"""
import argparse
import base64
import binascii
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys

import release_client as release
from required_aggregate import require_aggregate

CHANNELS = ('dry-run', 'signed-dry-run', 'publish')
PLATFORMS = ('android', 'mac', 'windows', 'android-native')  # Same order as release.release_assets().
SECRETS = {
    'android': ('CLIENT_ANDROID_KEYSTORE_BASE64', 'CLIENT_ANDROID_STORE_PASSWORD',
                'CLIENT_ANDROID_KEY_ALIAS', 'CLIENT_ANDROID_KEY_PASSWORD'),
    'mac': ('CLIENT_MAC_SIGNING_P12_BASE64', 'CLIENT_MAC_SIGNING_P12_PASSWORD'),
    'publish': ('CLIENT_UPDATE_SIGNING_KEY_BASE64',),
}
# The native app is signed with the WebView app's key (same identity, other package).
SECRETS['android-native'] = SECRETS['android']
REQUIRED = {
    'android': ('CLIENT_ANDROID_KEYSTORE_BASE64', 'CLIENT_ANDROID_STORE_PASSWORD'),
    'mac': ('CLIENT_MAC_SIGNING_P12_BASE64', 'CLIENT_MAC_SIGNING_P12_PASSWORD'),
    'publish': ('CLIENT_UPDATE_SIGNING_KEY_BASE64',),
}
REQUIRED['android-native'] = REQUIRED['android']
ALL_SECRETS = tuple(dict.fromkeys(name for names in SECRETS.values() for name in names)) + ('CLIENT_PRIVATE_IDENTIFIERS',)
SETUP_SIGNING = release.ROOT / 'scripts/setup-client-signing.py'


def uses_release_keys(channel):
    return channel != 'dry-run'


def channel_gate(channel):
    if channel not in CHANNELS:
        raise RuntimeError(f'Unknown channel {channel!r}; expected one of {", ".join(CHANNELS)}')
    if uses_release_keys(channel) and os.environ.get('GITHUB_REF') != 'refs/heads/main':
        raise RuntimeError(f'Channel {channel} runs only from main; use channel dry-run on other refs')


def expected_signing(channel):
    kind = 'release' if uses_release_keys(channel) else 'throwaway'
    return {'android': kind, 'mac': kind, 'windows': 'none', 'android-native': kind}


def append(variable, text):
    path = os.environ.get(variable)
    if path:
        with open(path, 'a', encoding='utf-8') as handle:
            handle.write(text)


def outputs(**values):
    append('GITHUB_OUTPUT', ''.join(f'{key}={value}\n' for key, value in values.items()))


def summary(text):
    append('GITHUB_STEP_SUMMARY', text.rstrip() + '\n')


def take_secrets(platform, channel):
    """Remove every release secret from this process environment before any child runs.

    Only the values this job needs are returned, and only for release-key channels.
    """
    values = {name: os.environ.pop(name, '') for name in ALL_SECRETS if name != 'CLIENT_PRIVATE_IDENTIFIERS'}
    if not uses_release_keys(channel):
        return {}
    missing = [name for name in REQUIRED[platform] if not values.get(name)]
    if missing:
        raise RuntimeError(f'Channel {channel} needs the secret(s) {", ".join(missing)} in the client-release '
                           'environment; nothing was signed or published. See desktop/README.md, "Release workflow".')
    return {name: values[name] for name in SECRETS[platform]}


def decode(name, value):
    try:
        return base64.b64decode(''.join(value.split()), validate=True)
    except (binascii.Error, ValueError):
        raise RuntimeError(f'{name} is not valid base64') from None


def write_private(path, data):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(data)
    return path


def private_identifiers(work):
    """Optional extra values for the address/identity scan (CI has no local Git identity)."""
    value = os.environ.pop('CLIENT_PRIVATE_IDENTIFIERS', '')
    if value.strip():
        path = write_private(work / 'keys/private-identifiers', value.encode())
        os.environ['POCKYMOE_PRIVATE_IDENTIFIERS_FILE'] = str(path)
        print('Scanning artifacts for the configured private identifiers too')


def empty_folder(path):
    path.mkdir(parents=True, exist_ok=True)
    if list(path.iterdir()):
        raise RuntimeError(f'{path.name} must be empty; nothing will be deleted or overwritten')
    return path


def gh_json(*path_and_args):
    return json.loads(release.run('gh', 'api', *path_and_args, capture=True, retries=1, timeout=60))


def main_tip():
    return gh_json(f'repos/{release.REPO}/commits/main')['sha']


def main_contains(sha):
    return gh_json(f'repos/{release.REPO}/compare/{sha}...main')['status'] in ('identical', 'ahead')


def release_exists(tag):
    for path in (f'repos/{release.REPO}/releases/tags/{tag}', f'repos/{release.REPO}/git/ref/tags/{tag}'):
        result = subprocess.run(['gh', 'api', path], capture_output=True, text=True, timeout=60)
        if result.returncode == 0:
            return True
        if 'HTTP 404' not in result.stderr:
            # Failure to query GitHub is not evidence that the tag is free.
            raise RuntimeError(f'Cannot check whether {tag} exists; GitHub query failed')
    return False


def clean_commit():
    if release.git('status', '--porcelain'):
        raise RuntimeError('Release jobs require a clean checkout')
    sha = release.git('rev-parse', 'HEAD')
    if os.environ.get('GITHUB_SHA') and sha != os.environ['GITHUB_SHA']:
        raise RuntimeError('Checkout differs from the dispatched commit')
    return sha


def notes_source():
    """Inline notes or a notes file in the repository; None when neither is given."""
    inline = os.environ.get('RELEASE_NOTES', '')
    name = os.environ.get('RELEASE_NOTES_FILE', '').strip()
    if inline.strip() and name:
        raise RuntimeError('Give notes or notes_file, not both')
    if name:
        root = release.ROOT.resolve()
        path = (root / name).resolve()
        if root not in path.parents or not path.is_file():
            raise RuntimeError('notes_file must name an existing file inside the repository')
        return path.read_text()
    return inline if inline.strip() else None


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def write_manifest(out, platform, version, file, signing, **extra):
    data = {'platform': platform, 'version': version, 'fileName': file.name, 'sha256': sha256(file),
            'size': file.stat().st_size, 'signing': signing, 'commit': os.environ.get('GITHUB_SHA', ''), **extra}
    (out / f'{platform}.json').write_text(json.dumps(data, indent=2) + '\n')
    summary(f'{file.name}: {data["size"]:,} bytes, SHA-256 `{data["sha256"]}`, signing: {signing}')
    return data


def apk_badging(apk):
    text = release.run(release.sdk_tool('aapt'), 'dump', 'badging', apk, capture=True).decode()
    match = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'", text)
    if not match:
        raise RuntimeError('Cannot read APK package/version')
    return match.group(1), int(match.group(2)), match.group(3)


def prepare(args):
    channel_gate(args.channel)
    code = release.versions(args.version)
    sha = clean_commit()
    override = os.environ.get('ALLOW_UNCHECKED_CI', '').strip() or None
    if override and args.channel != 'publish':
        raise RuntimeError('allow_unchecked_ci applies only to channel publish')
    source = notes_source()
    exists = release_exists(f'v{args.version}')
    if uses_release_keys(args.channel) and main_tip() != sha:
        raise RuntimeError('main moved after this run was dispatched; dispatch again from the new main')
    if args.channel == 'publish':
        if source is None:
            raise RuntimeError('Channel publish requires notes or notes_file')
        if exists:
            raise RuntimeError(f'v{args.version} already exists; releases are immutable, so bump the version')
        require_aggregate(release.REPO, sha, override)
    elif exists:
        print(f'v{args.version} already exists; this {args.channel} only rebuilds and verifies it')
    outputs(sha=sha, version_code=code, signing=expected_signing(args.channel)['android'])
    summary(f'## Client {args.channel} v{args.version}\n\nCommit `{sha}`, Android versionCode {code}, '
            f'signing: {expected_signing(args.channel)["android"]} keys.\n')


def android_signing_env(keys, work):
    """The Gradle signing environment (REMOTE_CODEX_ANDROID_*) and the keystore file to delete after."""
    env = dict(os.environ)
    if keys:
        store = write_private(work / 'keys/release.keystore', decode('CLIENT_ANDROID_KEYSTORE_BASE64', keys['CLIENT_ANDROID_KEYSTORE_BASE64']))
        password = keys['CLIENT_ANDROID_STORE_PASSWORD']
        env.update(REMOTE_CODEX_ANDROID_STORE_FILE=str(store), REMOTE_CODEX_ANDROID_STORE_PASSWORD=password,
                   REMOTE_CODEX_ANDROID_KEY_ALIAS=keys['CLIENT_ANDROID_KEY_ALIAS'] or 'remote-codex-release',
                   REMOTE_CODEX_ANDROID_KEY_PASSWORD=keys['CLIENT_ANDROID_KEY_PASSWORD'] or password)
    else:
        store, password = work / 'keys/throwaway.keystore', secrets.token_urlsafe(24)
        store.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        release.run('keytool', '-genkeypair', '-keystore', store, '-storetype', 'PKCS12', '-storepass', password,
                    '-keypass', password, '-alias', 'dry-run', '-keyalg', 'RSA', '-keysize', '3072',
                    '-validity', '2', '-dname', 'CN=Pockymoe dry run', capture=True)
        env.update(REMOTE_CODEX_ANDROID_STORE_FILE=str(store), REMOTE_CODEX_ANDROID_STORE_PASSWORD=password,
                   REMOTE_CODEX_ANDROID_KEY_ALIAS='dry-run', REMOTE_CODEX_ANDROID_KEY_PASSWORD=password)
    return env, store


def android(args):
    keys = take_secrets('android', args.channel)
    code = release.versions(args.version)
    work, out = empty_folder(args.work), empty_folder(args.out)
    private_identifiers(work)
    previous = release.previous_apk(work, code, validation=args.channel != 'publish')
    env, store = android_signing_env(keys, work)
    try:
        # Gradle downloads dependencies; one retry covers a transient network failure.
        release.run('bash', release.ROOT / 'scripts/assemble-signed-apk.sh', work / 'android', env=env,
                    timeout=1200, retries=1)
    finally:
        store.unlink()
    apk = work / 'android/remote-codex-android.apk'
    package, apk_code, apk_version = apk_badging(apk)
    if (package, apk_code, apk_version) != ('com.remotecodex.app', code, args.version):
        raise RuntimeError('Built APK package/versionCode/versionName differ from the source')
    release.scan(*release.verify_apk(apk, previous, work, certificate_continuity=bool(keys)))
    final = out / release.asset_names(args.version)[0]
    shutil.copy2(apk, final)
    write_manifest(out, 'android', args.version, final, 'release' if keys else 'throwaway',
                   versionCode=code, certificateSha256=release.apk_certificate(final))


def android_native(args):
    """The native app (native/, com.pockymoe.app), signed with the WebView APK's key."""
    keys = take_secrets('android-native', args.channel)
    code = release.versions(args.version)
    work, out = empty_folder(args.work), empty_folder(args.out)
    private_identifiers(work)
    previous = release.previous_apk(work, code, validation=args.channel != 'publish', native=True)
    env, store = android_signing_env(keys, work)
    try:
        # npm and Gradle download dependencies; one retry covers a transient network failure.
        apk = release.build_native_apk(work, env)
    finally:
        store.unlink()
    package, apk_code, apk_version = apk_badging(apk)
    if (package, apk_code, apk_version) != (release.NATIVE_PACKAGE, code, args.version):
        raise RuntimeError('Built native APK package/versionCode/versionName differ from the source')
    release.scan(*release.verify_native_apk(apk, previous, work, certificate_continuity=bool(keys)))
    final = out / release.native_asset_name(args.version)
    shutil.copy2(apk, final)
    write_manifest(out, 'android-native', args.version, final, 'release' if keys else 'throwaway',
                   versionCode=code, certificateSha256=release.apk_certificate(final))


def mac(args):
    keys = take_secrets('mac', args.channel)
    release.versions(args.version)
    work, out = empty_folder(args.work), empty_folder(args.out)
    private_identifiers(work)
    env = release.release_env()
    release.build_desktop(env)
    keychain = work / 'signing'
    try:
        if keys:
            p12 = write_private(work / 'keys/release.p12', decode('CLIENT_MAC_SIGNING_P12_BASE64', keys['CLIENT_MAC_SIGNING_P12_BASE64']))
            try:
                # The helper prints only public hashes and secret-free errors.
                release.run(release.PYTHON, SETUP_SIGNING, '--ci-keychain', keychain, '--p12', p12,
                            env=dict(os.environ, POCKYMOE_MAC_SIGNING_P12_PASSWORD=keys['CLIENT_MAC_SIGNING_P12_PASSWORD']))
            finally:
                p12.unlink()
        else:
            release.run(release.PYTHON, SETUP_SIGNING, '--ci-keychain', keychain)
        signing = json.loads((keychain / 'public.json').read_text())
        pinned = json.loads((release.DESKTOP / 'build/release-signing.json').read_text())
        if (signing['kind'] == 'release') != bool(keys) or (keys and signing['certificateSha1'] != pinned['certificateSha1']):
            raise RuntimeError('Mac signing identity does not match the channel and the pinned release certificate')
        if not keys:
            print('Dry run: the app is signed with a throwaway certificate; it still pins the release certificate for updates')
        artifacts = work / 'builder'
        name = release.asset_names(args.version)[1]
        app = release.package_mac(artifacts, env, signing, ('--keychain-dir', keychain))
        release.check_builder_output(artifacts, [name])
        release.mac_smoke(app, work)
        release.verify_mac_dmg(artifacts / name, work, signing)
        release.scan(artifacts / name)
    finally:
        subprocess.run([release.PYTHON, str(SETUP_SIGNING), '--delete-ci-keychain', str(keychain)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    final = out / name
    shutil.copy2(artifacts / name, final)
    write_manifest(out, 'mac', args.version, final, signing['kind'], certificateSha1=signing['certificateSha1'])


def windows(args):
    take_secrets('windows', 'dry-run')
    release.versions(args.version)
    work, out = empty_folder(args.work), empty_folder(args.out)
    private_identifiers(work)
    env = release.release_env()
    release.build_desktop(env)
    artifacts = work / 'builder'
    name = release.asset_names(args.version)[2]
    release.package_windows(artifacts, env)
    release.check_builder_output(artifacts, [name])
    release.run('node', release.DESKTOP / 'scripts/verify-windows-package.cjs', artifacts / 'win-unpacked', 'x64', cwd=release.DESKTOP)
    installed, scan_paths = release.verify_windows_installer(artifacts / name, work)
    if release.WINDOWS:
        # Launch the final payload: native window, RunAsNode helper, inspector port closed.
        smoke_env = dict(os.environ, POCKYMOE_SMOKE_POWERSHELL=shutil.which('pwsh') or 'pwsh.exe')
        release.run('node', release.DESKTOP / 'test/inspector-fuse-smoke.mjs', installed / 'Pockymoe.exe', 'off',
                    cwd=release.DESKTOP, env=smoke_env, timeout=120)
    release.scan(*scan_paths)
    final = out / name
    shutil.copy2(artifacts / name, final)
    write_manifest(out, 'windows', args.version, final, 'none')


def collect(channel, version, inputs, folder):
    """Copy the four job outputs into one exact folder and check them against their manifests."""
    expected = expected_signing(channel)
    manifests = {}
    for platform, name in zip(PLATFORMS, release.release_assets(version)):
        files = [path for path in inputs.rglob(name) if path.is_file()]
        records = [path for path in inputs.rglob(f'{platform}.json') if path.is_file()]
        if len(files) != 1 or len(records) != 1:
            raise RuntimeError(f'Expected exactly one {name} and one {platform} manifest')
        data = json.loads(records[0].read_text())
        if (data['version'], data['fileName'], data['signing']) != (version, name, expected[platform]) or \
                data['commit'] != os.environ.get('GITHUB_SHA', data['commit']):
            raise RuntimeError(f'{platform} manifest does not match this run (version, file, signing or commit)')
        shutil.copy2(files[0], folder / name)
        if sha256(folder / name) != data['sha256'] or (folder / name).stat().st_size != data['size']:
            raise RuntimeError(f'{name} differs from the bytes its build job verified')
        manifests[platform] = data
    release.exact_output(folder, version)
    return manifests


def assemble(args):
    take_secrets('windows', 'dry-run')
    release.versions(args.version)
    out = empty_folder(args.out)
    folder = empty_folder(out / 'assets')
    private_identifiers(empty_folder(args.work))
    summary(f'## Client {args.channel} v{args.version} artifacts\n\n| File | Size | SHA-256 | Signing |\n|---|---|---|---|')
    manifests = collect(args.channel, args.version, args.inputs, folder)
    for data in manifests.values():
        summary(f'| {data["fileName"]} | {data["size"]:,} bytes | `{data["sha256"]}` | {data["signing"]} |')
    if release.apk_certificate(folder / release.asset_names(args.version)[0]) != manifests['android']['certificateSha256']:
        raise RuntimeError('APK certificate differs from the one its build job verified')
    if release.apk_certificate(folder / release.native_asset_name(args.version)) != manifests['android-native']['certificateSha256']:
        raise RuntimeError('Native APK certificate differs from the one its build job verified')
    # One developer identity: with the release key both Android apps carry the same certificate
    # (each dry-run job signs with its own throwaway key).
    if uses_release_keys(args.channel) and manifests['android']['certificateSha256'] != manifests['android-native']['certificateSha256']:
        raise RuntimeError('The WebView and native APKs are signed with different keys')
    release.scan(*sorted(folder.iterdir()))
    (out / 'manifests').mkdir()
    for platform, data in manifests.items():
        (out / 'manifests' / f'{platform}.json').write_text(json.dumps(data, indent=2) + '\n')
    source = notes_source() or release.default_notes(args.version)
    # Exercise metadata signing end to end with a throwaway key; production
    # signing happens only in the publish job, which holds the release key.
    release.write_release_notes(args.version, folder, out / 'validation-notes.md', source, production=False,
                                validation_public_key=out / 'validation-public-key.pem')
    print('Four release files assembled and verified; validation metadata signed and verified')


def publish(args):
    keys = take_secrets('publish', args.channel)
    channel_gate(args.channel)
    if not keys:
        raise RuntimeError('Only signed-dry-run and publish reach the publish job')
    release.versions(args.version)
    sha = clean_commit()
    work = empty_folder(args.work)
    private_identifiers(work)
    folder = args.bundle / 'assets'
    release.exact_output(folder, args.version)
    for platform, name in zip(PLATFORMS, release.release_assets(args.version)):
        data = json.loads((args.bundle / 'manifests' / f'{platform}.json').read_text())
        if data['sha256'] != sha256(folder / name) or data['signing'] != expected_signing(args.channel)[platform]:
            raise RuntimeError(f'{name} differs from the assembled, verified file')
    if not main_contains(sha):
        raise RuntimeError('The release commit is no longer contained in main')
    source = notes_source()
    if source is None:
        if args.channel == 'publish':
            raise RuntimeError('Channel publish requires notes or notes_file')
        source = release.default_notes(args.version)
    key = write_private(work / 'keys/client-update-ed25519.pem',
                        decode('CLIENT_UPDATE_SIGNING_KEY_BASE64', keys['CLIENT_UPDATE_SIGNING_KEY_BASE64']))
    os.environ['POCKYMOE_UPDATE_PRIVATE_KEY_FILE'] = str(key)
    notes = args.bundle / f'{args.version}-release-notes.md'
    try:
        # Signs with the release key after the source gate and verifies against
        # the committed public key that installed clients trust.
        release.write_release_notes(args.version, folder, notes, source, production=True)
    finally:
        key.unlink()
        os.environ.pop('POCKYMOE_UPDATE_PRIVATE_KEY_FILE')
    if args.channel != 'publish':
        print('Signed dry run complete: release-signed metadata verified; nothing was published')
        summary('Signed dry run: release keys verified; nothing was published.')
        return
    override = os.environ.get('ALLOW_UNCHECKED_CI', '').strip() or None
    if release_exists(f'v{args.version}'):
        raise RuntimeError(f'v{args.version} already exists; releases are immutable')
    require_aggregate(release.REPO, sha, override)
    # Never retried: a partial failure must be inspected, not repeated.
    release.run('gh', 'release', 'create', f'v{args.version}', '--repo', release.REPO, '--target', sha,
                '--latest', '--notes-file', notes,
                *(folder / name for name in release.release_assets(args.version)), timeout=1800)
    summary(f'Published https://github.com/{release.REPO}/releases/tag/v{args.version}')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--version', default=os.environ.get('RELEASE_VERSION'), required='RELEASE_VERSION' not in os.environ)
    parser.add_argument('--channel', default=os.environ.get('RELEASE_CHANNEL', 'dry-run'), choices=CHANNELS)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('prepare')
    for name in ('android', 'mac', 'windows', 'android-native'):
        command = commands.add_parser(name)
        command.add_argument('--work', type=Path, required=True)
        command.add_argument('--out', type=Path, required=True)
    command = commands.add_parser('assemble')
    command.add_argument('--inputs', type=Path, required=True)
    command.add_argument('--work', type=Path, required=True)
    command.add_argument('--out', type=Path, required=True)
    command = commands.add_parser('publish')
    command.add_argument('--bundle', type=Path, required=True)
    command.add_argument('--work', type=Path, required=True)
    args = parser.parse_args(argv)
    {'prepare': prepare, 'android': android, 'mac': mac, 'windows': windows, 'android-native': android_native,
     'assemble': assemble, 'publish': publish}[args.command](args)


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as error:
        print(f'::error::{error}', flush=True)
        raise SystemExit(1)
    except subprocess.CalledProcessError as error:
        # Subprocess output can include signing subjects or credentials: do not echo it.
        print(f'::error::Release step {Path(str(error.cmd[0])).name} failed (exit {error.returncode}); nothing was published', flush=True)
        raise SystemExit(1)
