#!/usr/bin/env python3
"""Local three-file release builder. Publishing requires a separate explicit call."""
import argparse
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import tempfile
import time
import zipfile

ROOT = Path(__file__).resolve().parent.parent
DESKTOP = ROOT / 'desktop'
REPO = 'dufangshi/pockymoe-app'


def run(*args, cwd=ROOT, capture=False, env=None):
    return subprocess.run([str(arg) for arg in args], cwd=cwd, check=True,
                          stdout=subprocess.PIPE if capture else None,
                          stderr=subprocess.PIPE if capture else None, env=env).stdout


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
    return [f'Pockymoe-{version}-{suffix}' for suffix in ('android.apk', 'mac-arm64.dmg', 'win-x64.exe')]


def exact_output(folder, version):
    if sorted(p.name for p in folder.iterdir()) != sorted(asset_names(version)) or any(not p.is_file() or p.is_symlink() for p in folder.iterdir()):
        raise RuntimeError('Output must contain exactly the three named release files, nothing else')


def scan(*paths):
    run('python3', ROOT / 'scripts/check-production-address.py', *paths)


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
    text = run(sdk_tool('apksigner'), 'verify', '--print-certs', apk, capture=True).decode()
    digests = re.findall(r'Signer #\d+ certificate SHA-256 digest: ([0-9a-f]+)', text)
    if not digests:
        raise RuntimeError('APK has no verified signing certificate')
    return sorted(digests)


def previous_apk(work, code):
    # Failure to query GitHub is not evidence that there is no previous release.
    release = json.loads(run('gh', 'release', 'view', '--repo', REPO, '--json', 'tagName,assets', capture=True))
    assets = [asset['name'] for asset in release['assets'] if asset['name'].endswith('.apk')]
    if not assets:
        print('Latest release has no APK; versionCode/certificate comparison unavailable')
        return None
    if len(assets) != 1:
        raise RuntimeError('Ambiguous previous APK')
    folder = work / 'previous'
    folder.mkdir()
    run('gh', 'release', 'download', release['tagName'], '--repo', REPO, '--pattern', assets[0], '--dir', folder, capture=True)
    previous = folder / assets[0]
    badging = run(sdk_tool('aapt'), 'dump', 'badging', previous, capture=True).decode()
    previous_code = int(re.search(r"versionCode='(\d+)'", badging).group(1))
    if code <= previous_code:
        raise RuntimeError('Android versionCode must rise above latest release')
    print(f'Android versionCode: {code} > previous {previous_code}')
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
            # Verify a live visible setup window belongs to this isolated process.
            run('osascript', '-e', f'tell application "System Events" to get name of first process whose unix id is {child.pid}', capture=True)
        finally:
            if child.poll() is None:
                child.terminate()
            child.wait(timeout=15)
    print('Built Mac app started; isolated smoke process closed')


