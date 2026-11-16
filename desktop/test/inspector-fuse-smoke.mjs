// Launch a real package directly: Playwright's Electron launcher needs --inspect.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { getCurrentFuseWire, FuseV1Options, FuseState } from '@electron/fuses';

const [executable, expected] = process.argv.slice(2);
assert(executable && ['on', 'off'].includes(expected), 'Usage: node test/inspector-fuse-smoke.mjs EXECUTABLE on|off');
const wire = await getCurrentFuseWire(resolve(executable));
assert.equal(wire[FuseV1Options.EnableNodeCliInspectArguments], expected === 'on' ? FuseState.ENABLE : FuseState.DISABLE);
assert.equal(wire[FuseV1Options.RunAsNode], FuseState.ENABLE);
const profile = mkdtempSync(join(tmpdir(), 'pockymoe-inspector-'));
const env = {};
for (const key of ['PATH', 'HOME', 'TMPDIR', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec']) {
  if (process.env[key]) env[key] = process.env[key];
}
env.POCKYMOE_DESKTOP_USER_DATA = profile;
const connects = port => new Promise(resolve => {
  const socket = createConnection({ host: '127.0.0.1', port });
  const done = value => { socket.destroy(); resolve(value); };
  socket.setTimeout(300, () => done(false));
  socket.once('connect', () => done(true));
  socket.once('error', () => done(false));
});
let child;
try {
  // Exercise the mode used by the Mac update helper, with no inspector involved.
  const nodeOutput = execFileSync(executable, ['-e', 'process.stdout.write("run-as-node-ok")'], {
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 15_000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(nodeOutput, 'run-as-node-ok');
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  assert.equal(await connects(port), false, 'Probe port must start closed');
  child = spawn(executable, [`--inspect=127.0.0.1:${port}`], { env, stdio: 'ignore' });
  let spawnError;
  child.once('error', error => { spawnError = error; });
  let opened = false;
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    assert.equal(child.exitCode, null, 'App exited during startup');
    assert.equal(child.signalCode, null, 'App was terminated during startup');
    opened = await connects(port) || opened;
    if (expected === 'off') assert.equal(opened, false, 'Release opened a Node inspector port');
    await delay(100);
  }
  assert.equal(opened, expected === 'on', 'Inspector behavior differs from the expected fuse policy');
  if (process.platform === 'win32') {
    // Require a native app window as well as a live process, without attaching a debugger.
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$ErrorActionPreference='Stop'; $p=Get-Process -Id ${child.pid}; if ($p.MainWindowHandle -eq 0) { throw 'Packaged app has no native window' }`],
    { env, timeout: 15_000, stdio: 'pipe' });
  }
  console.log(`Packaged startup passed; RunAsNode=on executed; --inspect port ${port} ${opened ? 'opened (normal build)' : 'stayed closed for 8s (release build)'}`);
} finally {
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 15_000, stdio: 'pipe' });
    else child.kill('SIGTERM');
    const closed = await Promise.race([exited.then(() => true), delay(10_000).then(() => false)]);
    if (!closed) { child.kill('SIGKILL'); await Promise.race([exited, delay(5_000)]); }
  }
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
