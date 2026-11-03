// Genuine Windows NSIS A -> signed download -> silent install -> B relaunch.
// No public release, real account, production address or existing app is used.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const versionA = '0.0.900';
const versionB = '0.0.901';
const fixtureGuid = 'b7d6dc27-2927-4b7e-a7b7-e936939c0691';
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
function exitOf(child, timeout = 120_000, onTimeout = () => undefined) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { onTimeout(); child.kill(); reject(new Error('Owned fixture installer timed out')); }, timeout);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`Installer exited ${code ?? signal}`)); });
  });
}

function fixtureEnvironment() {
  // NSIS probes Windows PowerShell and falls back to tasklist filtered by
  // USERNAME. A sparse environment stalls those probes on hosted runners.
  // Preserve OS context, while continuing to exclude tokens/signing secrets.
  const inherited = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'PATHEXT', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'CommonProgramFiles', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'PSModulePath']) if (process.env[key]) inherited[key] = process.env[key];
  return inherited;
}
function powershellProbe(executable, code, env, timeout = 12_000) {
  const started = Date.now();
  try {
    const text = execFileSync(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')],
      { env, encoding: 'utf8', timeout, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 });
    return { elapsedMs: Date.now() - started, ok: true, result: JSON.parse(text.replace(/^\uFEFF/, '').trim()) };
  } catch (error) {
    // Do not emit stderr/command lines/environment values, even on timeout.
    return { elapsedMs: Date.now() - started, ok: false, code: error.code || 'processFailure', status: error.status ?? null, signal: error.signal || null };
  }
}
const powershellLiteral = value => `'${String(value).replace(/'/g, "''")}'`;
function windowsPreflight(evidence) {
  const root = process.env.SystemRoot || 'C:\\Windows';
  const code = `$ErrorActionPreference='Stop'; try {
    $timer=[Diagnostics.Stopwatch]::StartNew(); $available=[bool](Get-Command Get-CimInstance -ErrorAction SilentlyContinue);
    $policy=[string](Get-ExecutionPolicy -Scope Process); $count=0;
    if($available) { $count=@(Get-CimInstance -Query 'SELECT ProcessId FROM Win32_Process' -OperationTimeoutSec 3).Count }
    @{available=$available; processPolicy=$policy; processCount=$count; cimElapsedMs=$timer.ElapsedMilliseconds; is64Bit=[Environment]::Is64BitProcess} | ConvertTo-Json -Compress
  } catch { @{errorType=$_.Exception.GetType().FullName} | ConvertTo-Json -Compress }`;
  const result = { scope: 'Only process count/policy/timing and environment-key presence; no values or command lines', probes: [] };
  const sanitized = fixtureEnvironment();
  for (const architecture of ['System32', 'SysWOW64']) {
    const executable = join(root, architecture, 'WindowsPowerShell/v1.0/powershell.exe');
    if (!existsSync(executable)) continue;
    for (const [environment, env] of [['inherited', process.env], ['fixture', sanitized]]) {
      const keys = ['USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'PSModulePath', 'PSExecutionPolicyPreference', 'ComSpec', 'SystemRoot'];
      result.probes.push({ architecture, environment, present: Object.fromEntries(keys.map(key => [key, !!env[key]])), ...powershellProbe(executable, code, env) });
    }
  }
  writeFileSync(join(evidence, 'windows-preflight.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log('Windows installer preflight saved (CIM/policy timing, no environment values)');
  return result;
}
function seedShortcut(target, link, env) {
  const ps = join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const seed = powershellProbe(ps, `$ErrorActionPreference='Stop';
    $shell=New-Object -ComObject WScript.Shell;
    $link=${powershellLiteral(link)};
    $shortcut=$shell.CreateShortcut($link);
    $shortcut.TargetPath=${powershellLiteral(target)}; $shortcut.Save();
    $saved=$shell.CreateShortcut($link);
    @{target=$saved.TargetPath; saved=(Test-Path -LiteralPath $link)} | ConvertTo-Json -Compress`, env);
  assert.equal(seed.ok, true, 'Fixture shortcut probe must complete');
  assert.equal(seed.result?.saved, true, 'Fixture shortcut must be saved');
  // Shell resolves DOS 8.3 aliases. Compare filesystem identity, not its spelling.
  assert.equal(statSync(seed.result.target).ino, statSync(target).ino, 'Saved shortcut must target the stray file');
  return seed.result;
}
function installedProgress(directory) {
  let files = 0, bytes = 0;
  const visit = (folder, depth = 0) => {
    if (depth > 12 || files > 10_000) return;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name);
      if (entry.isDirectory()) visit(file, depth + 1);
      else if (entry.isFile()) { files++; bytes += statSync(file).size; }
    }
  };
  try { visit(directory); } catch { /* Installation is concurrently creating files. */ }
  return { files, bytes };
}
function installerSnapshot(child, stage, install, executable, installerFile, evidence, captureWindow = false) {
  const root = process.env.SystemRoot || 'C:\\Windows';
  const ps = join(root, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  // Expand TEMP's RUNNER~1 alias before comparing against CIM's long path.
  const canonicalInstaller = realpathSync(installerFile);
  // Query a bounded owned process tree. Never request CommandLine or inspect an
  // unrelated window. Cropped pictures, if any, are only the initial fixture UI.
  const code = `$ErrorActionPreference='Stop'; try {
    $rootPid=${Number(child.pid)}; $owned=[Collections.Generic.HashSet[int]]::new(); [void]$owned.Add($rootPid);
    $all=@(Get-CimInstance -Query 'SELECT ProcessId,ParentProcessId,Name,ExecutablePath,WorkingSetSize,KernelModeTime,UserModeTime FROM Win32_Process' -OperationTimeoutSec 3);
    $rootProcess=$all | Where-Object {$_.ProcessId -eq $rootPid};
    if($rootProcess -and $rootProcess.ExecutablePath -ne ${powershellLiteral(canonicalInstaller)}){ @{rootPidMatchesFixture=$false} | ConvertTo-Json -Compress; exit 0 }
    for($i=0;$i -lt 4;$i++){ foreach($p in $all){ if($owned.Contains([int]$p.ParentProcessId)){ [void]$owned.Add([int]$p.ProcessId) } } }
    $processes=@($all | Where-Object {$owned.Contains([int]$_.ProcessId)} | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,KernelModeTime,UserModeTime);
    Add-Type -TypeDefinition @'
using System; using System.Text; using System.Runtime.InteropServices;
public class FixtureWindows {
 public delegate bool Callback(IntPtr hwnd, IntPtr parameter);
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback, IntPtr parameter);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd,StringBuilder text,int max);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd,StringBuilder text,int max);
 [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hwnd,Callback callback,IntPtr parameter);
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left,top,right,bottom; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd,IntPtr dc,uint flags);
}
'@;
    $windows=[Collections.Generic.List[object]]::new();
    [FixtureWindows]::EnumWindows({param($handle,$unused)
      [uint32]$owner=0; [void][FixtureWindows]::GetWindowThreadProcessId($handle,[ref]$owner);
      if($owned.Contains([int]$owner)){
        $title=[Text.StringBuilder]::new(256); $class=[Text.StringBuilder]::new(80);
        [void][FixtureWindows]::GetWindowText($handle,$title,256); [void][FixtureWindows]::GetClassName($handle,$class,80);
        $controls=[Collections.Generic.List[string]]::new();
        [FixtureWindows]::EnumChildWindows($handle,{param($c,$u) $t=[Text.StringBuilder]::new(160); [void][FixtureWindows]::GetWindowText($c,$t,160); if($t.Length -gt 0 -and $controls.Count -lt 12){$controls.Add($t.ToString())}; return $true},[IntPtr]::Zero) | Out-Null;
        $visible=[FixtureWindows]::IsWindowVisible($handle); $image=$null;
        if(${captureWindow ? '$true' : '$false'} -and $visible -and $windows.Count -lt 3){
          Add-Type -AssemblyName System.Drawing; $rect=[FixtureWindows+Rect]::new(); [void][FixtureWindows]::GetWindowRect($handle,[ref]$rect);
          $width=$rect.right-$rect.left; $height=$rect.bottom-$rect.top;
          if($width -gt 0 -and $height -gt 0 -and $width -lt 2000 -and $height -lt 1600){
            $bitmap=[Drawing.Bitmap]::new($width,$height); $graphics=[Drawing.Graphics]::FromImage($bitmap); $dc=$graphics.GetHdc();
            $printed=[FixtureWindows]::PrintWindow($handle,$dc,2); $graphics.ReleaseHdc($dc);
            if($printed){$image='initial-installer-${stage}-window-'+$windows.Count+'.png'; $bitmap.Save((Join-Path ${powershellLiteral(evidence)} $image),[Drawing.Imaging.ImageFormat]::Png)}
            $graphics.Dispose(); $bitmap.Dispose();
          }
        }
        $windows.Add(@{pid=$owner;title=$title.ToString();class=$class.ToString();visible=$visible;controls=$controls.ToArray();image=$image});
      }; return $true
    },[IntPtr]::Zero) | Out-Null;
    @{processes=$processes;windows=$windows.ToArray()} | ConvertTo-Json -Compress -Depth 5
  } catch { @{errorType=$_.Exception.GetType().FullName} | ConvertTo-Json -Compress }`;
  return { stage, at: new Date().toISOString(), installerPid: child.pid, installerExitCode: child.exitCode,
    installDirectoryExists: existsSync(install), installedExecutableExists: existsSync(executable),
    installedProgress: installedProgress(install),
    ...powershellProbe(ps, code, process.env) };
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
    if (process.platform === 'win32') seedShortcut(file, join(temporary, 'probe.lnk'), fixtureEnvironment());
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
  const stray = join(temporary, 'older-copy');
  const strayExecutable = join(stray, 'PockymoeUpdaterFixture.exe');
  const resultPath = join(temporary, 'relaunch.json');
  const mainPath = join(desktop, 'src/main/index.ts');
  const packagePath = join(desktop, 'package.json');
  const observerPath = join(desktop, 'src/main/__updateFixtureObserver.mjs');
  const originalMain = readFileSync(mainPath);
  const originalPackage = readFileSync(packagePath);
  assert.equal(existsSync(observerPath), false, 'Refuse to overwrite a leftover fixture observer');
  const report = { platform: process.platform, versions: { from: versionA, to: versionB },
    stage: 'preflight', checks: {}, smartScreenScope: 'CI installation/relaunch and process observation only; interactive real-device SmartScreen remains a separate observation' };
  let release, fileB, app;
  const preflightFile = join(evidence, 'windows-preflight.json');
  report.preflight = existsSync(preflightFile) ? JSON.parse(readFileSync(preflightFile, 'utf8')) : windowsPreflight(evidence);
  const stage = name => { report.stage = name; console.log(`Updater fixture stage: ${name}`); writeFileSync(join(evidence, 'result.json'), `${JSON.stringify(report, null, 2)}\n`); };
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
    response.end('<!doctype html><html><head><title>Pockymoe updater fixture</title></head><body><h1>Disposable updater fixture</h1><script>window.pockymoeHost?.onCommand(c=>window.pockymoeHost.commandResult(c.id,{ok:true,data:{prepared:true}}))</script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicPath = join(temporary, 'fixture-public.pem');
  writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }));
  const fixture = { profile, origin, result: resultPath, versionB,
    secret: randomBytes(24).toString('hex'), cookie: randomBytes(24).toString('hex') };
  const env = { ...fixtureEnvironment(), CSC_IDENTITY_AUTO_DISCOVERY: 'false',
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
      nsis: { guid: fixtureGuid, shortcutName: 'Pockymoe Updater Fixture', createDesktopShortcut: false, createStartMenuShortcut: true } }));
    pnpm(['build'], env);
    pnpm(['exec', 'electron-builder', '--win', 'nsis', '--x64', '--publish', 'never', '--config', configPath], env);
    return join(output, `Pockymoe-${version}-win-x64.exe`);
  };
  try {
    const observer = readFileSync(join(desktop, 'test/update-fixture-observer.mjs'), 'utf8').replace('__POCKYMOE_ROUNDTRIP_FIXTURE__', JSON.stringify(fixture));
    writeFileSync(observerPath, observer);
    writeFileSync(mainPath, `import './__updateFixtureObserver.mjs';\n${originalMain}`);
    stage('buildA'); const fileA = build(versionA);
    // Silent initial installation must not launch A. B must be launched by the
    // updater/NSIS --force-run path, never by this driver.
    stage('initialInstaller');
    const installer = spawn(fileA, ['/S', `/D=${install}`], { env, stdio: 'ignore', windowsHide: true });
    report.initialInstaller = { pid: installer.pid, snapshots: [] };
    const snapshot = (name, image = false) => {
      report.initialInstaller.snapshots.push(installerSnapshot(installer, name, install, executable, fileA, evidence, image));
      writeFileSync(join(evidence, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
    };
    const timers = [10_000, 30_000, 60_000].map(milliseconds => setTimeout(() => snapshot(`after-${milliseconds / 1000}s`), milliseconds));
    try { await exitOf(installer, 120_000, () => snapshot('timeout', true)); }
    finally { timers.forEach(clearTimeout); }
    snapshot('exited');
    await until(() => existsSync(executable), 'Initial NSIS install must produce the fixture executable', 90_000);
    report.checks.installedA = true;
    // Disposable older installation and a preserved shortcut to it reproduce
    // the wrong-copy relaunch. No second installer registration is necessary.
    cpSync(install, stray, { recursive: true });
    const ps = join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const programs = execFileSync(ps, ['-NoProfile', '-NonInteractive', '-Command', "[Environment]::GetFolderPath('Programs')"], { env, encoding: 'utf8', windowsHide: true }).trim();
    report.shortcut = seedShortcut(strayExecutable, join(programs, 'Pockymoe Updater Fixture.lnk'), env);
    report.checks.staleShortcutSeeded = true;
    // Prove the first install before spending time packaging B. This is setup
    // ordering, not an assumption about the reason an installer might stall.
    stage('buildB'); fileB = build(versionB);
    release = signedRelease(fileB, origin, privateKey);
    stage('launchA');
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
    stage('downloadB');
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
    // Registry disagreement must not redirect an in-app update away from A.
    const seedRegistry = powershellProbe(ps, `$ErrorActionPreference='Stop';
      $key='HKCU:\\Software\\${fixtureGuid}';
      if(!(Test-Path $key)){throw 'Fixture install registration absent'};
      Set-ItemProperty $key InstallLocation ${powershellLiteral(stray)};
      @{staleRegistrySeeded=((Get-ItemProperty $key).InstallLocation -eq ${powershellLiteral(stray)})} | ConvertTo-Json -Compress`, env);
    assert.equal(seedRegistry.result?.staleRegistrySeeded, true);
    report.checks.staleRegistrySeeded = true;
    stage('installB');
    await app.evaluate(() => { void globalThis.__pockymoeDesktopTest.updates.install(); });
    const relaunched = await until(() => existsSync(resultPath) && JSON.parse(readFileSync(resultPath, 'utf8')), 'Installer did not genuinely relaunch B with the isolated data', 180_000);
    assert.equal(relaunched.version, versionB);
    assert.equal(relaunched.shellVersion, versionB, 'Page bridge must report the running B version');
    report.checks.pageReportsRunningVersion = true;
    assert.equal(relaunched.packaged, true);
    assert.equal(relaunched.profile, true);
    assert.equal(relaunched.cookie, true);
    assert.equal(relaunched.encryptedSecret, true);
    assert.notEqual(relaunched.pid, originalPid, 'B must be a new process');
    assert.equal(resolve(relaunched.executable).toLowerCase(), resolve(executable).toLowerCase());
    report.checks.relaunchedB = true; stage('verifyB');
    report.checks.cookieSurvived = true;
    report.checks.encryptedSecretSurvived = true;
    report.checks.differentProcess = true;
    report.checks.usedActualInstalledPath = true;
    report.checks.feedRequests = feedRequests;
    report.checks.downloadRequests = downloadRequests;
    report.checks.smartScreenDidNotBlockInCI = true;
    assert.ok(feedRequests > 0 && downloadRequests > 0, 'The actual fixture API and binary must be requested');
    console.log('Windows installed A -> verified B download -> silent NSIS update -> B relaunch passed; cookie and encrypted secret survived');
  } catch (error) {
    report.failure = { stage: report.stage, name: error.name };
    throw error;
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
else if (process.argv.includes('--diagnostics-only')) {
  assert.equal(process.platform, 'win32');
  const evidence = resolve(process.env.POCKYMOE_UPDATE_EVIDENCE || join(desktop, 'evidence', 'update-roundtrip'));
  mkdirSync(evidence, { recursive: true }); windowsPreflight(evidence);
} else await roundtrip();
