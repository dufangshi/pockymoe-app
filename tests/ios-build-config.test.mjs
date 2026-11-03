import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function build(settings) {
  const dir = mkdtempSync(join(tmpdir(), 'ios-config-'));
  mkdirSync(join(dir, 'Shell'));
  writeFileSync(join(dir, 'Local.xcconfig'), '// private fixture');
  writeFileSync(join(dir, 'Shell/Info.plist'), readFileSync(new URL('../ios/Shell/Info.plist', import.meta.url)));
  const result = spawnSync('python3', [resolve('scripts/ios-app-bound-domains.py')], { encoding: 'utf8', env: {
    PATH: process.env.PATH, SRCROOT: dir, DERIVED_FILE_DIR: dir, CONFIGURATION: 'Release',
    POCKYMOE_APP_BOUND_HOSTS: 'web.fixture.test', ...settings,
  } });
  const plist = result.status === 0 ? spawnSync('python3', ['-c', 'import plistlib,json,sys; print(json.dumps(plistlib.load(open(sys.argv[1],"rb"))))', join(dir, 'Shell-Info.plist')], { encoding: 'utf8' }).stdout : '';
  rmSync(dir, { recursive: true, force: true });
  return { ...result, plist: plist && JSON.parse(plist) };
}

test('embedded origins include the API-only Relay in app-bound domains without printing hosts', () => {
  const r = build({ POCKYMOE_DEFAULT_WEB_ORIGIN: 'https://web.fixture.test', POCKYMOE_DEFAULT_RELAY_ORIGIN: 'https://relay.fixture.test', POCKYMOE_APP_GROUP: '', POCKYMOE_NATIVE_PUSH: 'NO' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.plist.WKAppBoundDomains, ['web.fixture.test', 'relay.fixture.test']);
  assert.equal(r.plist.PockymoeDefaultRelayOrigin, 'https://relay.fixture.test');
  assert.equal(r.plist.PockymoeNativePush, false);
  assert.equal(r.plist.PockymoeAppGroup, '');
  assert.equal(r.stdout + r.stderr, '');
});

test('address-free builds stay address-free and incomplete/unsafe defaults fail closed', () => {
  const r = build({});
  assert.equal(r.status, 0);
  assert.equal(r.plist.PockymoeDefaultWebOrigin, undefined);
  for (const relay of ['', 'https://user:secret@relay.fixture.test', 'http://relay.fixture.test', 'https://relay.fixture.test/path']) {
    const r = build({ POCKYMOE_DEFAULT_WEB_ORIGIN: 'https://web.fixture.test', POCKYMOE_DEFAULT_RELAY_ORIGIN: relay });
    assert.notEqual(r.status, 0);
    assert.ok(!r.stderr.includes('fixture.test') && !r.stderr.includes('secret'));
  }
});
