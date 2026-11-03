// Genuine Mac A -> signed DMG -> detached swap -> B relaunch, outside /Applications.
// The temporary TEST build uses an isolated PockymoeUpdaterFixture Keychain service.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const versionA = '0.0.900', versionB = '0.0.901';
const fileName = `Pockymoe-${versionB}-mac-arm64.dmg`;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function run(command, args, options = {}) { return execFileSync(command, args, { cwd: desktop, stdio: 'inherit', ...options }); }
function pnpmEntry() {
  for (const directory of (process.env.PATH || '').split(delimiter)) {
    const path = join(directory, 'pnpm');
    if (existsSync(path)) { const entry = realpathSync(path); if (/\.(?:c?js|mjs)$/.test(entry)) return entry; }
  }
  throw new Error('Cannot locate pnpm JS entry');
}
async function until(read, message, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await read(); if (value) return value; await delay(250); }
  throw new Error(message);
}
function manifest(file, origin, privateKey) {
  const entry = { version: versionB, platform: 'darwin-arm64', fileName,
    sha256: createHash('sha256').update(readFileSync(file)).digest('hex'), size: statSync(file).size };
  entry.signature = sign(null, Buffer.from(JSON.stringify(entry)), privateKey).toString('base64');
  return { tag_name: `v${versionB}`, prerelease: false, draft: false,
    html_url: `https://github.com/dufangshi/pockymoe-app/releases/tag/v${versionB}`,
    body: `Disposable Mac updater fixture.\n<!-- pockymoe-updates-v1\n${JSON.stringify([entry])}\n-->`,
    assets: [{ name: fileName, size: entry.size, browser_download_url: `${origin}/${fileName}` }] };
}
async function roundtrip() {
  assert.equal(process.platform, 'darwin', 'The real DMG roundtrip requires the signing Mac');
  assert.equal(process.arch, 'arm64');
  const keychain = join(homedir(), 'dev/remoteCodex/.local/mobile-release/pockymoe-client-signing.keychain-db');
  const certificate = JSON.parse(readFileSync(join(desktop, 'build/release-signing.json'), 'utf8')).certificateSha1;
  assert.match(certificate, /^[0-9A-Fa-f]{40}$/);
  assert.equal(existsSync(keychain), true, 'Stable release signing keychain must exist');
  const evidence = resolve(process.env.POCKYMOE_UPDATE_EVIDENCE || join(desktop, '../.scratch/mac-update-roundtrip'));
  mkdirSync(evidence, { recursive: true });
  const temporary = mkdtempSync(join(tmpdir(), 'pockymoe-mac-update-'));
  const profile = join(temporary, 'profile'); mkdirSync(profile);
  const installed = join(temporary, 'installed/Pockymoe.app');
  const executable = join(installed, 'Contents/MacOS/Pockymoe');
  const resultPath = join(temporary, 'relaunch.json');
  const mainPath = join(desktop, 'src/main/index.ts'), packagePath = join(desktop, 'package.json');
  const observerPath = join(desktop, 'src/main/__updateFixtureObserver.mjs');
  assert.equal(existsSync(observerPath), false, 'Refuse to overwrite an existing observer');
  const originalMain = readFileSync(mainPath), originalPackage = readFileSync(packagePath);
  assert.ok(originalMain.toString().includes("app.setName('Pockymoe');"), 'Cannot safely isolate the application name');
  const fixtureAppName = `PockymoeUpdaterFixture-${randomBytes(6).toString('hex')}`;
  const report = { platform: 'darwin-arm64', versions: { from: versionA, to: versionB }, checks: {},
    keychainScope: `Only the temporary ${fixtureAppName} service; real Pockymoe items and /Applications remain untouched` };
  let release, dmg, app;
  let feedRequests = 0, downloadRequests = 0;
  const server = createServer((request, response) => {
    response.setHeader('Connection', 'close');
    if (request.url === '/latest') {
      feedRequests++; response.setHeader('Content-Type', 'application/json'); response.setHeader('ETag', '"mac-update-fixture"');
      if (!release) { response.writeHead(503); response.end('{}'); return; }
      if (request.headers['if-none-match'] === '"mac-update-fixture"') { response.writeHead(304); response.end(); return; }
      response.end(JSON.stringify(release)); return;
    }
    if (request.url === `/${fileName}` && dmg) { downloadRequests++; response.setHeader('Content-Length', String(statSync(dmg).size)); createReadStream(dmg).pipe(response); return; }
    if (request.url === '/healthz') { response.setHeader('Content-Type', 'application/json'); response.end('{"status":"ok"}'); return; }
    response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><head><title>Pockymoe Mac updater fixture</title></head><body><h1>Disposable Mac updater fixture</h1><script>window.pockymoeHost?.onCommand(c=>window.pockymoeHost.commandResult(c.id,{ok:true,data:{prepared:true}}))</script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicPath = join(temporary, 'fixture-public.pem'); writeFileSync(publicPath, publicKey.export({ format: 'pem', type: 'spki' }));
  const fixture = { appName: fixtureAppName, profile, origin, result: resultPath, versionB, secret: randomBytes(24).toString('hex'), cookie: randomBytes(24).toString('hex') };
  const inherited = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'LANG']) if (process.env[key]) inherited[key] = process.env[key];
  const env = { ...inherited, CSC_IDENTITY_AUTO_DISCOVERY: 'false', POCKYMOE_UPDATER_TEST_BUILD: '1',
    POCKYMOE_UPDATER_TEST_FEED: `${origin}/latest`, POCKYMOE_UPDATER_TEST_PUBLIC_KEY: publicPath };
  const build = version => {
    const output = join(temporary, `build-${version}`);
    const pkg = JSON.parse(originalPackage); pkg.version = version;
    writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
    run(process.execPath, [pnpmEntry(), 'build'], { env });
    run(process.execPath, [pnpmEntry(), 'exec', 'electron-builder', '--mac', '--arm64', '--dir', '--publish', 'never',
      '-c.mac.identity=null', '-c.mac.hardenedRuntime=false', '-c.mac.notarize=false', `-c.directories.output=${output}`], { env });
    const bundle = join(output, 'mac-arm64/Pockymoe.app');
    run('/usr/bin/codesign', ['--force', '--deep', '--sign', certificate, '--keychain', keychain, '--timestamp=none',
      '--entitlements', join(desktop, 'build/entitlements.mac.plist'), bundle]);
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', `=certificate leaf = H"${certificate}"`, bundle]);
    return { bundle, output };
  };
  try {
    const observer = readFileSync(join(desktop, 'test/update-fixture-observer.mjs'), 'utf8').replace('__POCKYMOE_ROUNDTRIP_FIXTURE__', JSON.stringify(fixture));
    writeFileSync(observerPath, observer);
    writeFileSync(mainPath, `import './__updateFixtureObserver.mjs';\n${originalMain.toString().replace("app.setName('Pockymoe');", `app.setName(${JSON.stringify(fixtureAppName)});`)}`);
    const a = build(versionA), b = build(versionB);
    run(process.execPath, [pnpmEntry(), 'exec', 'electron-builder', '--mac', 'dmg', '--arm64', '--prepackaged', b.bundle,
      '--publish', 'never', '-c.mac.identity=null', '-c.mac.hardenedRuntime=false', '-c.mac.notarize=false', `-c.directories.output=${b.output}`], { env });
    dmg = join(b.output, fileName); assert.equal(existsSync(dmg), true);
    release = manifest(dmg, origin, privateKey);
    mkdirSync(join(temporary, 'installed')); run('/usr/bin/ditto', [a.bundle, installed]);
    app = await electron.launch({ executablePath: executable, env: { ...env, POCKYMOE_DESKTOP_E2E: '1', POCKYMOE_DESKTOP_USER_DATA: profile }, timeout: 60_000 });
    const originalPid = await app.evaluate(({ app }) => { if (app.getVersion() !== '0.0.900') throw new Error('Wrong initial version'); return process.pid; });
    report.checks.launchedA = true;
    const encrypted = await app.evaluate(async ({ safeStorage, session }, values) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage unavailable');
      const encrypted = safeStorage.encryptString(values.secret).toString('base64');
      const partition = session.fromPartition('persist:remote-codex');
      await partition.cookies.set({ url: values.origin, name: 'update-fixture-session', value: values.cookie, expirationDate: Date.now() / 1000 + 3600, httpOnly: true });
      await partition.cookies.flushStore(); return encrypted;
    }, { origin, secret: fixture.secret, cookie: fixture.cookie });
    writeFileSync(join(profile, 'update-fixture-secret.bin'), Buffer.from(encrypted, 'base64'));
    report.checks.encryptedA = true;
    await app.evaluate(async () => { await globalThis.__pockymoeDesktopTest.updates.check(); });
    await until(async () => {
      const state = await app.evaluate(() => globalThis.__pockymoeDesktopTest.updates.state());
      if (state.status === 'error') throw new Error('Updater failed before readiness');
      return state.status === 'ready' && state.version === '0.0.901';
    }, 'Verified signed DMG never became ready', 120_000);
    report.checks.verifiedReady = true;
    await app.evaluate(() => { void globalThis.__pockymoeDesktopTest.updates.install(); });
    const relaunched = await until(() => existsSync(resultPath) && JSON.parse(readFileSync(resultPath, 'utf8')), 'B did not report persistence after the actual helper relaunch (check isolated Keychain prompt or rollback)', 120_000);
    report.relaunch = relaunched;
    assert.equal(relaunched.version, versionB); assert.equal(relaunched.packaged, true); assert.equal(relaunched.profile, true);
    assert.notEqual(relaunched.pid, originalPid); assert.equal(realpathSync(relaunched.executable), realpathSync(executable));
    report.checks.relaunchedB = true;
    report.checks.cookieSurvived = relaunched.cookie;
    report.checks.encryptedSecretSurvived = relaunched.encryptedSecret;
    assert.equal(relaunched.cookie, true, 'Fixture sign-in cookie did not survive the update');
    assert.equal(relaunched.encryptedSecret, true, 'Fixture safeStorage secret did not survive the update');
    assert.ok(feedRequests > 0 && downloadRequests > 0);
    console.log('Mac A -> verified signed DMG -> atomic helper swap -> B relaunch passed; fixture cookie and encrypted secret survived');
  } finally {
    // A blocked Keychain read is synchronous in B's main process. Close only
    // the PID emitted by our compiled observer after checking its exact path.
    if (existsSync(`${resultPath}.startup`)) {
      const started = JSON.parse(readFileSync(`${resultPath}.startup`, 'utf8'));
      try {
        const actual = execFileSync('/bin/ps', ['-p', String(started.pid), '-o', 'comm='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (realpathSync(actual) === realpathSync(executable)) {
          process.kill(started.pid, 'SIGTERM'); await delay(1000);
          const stillRunning = execFileSync('/bin/ps', ['-p', String(started.pid), '-o', 'comm='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
          if (stillRunning === actual) process.kill(started.pid, 'SIGKILL');
        }
      } catch { /* Observer normally quit already; never target another process. */ }
    }
    try { await app?.close(); } catch { /* A already quit to let the helper replace it. */ }
    writeFileSync(mainPath, originalMain); writeFileSync(packagePath, originalPackage); rmSync(observerPath, { force: true });
    if (existsSync(`${resultPath}.startup`)) report.relaunchStartup = JSON.parse(readFileSync(`${resultPath}.startup`, 'utf8'));
    report.checks.feedRequests = feedRequests; report.checks.downloadRequests = downloadRequests;
    report.success = report.checks.relaunchedB === true && report.checks.cookieSurvived === true && report.checks.encryptedSecretSurvived === true;
    // Preserve only local test evidence, never cookie/key values or private key.
    writeFileSync(join(evidence, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
    await new Promise(resolve => server.close(resolve)); server.closeAllConnections();
    // On failure, retain isolated copies for diagnosis. They are outside Applications.
    if (report.success) rmSync(temporary, { recursive: true, force: true });
    else writeFileSync(join(evidence, 'retained-test-path.txt'), `${temporary}\n`);
  }
}
if (process.argv.includes('--check')) console.log('Mac updater roundtrip harness parsed; no build or application was started');
else await roundtrip();
