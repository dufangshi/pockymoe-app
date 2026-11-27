#!/usr/bin/env python3
"""Client release steps (four files), plus the local Apple-silicon fallback command.

The release carries the WebView Android APK, the macOS DMG, the Windows installer and the
native Android app (native/, package com.pockymoe.app, installed beside the WebView app and
signed with the same key).

GitHub Actions (.github/workflows/client-release.yml through client_release_ci.py)
is the documented release path. It and this local command share every build,
signing and verification step defined here. Publishing requires a separate
explicit call.
"""
import argparse
import json
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import zipfile
from required_aggregate import require_aggregate

ROOT = Path(__file__).resolve().parent.parent
DESKTOP = ROOT / 'desktop'
REPO = 'dufangshi/pockymoe-app'
WINDOWS = os.name == 'nt'
# The interpreter running this file, so helpers also work where only `python` exists.
PYTHON = sys.executable or 'python3'
STEP_TIMEOUT = 600


def _stop_tree(child):
    if WINDOWS:
        subprocess.run(['taskkill', '/PID', str(child.pid), '/T', '/F'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        os.killpg(child.pid, signal.SIGKILL)


def run(*args, cwd=ROOT, capture=False, env=None, timeout=STEP_TIMEOUT, retries=0):
    """Run one step in its own process group with a timeout.

    `retries` is for network-bound, idempotent steps only (installs, downloads,
    queries). Publication is never retried.
    """
    command = [str(arg) for arg in args]
    if WINDOWS:
        # CreateProcess does not search PATHEXT; resolve pnpm.cmd and similar.
        command[0] = shutil.which(command[0]) or command[0]
    name = Path(command[0]).name
    for attempt in range(retries + 1):
        started = time.monotonic()
        child = subprocess.Popen(command, cwd=cwd, env=env, start_new_session=not WINDOWS,
                                 stdout=subprocess.PIPE if capture else None,
                                 stderr=subprocess.PIPE if capture else None)
        try:
            try:
                output, error = child.communicate(timeout=timeout)
            except subprocess.TimeoutExpired:
                _stop_tree(child)
                child.communicate()
                failure = RuntimeError(f"Release step {name} exceeded {timeout}s; its owned process group was stopped")
            else:
                if not child.returncode:
                    return output
                failure = subprocess.CalledProcessError(child.returncode, command, output, error)
        finally:
            # Never log command arguments, environments or signing subjects.
            print(f"Release step {name}: {time.monotonic() - started:.2f}s", flush=True)
        if attempt < retries:
            print(f"Release step {name} failed; retrying once", flush=True)
    raise failure


def git(*args):
    return run('git', *args, capture=True).decode().strip()


def source_gate(validation=False):
    if git('status', '--porcelain'):
        raise RuntimeError('Release builds require a clean checkout (including untracked files)')
    if not validation:
        if git('branch', '--show-current') != 'main':
            raise RuntimeError('Release builds require main; use --validate for an unpublished candidate')
        run('git', 'fetch', 'origin', 'main')
        if git('rev-parse', 'HEAD') != git('rev-parse', 'origin/main'):
            raise RuntimeError('main must match freshly fetched origin/main')
    return git('rev-parse', 'HEAD')


def versions(version):
    if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', version):
        raise RuntimeError('Version must be a stable numeric x.y.z without v')
    package = json.loads((DESKTOP / 'package.json').read_text())
    gradle = (ROOT / 'android/app/build.gradle.kts').read_text()
    android = re.search(r'versionName = "([^"]+)"', gradle).group(1)
    code = int(re.search(r'versionCode = (\d+)', gradle).group(1))
    if version != package['version'] or version != android:
        raise RuntimeError('Argument, desktop version and Android versionName must agree')
    return code


def asset_names(version):
    """The WebView APK and the two desktop installers (the desktop update metadata covers these)."""
    return [f'Pockymoe-{version}-{suffix}' for suffix in ('android.apk', 'mac-arm64.dmg', 'win-x64.exe')]


NATIVE_PACKAGE = 'com.pockymoe.app'
WEBVIEW_PACKAGE = 'com.remotecodex.app'


def native_asset_name(version):
    return f'Pockymoe-Native-{version}-android.apk'


def release_assets(version):
    """Every file of a release: the three of asset_names() and the native Android APK."""
    return [*asset_names(version), native_asset_name(version)]


def exact_output(folder, version):
    if sorted(p.name for p in folder.iterdir()) != sorted(release_assets(version)) or any(not p.is_file() or p.is_symlink() for p in folder.iterdir()):
        raise RuntimeError('Output must contain exactly the four named release files, nothing else')


def scan(*paths):
    run(PYTHON, ROOT / 'scripts/check-production-address.py', *paths)


def extract_asar(resources, destination):
    run('node', DESKTOP / 'scripts/extract-asar.cjs', resources / 'app.asar', destination, cwd=DESKTOP)


def sdk_tool(name):
    sdk = Path(os.environ.get('ANDROID_HOME', str(Path.home() / 'Library/Android/sdk')))
    paths = sorted((sdk / 'build-tools').glob(f'*/{name}'), reverse=True)
    if not paths:
        raise RuntimeError(f'Android build tool missing: {name}')
    return paths[0]


def apk_certificate(apk):
    # Capture certificate subject and digest, never print personal certificate fields.
    env = dict(os.environ, JAVA_HOME=os.environ.get('JAVA_HOME', '/Applications/Android Studio.app/Contents/jbr/Contents/Home'))
    text = run(sdk_tool('apksigner'), 'verify', '--print-certs', apk, capture=True, env=env).decode()
    digests = re.findall(r'(?:Signer #\d+|V\d+ Signer(?: #\d+)?):? certificate SHA-256 digest: ([0-9a-fA-F]{64})', text)
    if not digests:
        raise RuntimeError('APK has no verified signing certificate')
    return sorted(set(digest.lower() for digest in digests))


def previous_apk(work, code, validation=False, native=False):
    """The latest release's WebView APK (or, with native, its native APK) for the versionCode and
    certificate checks; None when that release has none."""
    # Failure to query GitHub is not evidence that there is no previous release.
    release = json.loads(run('gh', 'release', 'view', '--repo', REPO, '--json', 'tagName,assets', capture=True, retries=1, timeout=60))
    pattern = r'Pockymoe-Native-\d+\.\d+\.\d+-android\.apk' if native else r'Pockymoe-\d+\.\d+\.\d+-android\.apk'
    assets = [asset['name'] for asset in release['assets'] if re.fullmatch(pattern, asset['name'])]
    kind = 'native APK' if native else 'APK'
    if not assets:
        print(f'Latest release has no {kind}; versionCode/certificate comparison unavailable')
        return None
    if len(assets) != 1:
        raise RuntimeError(f'Ambiguous previous {kind}')
    folder = work / ('previous-native' if native else 'previous')
    folder.mkdir()
    run('gh', 'release', 'download', release['tagName'], '--repo', REPO, '--pattern', assets[0], '--dir', folder, '--clobber', capture=True, retries=1, timeout=300)
    previous = folder / assets[0]
    badging = run(sdk_tool('aapt'), 'dump', 'badging', previous, capture=True).decode()
    previous_code = int(re.search(r"versionCode='(\d+)'", badging).group(1))
    if code < previous_code or (code == previous_code and not validation):
        raise RuntimeError('Android versionCode must rise above latest release')
    relation = '== (unpublished validation only)' if code == previous_code else '>'
    print(f'Android versionCode: {code} {relation} previous {previous_code}')
    return previous


def mac_smoke(app, work):
    executable = app / 'Contents/MacOS/Pockymoe'
    profile = work / 'smoke-profile'
    # Use Electron's Node mode to load the real packaged native addon first.
    env = {key: os.environ[key] for key in ('PATH', 'HOME', 'TMPDIR') if key in os.environ}
    env['ELECTRON_RUN_AS_NODE'] = '1'
    resources = app / 'Contents/Resources'
    run(executable, '-e', 'const s=require(process.argv[1]); if(typeof s.OfflineTts!=="function") process.exit(1); console.log("Packaged Mac voice engine loaded");', resources / 'app.asar/node_modules/sherpa-onnx-node', env=env)
    del env['ELECTRON_RUN_AS_NODE']
    env['POCKYMOE_DESKTOP_USER_DATA'] = str(profile)
    # No saved connection: setup opens without contacting a Supervisor.
    with (work / 'mac-smoke.log').open('wb') as log:
        child = subprocess.Popen([str(executable)], env=env, stdout=log, stderr=log)
        try:
            time.sleep(5)
            if child.poll() is not None:
                raise RuntimeError('Built Mac app exited during startup')
            # A live process after five seconds proves the bundle starts without
            # requiring Automation access or operating an installed application.
        finally:
            if child.poll() is None:
                child.terminate()
            child.wait(timeout=15)
    print('Built Mac app started; isolated smoke process closed')


def verify_mac_dmg(dmg, work, signing):
    mount = work / 'dmg-mount'
    mount.mkdir()
    run('hdiutil', 'attach', dmg, '-readonly', '-nobrowse', '-mountpoint', mount, capture=True)
    try:
        mounted_app = mount / 'Pockymoe.app'
        run('codesign', '--verify', '--deep', '--strict', '-R', '=certificate leaf = H"' + signing['certificateSha1'] + '"', mounted_app, capture=True)
        print('Final DMG Mac signature: pinned certificate, deep/strict verification passed')
        run('node', DESKTOP / 'scripts/release-fuses.cjs', mounted_app, cwd=DESKTOP)
        resources = mounted_app / 'Contents/Resources'
        extract_asar(resources, work / 'scan-mac-asar')
        # Include volume-root files such as .DS_Store and background artwork.
        scan(mount, work / 'scan-mac-asar')
    finally:
        run('hdiutil', 'detach', mount, capture=True)


def release_env():
    """Environment for public packaging: no inherited signing or fixture overrides."""
    env = dict(os.environ)
    # Ignore inherited signing overrides: public Mac output must use the dedicated non-personal identity.
    for key in list(env):
        if key.startswith(('CSC_', 'WIN_CSC_', 'APPLE_', 'POCKYMOE_UPDATER_TEST_')):
            env.pop(key)
    env['CSC_IDENTITY_AUTO_DISCOVERY'] = 'false'
    # Both validation and publication must exercise exactly the release fuse policy.
    env['POCKYMOE_RELEASE_FUSES'] = '1'
    return env


def build_desktop(env):
    run('pnpm', 'install', '--frozen-lockfile', cwd=DESKTOP, retries=1)
    run('pnpm', 'build', cwd=DESKTOP, env=env)


def package_mac(artifacts, env, signing, signing_args=()):
    """Package the arm64 app, sign it with the Pockymoe identity, verify the pin, then build the DMG."""
    # Self-signed identities are omitted by builder's trusted-identity discovery.
    # Sign explicitly in a dedicated keychain without changing system trust.
    run('pnpm', 'exec', 'electron-builder', '--mac', '--arm64', '--dir', '--publish', 'never',
        '-c.mac.identity=null', '-c.mac.hardenedRuntime=false', '-c.mac.notarize=false',
        f'-c.directories.output={artifacts}', cwd=DESKTOP, env=env)
    mac_app = artifacts / 'mac-arm64/Pockymoe.app'
    # The helper prints only public hashes and secret-free errors.
    run(PYTHON, ROOT / 'scripts/setup-client-signing.py', *signing_args, '--sign-app', mac_app)
    run('codesign', '--verify', '--deep', '--strict', '-R', '=certificate leaf = H"' + signing['certificateSha1'] + '"', mac_app, capture=True)
    # hdiutil occasionally reports a busy resource on shared hosts; the step is idempotent.
    run('pnpm', 'exec', 'electron-builder', '--mac', 'dmg', '--arm64', '--prepackaged', mac_app,
        '--publish', 'never', '-c.mac.identity=null', '-c.mac.hardenedRuntime=false',
        f'-c.directories.output={artifacts}', cwd=DESKTOP, env=env, retries=1)
    return mac_app


def package_windows(artifacts, env):
    run('pnpm', 'exec', 'electron-builder', '--win', 'nsis', '--x64', '--publish', 'never',
        f'-c.directories.output={artifacts}', cwd=DESKTOP, env=env)


def check_builder_output(artifacts, names):
    """Check the builder output itself, not just files selected for copying."""
    generated = sorted(p.name for p in artifacts.iterdir() if p.suffix in ('.dmg', '.zip', '.exe', '.yml', '.blockmap') and p.name != 'builder-debug.yml' and not p.name.endswith('.__uninstaller.exe'))
    if generated != sorted(names):
        raise RuntimeError('Unexpected builder artifacts (including update metadata/blockmaps): ' + ', '.join(generated))
    if list(artifacts.rglob('app-update.yml')) or list(artifacts.rglob('*.blockmap')) or list(artifacts.rglob('latest*.yml')):
        raise RuntimeError('Unexpected update metadata/blockmap')


def verify_windows_installer(installer, work):
    """Extract the final NSIS installer, including its app payload; return paths to scan."""
    seven = run('node', DESKTOP / 'scripts/7zip-path.cjs', cwd=DESKTOP, capture=True).decode().splitlines()[-1].strip()
    extracted = work / 'scan-installer'
    run(seven, 'x', installer, f'-o{extracted}', '-y', capture=True)
    payloads = list(extracted.rglob('app-64.7z'))
    direct = extracted / 'Pockymoe.exe'
    # The macOS/Linux 7za returns an app-64.7z wrapper; the Windows 7za extracts
    # the embedded app directly. Accept exactly one of the two layouts.
    if payloads and not direct.exists():
        if len(payloads) != 1:
            raise RuntimeError('Expected exactly one x64 installer payload')
        installed = work / 'scan-installed'
        run(seven, 'x', payloads[0], f'-o{installed}', '-y', capture=True)
    elif direct.is_file() and not payloads:
        installed = extracted
    else:
        raise RuntimeError('Expected exactly one x64 installer payload')
    run('node', DESKTOP / 'scripts/verify-windows-package.cjs', installed, 'x64', cwd=DESKTOP)
    print('Final NSIS extracted Windows executable:')
    run('node', DESKTOP / 'scripts/release-fuses.cjs', installed / 'Pockymoe.exe', cwd=DESKTOP)
    extract_asar(installed / 'resources', work / 'scan-win-asar')
    return installed, [installer, *dict.fromkeys([extracted, installed]), work / 'scan-win-asar']


def verify_apk(apk, previous, work, certificate_continuity=True):
    """Verify the APK signature (and its continuity with the previous release); return paths to scan."""
    certificate = apk_certificate(apk)
    if previous and certificate != apk_certificate(previous):
        if certificate_continuity:
            raise RuntimeError('APK signing certificate differs from previous release')
        print('APK signature verified with a throwaway dry-run key; continuity with the previous release is checked only with the release key')
    elif certificate_continuity:
        print('APK certificate verified' + (' against previous release' if previous else ''))
    scan_apk = work / 'scan-apk'
    with zipfile.ZipFile(apk) as archive:
        archive.extractall(scan_apk)
    return [apk, scan_apk]


def build_native_apk(work, env=None):
    """Build the native app's signed release APK (scripts/assemble-signed-native-apk.sh) and return it.

    The same release key as the WebView APK (scripts/android-release-signing.sh); versions come
    from android/app/build.gradle.kts through native/app.config.ts.
    """
    output = work / 'native-android'
    run('bash', ROOT / 'scripts/assemble-signed-native-apk.sh', output, env=env, timeout=3000, retries=1, capture=env is None)
    return output / 'pockymoe-native-android.apk'


def verify_native_apk(apk, previous, work, certificate_continuity=True):
    """Like verify_apk, for the native app: its own previous APK and its own scan folder."""
    return verify_apk(apk, previous, work / 'native', certificate_continuity)


def build(version, code, output, work, validation=False):
    previous = previous_apk(work, code, validation)
    previous_native = previous_apk(work, code, validation, native=True)
    run(PYTHON, ROOT / 'scripts/check-production-address.py')
    env = release_env()
    build_desktop(env)
    artifacts = work / 'builder'
    run(PYTHON, ROOT / 'scripts/setup-client-signing.py', capture=True)
    signing = json.loads((DESKTOP / 'build/release-signing.json').read_text())
    mac_app = package_mac(artifacts, env, signing)
    package_windows(artifacts, env)
    check_builder_output(artifacts, asset_names(version)[1:])
    run('node', DESKTOP / 'scripts/verify-windows-package.cjs', artifacts / 'win-unpacked', 'x64', cwd=DESKTOP)
    mac_smoke(mac_app, work)
    android_output = work / 'android'
    run('bash', ROOT / 'scripts/assemble-signed-apk.sh', android_output, capture=True)
    apk_scan = verify_apk(android_output / 'remote-codex-android.apk', previous, work)
    native_scan = verify_native_apk(build_native_apk(work), previous_native, work)
    verify_mac_dmg(artifacts / asset_names(version)[1], work, signing)
    _, windows_scan = verify_windows_installer(artifacts / asset_names(version)[2], work)
    scan(*apk_scan, *native_scan, artifacts / asset_names(version)[1], *windows_scan)
    if list(output.iterdir()):
        raise RuntimeError('Output folder changed while building; refusing to overwrite')
    shutil.copy2(apk_scan[0], output / asset_names(version)[0])
    shutil.copy2(native_scan[0], output / native_asset_name(version))
    for name in asset_names(version)[1:]:
        shutil.copy2(artifacts / name, output / name)
    exact_output(output, version)


def default_notes(version):
    template = ROOT / 'desktop/release-notes-template.md'
    if template.is_file():
        return template.read_text().replace('{version}', version)
    return f'Pockymoe {version}\n\nmacOS may show one Keychain prompt after each update; choose Always Allow to retain sign-in and saved voice keys.\n'


def write_release_notes(version, folder, notes, source, *, production, validation_public_key=None):
    """Sign update metadata for the final files, append it to the notes and verify it.

    Production uses the release Ed25519 key and the committed public key;
    everything else uses a fresh throwaway key whose public half is saved to
    `validation_public_key`. Returns the public key used for verification.
    """
    with tempfile.TemporaryDirectory(prefix='pockymoe-update-notes-') as temporary:
        metadata = Path(temporary) / 'metadata.md'
        if production:
            run('node', ROOT / 'scripts/update-signatures.cjs', 'sign', version, folder, metadata, '--publish')
            public_key = DESKTOP / 'build/update-public-key.pem'
        else:
            temporary_public = Path(temporary) / 'validation-public-key.pem'
            run('node', ROOT / 'scripts/update-signatures.cjs', 'sign-validation', version, folder, metadata, temporary_public)
            validation_public_key.write_bytes(temporary_public.read_bytes())
            public_key = validation_public_key
        original = re.sub(r'<!-- pockymoe-updates-v1\n[\s\S]*?\n-->\n?', '', source)
        notes.write_text(original.rstrip() + '\n\n' + metadata.read_text())
    scan(notes)
    run('node', ROOT / 'scripts/update-signatures.cjs', 'verify', version, folder, notes, public_key)
    return public_key


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('version')
    parser.add_argument('--output', type=Path, help='Must be empty; defaults to .local/client-release/<version>')
    parser.add_argument('--validate', action='store_true', help='Build/test a clean candidate branch, never publish; main/origin gate is retained for normal release commands')
    parser.add_argument('--publish', action='store_true', help='Explicitly build, verify, then publish from clean main matching origin/main')
    parser.add_argument('--allow-unchecked-ci', metavar='REASON', help='Emergency publication override for the required CI aggregate; logged with final SHA and a reason digest')
    parser.add_argument('--notes-file', type=Path, help='Required existing release notes file for --publish')
    args = parser.parse_args()
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        parser.error('Run on the Apple silicon Mac with the local Android signing key')
    if args.allow_unchecked_ci is not None and not args.publish:
        parser.error('--allow-unchecked-ci applies only to --publish')
    if args.validate and args.publish:
        parser.error('--validate cannot publish')
    if args.publish and (not args.notes_file or not args.notes_file.is_file()):
        parser.error('--publish requires --notes-file pointing to an existing file')
    sha = source_gate(args.validate)
    if args.publish:
        require_aggregate(REPO, sha, args.allow_unchecked_ci)
    code = versions(args.version)
    output = (args.output or ROOT / '.local/client-release' / args.version).resolve()
    output.mkdir(parents=True, exist_ok=True)
    if list(output.iterdir()):
        raise RuntimeError('Output folder must be empty; nothing will be deleted or overwritten')
    with tempfile.TemporaryDirectory(prefix='pockymoe-client-') as temporary:
        build(args.version, code, output, Path(temporary), validation=args.validate)
    if source_gate(args.validate) != sha:
        raise RuntimeError('Source changed during build')
    exact_output(output, args.version)
    for file in sorted(output.iterdir()):
        print(f'{file.name}\t{file.stat().st_size} bytes')
    print(f'Output: {output}\nCommit: {sha}')
    notes = output.parent / f'{args.version}-release-notes.md' if args.publish else output.parent / f'{output.name}-validation-notes.md'
    source = args.notes_file.read_text() if args.notes_file else default_notes(args.version)
    public_key = write_release_notes(args.version, output, notes, source, production=args.publish,
                                     validation_public_key=output.parent / f'{output.name}-validation-public-key.pem')
    print(f'Metadata: {notes}\nVerification public key: {public_key}')
    if args.publish:
        require_aggregate(REPO, sha, args.allow_unchecked_ci)
        run('gh', 'release', 'create', f'v{args.version}', '--repo', REPO, '--target', sha,
            '--latest', '--notes-file', notes, *(output / name for name in release_assets(args.version)))
    else:
        print('Not published. Publishing requires a separate invocation with --publish --notes-file FILE.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        # Subprocess output can include signing subjects or credentials: do not echo it.
        raise SystemExit(str(error) if isinstance(error, RuntimeError) else 'Release command failed; no release was published')
