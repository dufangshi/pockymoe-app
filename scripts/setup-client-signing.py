#!/usr/bin/env python3
"""Create/reuse a non-personal client signing identity in a private local keychain.

Private files stay beside this Mac's Android release key. No trust settings or
persistent keychain-search-list changes are made. Do not distribute the keychain.
"""
import argparse
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


def command(*args, input=None):
    result = subprocess.run([str(arg) for arg in args], input=input,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        # Never render argv or raw tool output: either may contain a password.
        raise RuntimeError(f'{Path(args[0]).name} signing setup command failed')
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
        with tempfile.TemporaryDirectory(prefix='pockymoe-signing-') as temporary:
            config = Path(temporary) / 'certificate.cnf'
            config.write_text('''[req]
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
''')
            command('openssl', 'req', '-new', '-newkey', 'rsa:3072', '-nodes', '-x509',
                    '-days', '3650', '-config', config, '-keyout', key, '-out', cert)
            key.chmod(0o600)
            command('openssl', 'pkcs12', '-export', '-inkey', key, '-in', cert,
                    '-name', 'Pockymoe', '-out', bundle, '-passout', 'stdin',
                    input=(password + '\n').encode())
            bundle.chmod(0o600)
        # create-keychain changes the search list; restore its exact prior value.
        prior = re.findall(rb'"([^"\n]+)"', command('security', 'list-keychains', '-d', 'user'))
        try:
            command('security', 'create-keychain', '-p', password, keychain)
            command('security', 'set-keychain-settings', '-lut', '21600', keychain)
            command('security', 'unlock-keychain', '-p', password, keychain)
            command('security', 'import', bundle, '-k', keychain, '-P', password,
                    '-T', '/usr/bin/codesign', '-T', '/usr/bin/security')
            command('security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:',
                    '-s', '-k', password, keychain)
        finally:
            command('security', 'list-keychains', '-d', 'user', '-s', *(path.decode() for path in prior))
    else:
        password = password_file.read_text()
        command('security', 'unlock-keychain', '-p', password, keychain)
    certificate = command('openssl', 'x509', '-in', cert, '-outform', 'DER')
    return {'commonName': 'Pockymoe', 'certificateSha1': hashlib.sha1(certificate).hexdigest(),
            'certificateSha256': hashlib.sha256(certificate).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write-public', action='store_true', help='Write public certificate hashes into desktop/build/release-signing.json')
    parser.add_argument('--sign-app', type=Path, help='Sign a built .app outside /Applications with this identity, then verify its pinned leaf certificate')
    args = parser.parse_args()
    os.umask(0o077)
    public = setup()
    if args.write_public:
        target = ROOT / 'desktop/build/release-signing.json'
        target.write_text(json.dumps(public, indent=2) + '\n')
        target.chmod(0o644)
    if args.sign_app:
        app = args.sign_app.resolve()
        if app.suffix != '.app' or not app.is_dir() or app.parts[:2] == ('/', 'Applications'):
            raise RuntimeError('Sign only a built .app outside /Applications')
        pinned = json.loads((ROOT / 'desktop/build/release-signing.json').read_text())
        if pinned['certificateSha1'] != public['certificateSha1']:
            raise RuntimeError('Local identity does not match the compiled release certificate')
        command('codesign', '--force', '--deep', '--sign', public['certificateSha1'],
                '--keychain', PRIVATE / f'{PREFIX}.keychain-db', '--timestamp=none',
                '--options=0', '--preserve-metadata=entitlements', app)
        command('codesign', '--verify', '--deep', '--strict', '-R',
                '=certificate leaf = H"' + public['certificateSha1'] + '"', app)
        print('Built app signed and verified against the pinned Pockymoe certificate')
    print('Pockymoe signing identity ready; private files remain in the local release folder')
    print('Public certificate SHA-1: ' + public['certificateSha1'])


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as error:
        raise SystemExit(str(error))
