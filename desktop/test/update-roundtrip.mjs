// Genuine Windows NSIS A -> signed download -> silent install -> B relaunch.
// No public release, real account, production address or existing app is used.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const versionA = '0.0.900';
const versionB = '0.0.901';
const fileName = `Pockymoe-${versionB}-win-x64.exe`;
const canonical = row => JSON.stringify({ version: row.version, platform: row.platform, fileName: row.fileName, sha256: row.sha256, size: row.size });
export function signedRelease(file, origin, privateKey) {
  const row = { version: versionB, platform: 'win32-x64', fileName,
    sha256: createHash('sha256').update(readFileSync(file)).digest('hex'), size: statSync(file).size };
  row.signature = sign(null, Buffer.from(canonical(row)), privateKey).toString('base64');
  return { tag_name: `v${versionB}`, prerelease: false, draft: false,
    html_url: `https://github.com/dufangshi/pockymoe-app/releases/tag/v${versionB}`,
    body: `Disposable updater acceptance fixture.\n<!-- pockymoe-updates-v1\n${JSON.stringify([row])}\n-->`,
    assets: [{ name: fileName, size: row.size, browser_download_url: `${origin}/${fileName}` }] };
}

function pnpmEntry() {
  for (const directory of (process.env.PATH || '').split(delimiter)) {
    for (const relative of ['pnpm.cjs', 'node_modules/pnpm/bin/pnpm.cjs', '../pnpm/bin/pnpm.cjs']) {
      const candidate = resolve(directory, relative);
      if (existsSync(candidate)) return candidate;
    }
    const executable = join(directory, 'pnpm');
    if (existsSync(executable)) {
      const actual = realpathSync(executable);
      if (/\.(?:c?js|mjs)$/.test(actual)) return actual;
    }
  }
  throw new Error('Cannot locate pnpm JS entry; install pnpm with pnpm/action-setup or npm');
}
function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: desktop, stdio: 'inherit', windowsHide: true, ...options });
}
function pnpm(args, env) { run(process.execPath, [pnpmEntry(), ...args], { env }); }
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(read, message, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await delay(250);
  }
  throw new Error(message);
}
function exitOf(child, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Owned fixture installer timed out')); }, timeout);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`Installer exited ${code ?? signal}`)); });
  });
}