def build(version, code, output, work):
    previous = previous_apk(work, code)
    run('python3', ROOT / 'scripts/check-production-address.py')
    run('pnpm', 'install', '--frozen-lockfile', cwd=DESKTOP)
    artifacts = work / 'builder'
    env = dict(os.environ, CSC_IDENTITY_AUTO_DISCOVERY='false')
    # Ignore inherited signing overrides: public Mac output must use the dedicated non-personal identity.
    for key in list(env):
        if key.startswith(('CSC_', 'WIN_CSC_', 'APPLE_', 'POCKYMOE_UPDATER_TEST_')):
            env.pop(key)
    env['CSC_IDENTITY_AUTO_DISCOVERY'] = 'false'
    run('pnpm', 'build', cwd=DESKTOP, env=env)
    # Self-signed identities are omitted by builder's trusted-identity discovery.
    # Sign explicitly in a dedicated keychain without changing system trust.
    run('python3', ROOT / 'scripts/setup-client-signing.py', capture=True)
    signing = json.loads((DESKTOP / 'build/release-signing.json').read_text())
    run('pnpm', 'exec', 'electron-builder', '--mac', '--arm64', '--dir', '--publish', 'never',
        '-c.mac.identity=null', '-c.mac.hardenedRuntime=false', '-c.mac.notarize=false',
        f'-c.directories.output={artifacts}', cwd=DESKTOP, env=env)
    mac_app = artifacts / 'mac-arm64/Pockymoe.app'
    run('python3', ROOT / 'scripts/setup-client-signing.py', '--sign-app', mac_app, capture=True)
    run('codesign', '--verify', '--deep', '--strict', '-R', '=certificate leaf = H"' + signing['certificateSha1'] + '"', mac_app, capture=True)
    run('pnpm', 'exec', 'electron-builder', '--mac', 'dmg', '--arm64', '--prepackaged', mac_app,
        '--publish', 'never', '-c.mac.identity=null', '-c.mac.hardenedRuntime=false',
        f'-c.directories.output={artifacts}', cwd=DESKTOP, env=env)
    run('pnpm', 'exec', 'electron-builder', '--win', 'nsis', '--x64', '--publish', 'never',
        f'-c.directories.output={artifacts}', cwd=DESKTOP, env=env)
    # Check the builder output itself, not just files selected for copying.
    generated = sorted(p.name for p in artifacts.iterdir() if p.suffix in ('.dmg', '.zip', '.exe', '.yml', '.blockmap') and p.name != 'builder-debug.yml' and not p.name.endswith('.__uninstaller.exe'))
    if generated != sorted(asset_names(version)[1:]):
        raise RuntimeError('Unexpected builder artifacts (including update metadata/blockmaps): ' + ', '.join(generated))
    if list(artifacts.rglob('app-update.yml')) or list(artifacts.rglob('*.blockmap')) or list(artifacts.rglob('latest*.yml')):
        raise RuntimeError('Unexpected update metadata/blockmap')
    win = artifacts / 'win-unpacked'
    run('node', DESKTOP / 'scripts/verify-windows-package.cjs', win, 'x64', cwd=DESKTOP)
    mac_smoke(artifacts / 'mac-arm64/Pockymoe.app', work)
    android_output = work / 'android'
    run('bash', ROOT / 'scripts/assemble-signed-apk.sh', android_output, capture=True)
    apk = android_output / 'remote-codex-android.apk'
    certificate = apk_certificate(apk)
    if previous and certificate != apk_certificate(previous):
        raise RuntimeError('APK signing certificate differs from previous release')
    print('APK certificate verified' + (' against previous release' if previous else ''))
    scan_apk = work / 'scan-apk'
    with zipfile.ZipFile(apk) as archive:
        archive.extractall(scan_apk)
    mount = work / 'dmg-mount'
    mount.mkdir()
    run('hdiutil', 'attach', artifacts / asset_names(version)[1], '-readonly', '-nobrowse', '-mountpoint', mount, capture=True)
    try:
        resources = mount / 'Pockymoe.app/Contents/Resources'
        extract_asar(resources, work / 'scan-mac-asar')
        scan(mount / 'Pockymoe.app', work / 'scan-mac-asar')
    finally:
        run('hdiutil', 'detach', mount, capture=True)
    # Extract the actual NSIS installer, including its compressed app payload.
    seven = run('node', DESKTOP / 'scripts/7zip-path.cjs', cwd=DESKTOP, capture=True).decode().splitlines()[-1].strip()
    installer = work / 'scan-installer'
    run(seven, 'x', artifacts / asset_names(version)[2], f'-o{installer}', '-y', capture=True)
    payloads = list(installer.rglob('app-64.7z'))
    if len(payloads) != 1:
        raise RuntimeError('Expected exactly one x64 installer payload')
    installed = work / 'scan-installed'
    run(seven, 'x', payloads[0], f'-o{installed}', '-y', capture=True)
    run('node', DESKTOP / 'scripts/verify-windows-package.cjs', installed, 'x64', cwd=DESKTOP)
    extract_asar(installed / 'resources', work / 'scan-win-asar')
    scan(apk, scan_apk, artifacts / asset_names(version)[1], artifacts / asset_names(version)[2], installer, installed, work / 'scan-win-asar')
    if list(output.iterdir()):
        raise RuntimeError('Output folder changed while building; refusing to overwrite')
    shutil.copy2(apk, output / asset_names(version)[0])
    for name in asset_names(version)[1:]:
        shutil.copy2(artifacts / name, output / name)
    exact_output(output, version)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('version')
    parser.add_argument('--output', type=Path, help='Must be empty; defaults to .local/client-release/<version>')
    parser.add_argument('--validate', action='store_true', help='Build/test a clean candidate branch, never publish; main/origin gate is retained for normal release commands')
    parser.add_argument('--publish', action='store_true', help='Explicitly build, verify, then publish from clean main matching origin/main')
    parser.add_argument('--notes-file', type=Path, help='Required existing release notes file for --publish')
    args = parser.parse_args()
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        parser.error('Run on the Apple silicon Mac with the local Android signing key')
    if args.validate and args.publish:
        parser.error('--validate cannot publish')
    if args.publish and (not args.notes_file or not args.notes_file.is_file()):
        parser.error('--publish requires --notes-file pointing to an existing file')
    sha = source_gate(args.validate)
    code = versions(args.version)
    output = (args.output or ROOT / '.local/client-release' / args.version).resolve()
    output.mkdir(parents=True, exist_ok=True)
    if list(output.iterdir()):
        raise RuntimeError('Output folder must be empty; nothing will be deleted or overwritten')
    with tempfile.TemporaryDirectory(prefix='pockymoe-client-') as temporary:
        build(args.version, code, output, Path(temporary))
    if source_gate(args.validate) != sha:
        raise RuntimeError('Source changed during build')
    exact_output(output, args.version)
    for file in sorted(output.iterdir()):
        print(f'{file.name}\t{file.stat().st_size} bytes')
    print(f'Output: {output}\nCommit: {sha}')
    notes = output.parent / f'{args.version}-release-notes.md'
    with tempfile.TemporaryDirectory(prefix='pockymoe-update-notes-') as temporary:
        metadata = Path(temporary) / 'metadata.md'
        run('node', ROOT / 'scripts/update-signatures.cjs', 'sign', args.version, output, metadata)
        original = args.notes_file.read_text() if args.notes_file else f'Pockymoe {args.version}\n'
        original = re.sub(r'<!-- pockymoe-updates-v1\n[\s\S]*?\n-->\n?', '', original)
        notes.write_text(original.rstrip() + '\n\n' + metadata.read_text())
    scan(notes)
    if args.publish:
        run('gh', 'release', 'create', f'v{args.version}', '--repo', REPO, '--target', sha,
            '--latest', '--notes-file', notes, *(output / name for name in asset_names(args.version)))
    else:
        print('Not published. Publishing requires a separate invocation with --publish --notes-file FILE.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        # Subprocess output can include signing subjects or credentials: do not echo it.
        raise SystemExit(str(error) if isinstance(error, RuntimeError) else 'Release command failed; no release was published')
