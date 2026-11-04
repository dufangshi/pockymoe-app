#!/usr/bin/env python3
"""Generate the build plist without committing deployment hosts."""
import os, pathlib, plistlib, re, sys, urllib.parse
source = pathlib.Path(os.environ['SRCROOT'])
release = os.environ.get('CONFIGURATION') == 'Release'
raw = os.environ.get('POCKYMOE_APP_BOUND_HOSTS', '').strip()
if release and (not (source / 'Local.xcconfig').is_file() or not raw):
    sys.exit('Release requires untracked ios/Local.xcconfig with POCKYMOE_APP_BOUND_HOSTS; see docs/ios-shell.md')
hosts = [h.strip().lower() for h in raw.split(',') if h.strip()]
defaults = {}
for key in ['WEB', 'RELAY']:
    value = os.environ.get('POCKYMOE_DEFAULT_' + key + '_ORIGIN', '').strip()
    if not value: continue
    try:
        url = urllib.parse.urlsplit(value)
        port = url.port
    except ValueError:
        sys.exit('Default origins must use a valid HTTPS host and port')
    if (url.scheme != 'https' or not url.hostname or url.username or url.password
            or url.path not in ['', '/'] or url.query or url.fragment):
        sys.exit('Default origins must be HTTPS origins without credentials, paths or queries')
    defaults[key] = value.rstrip('/')
    hosts.append(url.hostname.lower())
if bool(defaults.get('WEB')) != bool(defaults.get('RELAY')):
    sys.exit('Set both default Web and Relay origins, or leave both unset')
for host in hosts:
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', host) or '..' in host or host.endswith('.example.com') or host == 'example.com':
        sys.exit('App-bound hosts must be real host names without schemes, paths, ports or wildcards')
if not release: hosts += ['localhost', '127.0.0.1', '::1']
hosts = list(dict.fromkeys(hosts))
if not 1 <= len(hosts) <= 10: sys.exit('Configure between 1 and 10 app-bound hosts')
plist = plistlib.loads((source / 'Shell' / ('Info.plist' if release else 'Info-Debug.plist')).read_bytes())
plist['WKAppBoundDomains'] = hosts
for key, value in defaults.items(): plist['PockymoeDefault' + key.title() + 'Origin'] = value
plist['PockymoeAppGroup'] = os.environ.get('POCKYMOE_APP_GROUP', '')
plist['PockymoeNativePush'] = os.environ.get('POCKYMOE_NATIVE_PUSH', 'NO') == 'YES'

output = pathlib.Path(os.environ['DERIVED_FILE_DIR']) / 'Shell-Info.plist'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_bytes(plistlib.dumps(plist, sort_keys=False))