async function selfTest() {
  const temporary = mkdtempSync(join(tmpdir(), 'pockymoe-updater-selftest-'));
  try {
    const file = join(temporary, fileName); writeFileSync(file, 'fixture installer bytes');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const release = signedRelease(file, 'http://127.0.0.1:19090', privateKey);
    const records = JSON.parse(release.body.match(/<!-- pockymoe-updates-v1\n([\s\S]*?)\n-->/)[1]);
    assert.equal(records.length, 1);
    assert.equal(verify(null, Buffer.from(canonical(records[0])), publicKey, Buffer.from(records[0].signature, 'base64')), true);
    assert.equal(verify(null, Buffer.from(canonical({ ...records[0], size: records[0].size + 1 })), publicKey, Buffer.from(records[0].signature, 'base64')), false);
    assert.equal(records[0].size, statSync(file).size);
    assert.equal(release.assets[0].name, fileName);
    console.log('Updater fixture serialization/signature self-test passed (no installer executed)');
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

async function roundtrip() {
  assert.equal(process.platform, 'win32', 'The real installer roundtrip requires Windows x64');
  assert.equal(process.arch, 'x64');
  const evidence = resolve(process.env.POCKYMOE_UPDATE_EVIDENCE || join(desktop, 'evidence', 'update-roundtrip'));
  mkdirSync(evidence, { recursive: true });
  const temporary = mkdtempSync(join(tmpdir(), 'pockymoe-update-roundtrip-'));
  const profile = join(temporary, 'profile'); mkdirSync(profile);
  const install = join(temporary, 'installed');
  const executable = join(install, 'PockymoeUpdaterFixture.exe');
  const resultPath = join(temporary, 'relaunch.json');
  const mainPath = join(desktop, 'src/main/index.ts');
  const packagePath = join(desktop, 'package.json');
  const observerPath = join(desktop, 'src/main/__updateFixtureObserver.mjs');
  const originalMain = readFileSync(mainPath);
  const originalPackage = readFileSync(packagePath);
  assert.equal(existsSync(observerPath), false, 'Refuse to overwrite a leftover fixture observer');
  const report = { platform: process.platform, versions: { from: versionA, to: versionB },
    checks: {}, smartScreenScope: 'CI installation/relaunch and process observation only; interactive real-device SmartScreen remains a separate observation' };
  let release, fileB, app;
  let feedRequests = 0, downloadRequests = 0;
  const server = createServer((request, response) => {
    response.setHeader('Connection', 'close');
    if (request.url === '/latest') {
      feedRequests++;
      response.setHeader('ETag', '"pockymoe-update-fixture-v1"');
      response.setHeader('Content-Type', 'application/json');
      if (release && request.headers['if-none-match'] === '"pockymoe-update-fixture-v1"') { response.writeHead(304); response.end(); return; }
      if (!release) { response.writeHead(503); response.end('{}'); return; }
      response.end(JSON.stringify(release)); return;
    }
    if (request.url === `/${fileName}` && fileB) {
      downloadRequests++; response.setHeader('Content-Length', String(statSync(fileB).size));
      response.setHeader('Content-Type', 'application/octet-stream'); createReadStream(fileB).pipe(response); return;
    }
    if (request.url === '/healthz') { response.setHeader('Content-Type', 'application/json'); response.end('{"status":"ok"}'); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><head><title>Pockymoe updater fixture</title></head><body><h1>Disposable updater fixture</h1></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicPath = join(temporary, 'fixture-public.pem');
  writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }));
  const fixture = { profile, origin, result: resultPath, versionB,
    secret: randomBytes(24).toString('hex'), cookie: randomBytes(24).toString('hex') };
  const inherited = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'PATHEXT', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'CommonProgramFiles']) if (process.env[key]) inherited[key] = process.env[key];
  const env = { ...inherited, CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    POCKYMOE_UPDATER_TEST_BUILD: '1', POCKYMOE_UPDATER_TEST_FEED: `${origin}/latest`, POCKYMOE_UPDATER_TEST_PUBLIC_KEY: publicPath };
  for (const key of Object.keys(env)) if (/^(?:CSC_|WIN_CSC_|APPLE_)/.test(key) && key !== 'CSC_IDENTITY_AUTO_DISCOVERY') delete env[key];
  const build = version => {
    const output = join(temporary, `build-${version}`);
    const pkg = JSON.parse(originalPackage.toString()); pkg.version = version;
    writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
    const configPath = join(temporary, `builder-${version}.json`);
    writeFileSync(configPath, JSON.stringify({ extends: join(desktop, 'electron-builder.yml'),
      appId: 'com.pockymoe.updater-fixture', productName: 'Pockymoe Updater Fixture',
      artifactName: 'Pockymoe-${version}-${os}-${arch}.${ext}', protocols: [],
      directories: { output }, win: { executableName: 'PockymoeUpdaterFixture' },
      nsis: { shortcutName: 'Pockymoe Updater Fixture', createDesktopShortcut: false, createStartMenuShortcut: false } }));
    pnpm(['build'], env);
    pnpm(['exec', 'electron-builder', '--win', 'nsis', '--x64', '--publish', 'never', '--config', configPath], env);
    return join(output, `Pockymoe-${version}-win-x64.exe`);
  };
  try {
    const observer = readFileSync(join(desktop, 'test/update-fixture-observer.mjs'), 'utf8').replace('__POCKYMOE_ROUNDTRIP_FIXTURE__', JSON.stringify(fixture));
    writeFileSync(observerPath, observer);
    writeFileSync(mainPath, `import './__updateFixtureObserver.mjs';\n${originalMain}`);
    const fileA = build(versionA);
    fileB = build(versionB);
    release = signedRelease(fileB, origin, privateKey);
    // Silent initial installation must not launch A. B must be launched by the
    // updater/NSIS --force-run path, never by this driver.
    await exitOf(spawn(fileA, ['/S', `/D=${install}`], { env, stdio: 'ignore', windowsHide: true }));
    await until(() => existsSync(executable), 'Initial NSIS install must produce the fixture executable', 90_000);
    report.checks.installedA = true;
    app = await electron.launch({ executablePath: executable, env: { ...env, POCKYMOE_DESKTOP_E2E: '1', POCKYMOE_DESKTOP_USER_DATA: profile }, timeout: 60_000 });
    const originalPid = await app.evaluate(({ app }) => { if (app.getVersion() !== '0.0.900') throw new Error('Wrong initial version'); return process.pid; });
    const encrypted = await app.evaluate(async ({ safeStorage, session }, values) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage unavailable');
      const encrypted = safeStorage.encryptString(values.secret).toString('base64');
      const partition = session.fromPartition('persist:remote-codex');
      await partition.cookies.set({ url: values.origin, name: 'update-fixture-session', value: values.cookie, expirationDate: Date.now() / 1000 + 3600, httpOnly: true });
      await partition.cookies.flushStore();
      return encrypted;
    }, { origin, secret: fixture.secret, cookie: fixture.cookie });
    writeFileSync(join(profile, 'update-fixture-secret.bin'), Buffer.from(encrypted, 'base64'));
    await app.evaluate(async () => { await globalThis.__pockymoeDesktopTest.updates.check(); });
    await until(async () => {
      const state = await app.evaluate(() => globalThis.__pockymoeDesktopTest.updates.state());
      if (state.status === 'error') throw new Error('Updater failed before readiness');
      return state.status === 'ready' && state.version === '0.0.901';
    }, 'Verified update did not become ready', 180_000);
    report.checks.verifiedReady = true;
    const downloaded = join(profile, 'updates', fileName);
    assert.equal(existsSync(downloaded), true, 'Expected verified installer download');
    let motw = false;
    try { readFileSync(`${downloaded}:Zone.Identifier`); motw = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert.equal(motw, false, 'Electron net download unexpectedly has Mark of the Web');
    report.checks.downloadHasNoMarkOfTheWeb = true;
    await app.evaluate(() => { void globalThis.__pockymoeDesktopTest.updates.install(); });
    const relaunched = await until(() => existsSync(resultPath) && JSON.parse(readFileSync(resultPath, 'utf8')), 'Installer did not genuinely relaunch B with the isolated data', 180_000);
    assert.equal(relaunched.version, versionB);
    assert.equal(relaunched.packaged, true);
    assert.equal(relaunched.profile, true);
    assert.equal(relaunched.cookie, true);
    assert.equal(relaunched.encryptedSecret, true);
    assert.notEqual(relaunched.pid, originalPid, 'B must be a new process');
    assert.equal(resolve(relaunched.executable).toLowerCase(), resolve(executable).toLowerCase());
    report.checks.relaunchedB = true;
    report.checks.cookieSurvived = true;
    report.checks.encryptedSecretSurvived = true;
    report.checks.differentProcess = true;
    report.checks.usedActualInstalledPath = true;
    report.checks.feedRequests = feedRequests;
    report.checks.downloadRequests = downloadRequests;
    report.checks.smartScreenDidNotBlockInCI = true;
    assert.ok(feedRequests > 0 && downloadRequests > 0, 'The actual fixture API and binary must be requested');
    console.log('Windows installed A -> verified B download -> silent NSIS update -> B relaunch passed; cookie and encrypted secret survived');
  } finally {
    // Only the test app/PIDs and isolated test installer are stopped/uninstalled.
    try { await app?.close(); } catch { /* A has already quit for the real update. */ }
    writeFileSync(mainPath, originalMain); writeFileSync(packagePath, originalPackage);
    rmSync(observerPath, { force: true });
    report.success = report.checks.relaunchedB === true;
    writeFileSync(join(evidence, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
    await new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    const uninstaller = existsSync(install) && readdirSync(install).find(name => /^Uninstall .*\.exe$/i.test(name));
    if (uninstaller) {
      try { await exitOf(spawn(join(install, uninstaller), ['/S'], { env, stdio: 'ignore', windowsHide: true })); }
      catch { console.error('Fixture uninstaller failed; isolated install path retained until runner cleanup'); }
    }
    // Evidence deliberately excludes private test key, cookie value and profile.
    try { rmSync(temporary, { recursive: true, force: true }); } catch { /* Runner teardown removes locked temporary files. */ }
  }
}

if (process.argv.includes('--self-test')) await selfTest();
else await roundtrip();
