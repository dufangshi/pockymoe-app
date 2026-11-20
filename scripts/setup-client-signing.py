#!/usr/bin/env python3
"""Create/reuse a non-personal client signing identity in a private local keychain.

Local mode: private files stay beside this Mac's Android release key.
CI mode (--ci-keychain): an ephemeral keychain under the runner's temporary
folder holds either the release identity imported from a .p12 secret or, for
dry runs, a throwaway identity created for that run only.
No trust settings or persistent keychain-search-list changes are made. Do not
distribute the keychain.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import secrets
import subprocess
import tempfile

PRIVATE = Path('/Users/mac/dev/remoteCodex/.local/mobile-release')
PREFIX = 'pockymoe-client-signing'
ROOT = Path(__file__).resolve().parent.parent
PINNED = ROOT / 'desktop/build/release-signing.json'
# macOS LibreSSL writes PKCS#12 encodings that `security import` accepts;
# a Homebrew OpenSSL 3 earlier on PATH writes ones it rejects.
OPENSSL = '/usr/bin/openssl' if Path('/usr/bin/openssl').exists() else 'openssl'
P12_PASSWORD_ENV = 'POCKYMOE_MAC_SIGNING_P12_PASSWORD'
CERTIFICATE_CONFIG = '''[req]
prompt = no
distinguished_name = name
x509_extensions = signing
[name]
CN = Pockymoe
[signing]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
'''


def command(*args, input=None):
    result = subprocess.run([str(arg) for arg in args], input=input,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        # Never render argv or raw tool output: either may contain a password.
        # codesign never receives a password, so its diagnostics are shown.
        detail = ''
        if Path(str(args[0])).name == 'codesign':
            detail = ': ' + result.stderr.decode(errors='replace').strip()[-2000:]
        raise RuntimeError(f'{Path(args[0]).name} signing setup command failed{detail}')
    return result.stdout


def setup():
    if platform.system() != 'Darwin':
        raise RuntimeError('Client signing setup requires macOS')
    PRIVATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    cert = PRIVATE / f'{PREFIX}.pem'
    key = PRIVATE / f'{PREFIX}.key'
    bundle = PRIVATE / f'{PREFIX}.p12'
    keychain = PRIVATE / f'{PREFIX}.keychain-db'
    password_file = PRIVATE / f'{PREFIX}.password'
    files = [cert, key, bundle, keychain, password_file]
    if any(path.exists() for path in files) and not all(path.exists() for path in files):
        raise RuntimeError('Partial signing identity exists; inspect it locally instead of replacing keys')
    if not cert.exists():
        password = secrets.token_urlsafe(48)
        password_file.write_text(password)
        password_file.chmod(0o600)
        create_certificate(cert, key, bundle, password, command_openssl='openssl')
        create_keychain(keychain, password, bundle, password)
    else:
        password = password_file.read_text()
        command('security', 'unlock-keychain', '-p', password, keychain)
    certificate = command('openssl', 'x509', '-in', cert, '-outform', 'DER')
    return public_hashes(certificate)


def public_hashes(certificate):
    return {'commonName': 'Pockymoe', 'certificateSha1': hashlib.sha1(certificate).hexdigest(),
            'certificateSha256': hashlib.sha256(certificate).hexdigest()}


def create_certificate(cert, key, bundle, password, command_openssl=OPENSSL):
    with tempfile.TemporaryDirectory(prefix='pockymoe-signing-') as temporary:
        config = Path(temporary) / 'certificate.cnf'
        config.write_text(CERTIFICATE_CONFIG)
        command(command_openssl, 'req', '-new', '-newkey', 'rsa:3072', '-nodes', '-x509',
                '-days', '3650', '-config', config, '-keyout', key, '-out', cert)
        key.chmod(0o600)
        command(command_openssl, 'pkcs12', '-export', '-inkey', key, '-in', cert,
                '-name', 'Pockymoe', '-out', bundle, '-passout', 'stdin',
                input=(password + '\n').encode())
        bundle.chmod(0o600)


def create_keychain(keychain, password, bundle, bundle_password, keep_in_search_list=False):
    # create-keychain changes the search list; restore its exact prior value.
    # A run-scoped CI keychain stays listed (codesign needs that on a runner)
    # until delete-keychain removes it at the end of the job.
    prior = re.findall(rb'"([^"\n]+)"', command('security', 'list-keychains', '-d', 'user'))
    if keep_in_search_list:
        prior = [str(keychain).encode(), *(path for path in prior if path != str(keychain).encode())]
    try:
        command('security', 'create-keychain', '-p', password, keychain)
        command('security', 'set-keychain-settings', '-lut', '21600', keychain)
        command('security', 'unlock-keychain', '-p', password, keychain)
        command('security', 'import', bundle, '-k', keychain, '-P', bundle_password,
                '-T', '/usr/bin/codesign', '-T', '/usr/bin/security')
        command('security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:',
                '-s', '-k', password, keychain)
    finally:
        command('security', 'list-keychains', '-d', 'user', '-s', *(path.decode() for path in prior))


def ci_paths(directory):
    return {'keychain': directory / f'{PREFIX}.keychain-db', 'password': directory / f'{PREFIX}.password',
            'public': directory / 'public.json'}


def ci_setup(directory, p12=None):
    """Create a run-scoped keychain holding the release identity (p12) or a throwaway one."""
    if platform.system() != 'Darwin':
        raise RuntimeError('Client signing setup requires macOS')
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    paths = ci_paths(directory)
    password = secrets.token_urlsafe(48)
    paths['password'].write_text(password)
    paths['password'].chmod(0o600)
    if p12 is None:
        bundle, bundle_password = directory / f'{PREFIX}.p12', password
        create_certificate(directory / f'{PREFIX}.pem', directory / f'{PREFIX}.key', bundle, password)
    else:
        bundle, bundle_password = p12, os.environ.get(P12_PASSWORD_ENV, '')
        if not bundle.is_file() or not bundle_password:
            raise RuntimeError(f'Release signing needs the .p12 file and {P12_PASSWORD_ENV}')
    create_keychain(paths['keychain'], password, bundle, bundle_password, keep_in_search_list=True)
    if p12 is None:
        # The throwaway private key exists only inside the run-scoped keychain.
        for name in (f'{PREFIX}.key', f'{PREFIX}.p12'):
            (directory / name).unlink()
    pems = re.findall(rb'-----BEGIN CERTIFICATE-----\s+([A-Za-z0-9+/=\s]+?)-----END CERTIFICATE-----',
                      command('security', 'find-certificate', '-a', '-p', paths['keychain']))
    if len(pems) != 1:
        raise RuntimeError('Signing keychain must hold exactly one certificate')
    public = public_hashes(base64.b64decode(b''.join(pems[0].split())))
    identities = command('security', 'find-identity', '-p', 'codesigning', paths['keychain']).decode()
    if public['certificateSha1'].upper() not in identities:
        raise RuntimeError('Signing keychain has no private key for its certificate')
    public['kind'] = 'throwaway' if p12 is None else 'release'
    if public['kind'] == 'release' and json.loads(PINNED.read_text())['certificateSha1'] != public['certificateSha1']:
        raise RuntimeError('Imported signing identity does not match desktop/build/release-signing.json')
    paths['public'].write_text(json.dumps(public, indent=2) + '\n')
    return public


def ci_identity(directory):
    paths = ci_paths(directory)
    command('security', 'unlock-keychain', '-p', paths['password'].read_text(), paths['keychain'])
    return json.loads(paths['public'].read_text()), paths['keychain']


def delete_ci_keychain(directory):
    keychain = ci_paths(directory)['keychain']
    if keychain.exists():
        command('security', 'delete-keychain', keychain)


def sign_app(app, public, keychain):
    app = app.resolve()
    if app.suffix != '.app' or not app.is_dir() or app.parts[:2] == ('/', 'Applications'):
        raise RuntimeError('Sign only a built .app outside /Applications')
    command('codesign', '--force', '--deep', '--sign', public['certificateSha1'],
            '--keychain', keychain, '--timestamp=none',
            '--options=0', '--preserve-metadata=entitlements', app)
    command('codesign', '--verify', '--deep', '--strict', '-R',
            '=certificate leaf = H"' + public['certificateSha1'] + '"', app)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write-public', action='store_true', help='Write public certificate hashes into desktop/build/release-signing.json')
    parser.add_argument('--sign-app', type=Path, help='Sign a built .app outside /Applications with this identity, then verify its pinned leaf certificate')
    parser.add_argument('--ci-keychain', type=Path, metavar='DIR', help='CI only: create a run-scoped keychain in this new folder')
    parser.add_argument('--p12', type=Path, help=f'With --ci-keychain: import the release identity from this .p12 (password in {P12_PASSWORD_ENV}); without it a throwaway identity is created')
    parser.add_argument('--keychain-dir', type=Path, metavar='DIR', help='Use the run-scoped keychain created by --ci-keychain')
    parser.add_argument('--delete-ci-keychain', type=Path, metavar='DIR', help='Delete the run-scoped keychain in this folder')
    args = parser.parse_args()
    os.umask(0o077)
    if args.delete_ci_keychain:
        delete_ci_keychain(args.delete_ci_keychain)
        print('Run-scoped signing keychain removed')
        return
    if args.ci_keychain:
        if args.write_public or args.sign_app or args.keychain_dir:
            parser.error('--ci-keychain only creates the keychain')
        public = ci_setup(args.ci_keychain, args.p12)
        print(f'Run-scoped {public["kind"]} signing identity ready')
        print('Public certificate SHA-1: ' + public['certificateSha1'])
        return
    if args.p12:
        parser.error('--p12 requires --ci-keychain')
    if args.keychain_dir:
        if args.write_public or not args.sign_app:
            parser.error('--keychain-dir is used with --sign-app')
        public, keychain = ci_identity(args.keychain_dir)
        if public['kind'] == 'release' and json.loads(PINNED.read_text())['certificateSha1'] != public['certificateSha1']:
            raise RuntimeError('Run-scoped identity does not match the compiled release certificate')
        sign_app(args.sign_app, public, keychain)
        print(f'Built app signed and verified against the run-scoped {public["kind"]} certificate')
        return
    public = setup()
    if args.write_public:
        target = PINNED
        target.write_text(json.dumps(public, indent=2) + '\n')
        target.chmod(0o644)
    if args.sign_app:
        pinned = json.loads(PINNED.read_text())
        if pinned['certificateSha1'] != public['certificateSha1']:
            raise RuntimeError('Local identity does not match the compiled release certificate')
        sign_app(args.sign_app, public, PRIVATE / f'{PREFIX}.keychain-db')
        print('Built app signed and verified against the pinned Pockymoe certificate')
    print('Pockymoe signing identity ready; private files remain in the local release folder')
    print('Public certificate SHA-1: ' + public['certificateSha1'])


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as error:
        raise SystemExit(str(error))
