#!/usr/bin/env python3
"""Generate the build plist without committing deployment hosts."""
import os, pathlib, plistlib, re, sys
source = pathlib.Path(os.environ['SRCROOT'])
release = os.environ.get('CONFIGURATION') == 'Release'
raw = os.environ.get('POCKYMOE_APP_BOUND_HOSTS', '').strip()
if release and (not (source / 'Local.xcconfig').is_file() or not raw):
    sys.exit('Release requires untracked ios/Local.xcconfig with POCKYMOE_APP_BOUND_HOSTS; see docs/ios-shell.md')
hosts = [h.strip().lower() for h in raw.split(',') if h.strip()]
for host in hosts:
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', host) or '..' in host or host.endswith('.example.com') or host == 'example.com':
        sys.exit('App-bound hosts must be real host names without schemes, paths, ports or wildcards')
if not release: hosts += ['localhost', '127.0.0.1', '::1']
hosts = list(dict.fromkeys(hosts))
if not 1 <= len(hosts) <= 10: sys.exit('Configure between 1 and 10 app-bound hosts')
plist = plistlib.loads((source / 'Shell' / ('Info.plist' if release else 'Info-Debug.plist')).read_bytes())
plist['WKAppBoundDomains'] = hosts
output = pathlib.Path(os.environ['DERIVED_FILE_DIR']) / 'Shell-Info.plist'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_bytes(plistlib.dumps(plist, sort_keys=False))
