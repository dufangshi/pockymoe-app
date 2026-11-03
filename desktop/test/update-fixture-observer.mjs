// Imported only by update-roundtrip's temporary TEST build, never production.
// Values are replaced with disposable paths/origins before bundling. Compiling
// the profile also covers NSIS relaunch through Explorer, which need not inherit
// the installer's environment.
import { app, BrowserWindow, safeStorage, session } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Replaced with disposable test-only constants before electron-vite bundles it.
// eslint-disable-next-line no-undef -- this file is a build template, not a production entry point.
const fixture = __POCKYMOE_ROUNDTRIP_FIXTURE__;
process.env.POCKYMOE_DESKTOP_USER_DATA = fixture.profile;
process.env.POCKYMOE_DESKTOP_WEB_ORIGIN = fixture.origin;
process.env.POCKYMOE_DESKTOP_RELAY_ORIGIN = fixture.origin;
process.env.POCKYMOE_DESKTOP_E2E = '1';
process.env.POCKYMOE_DESKTOP_APNS = '0';

void app.whenReady().then(async () => {
  writeFileSync(`${fixture.result}.startup`, JSON.stringify({ version: app.getVersion(), pid: process.pid, executable: process.execPath, packaged: app.isPackaged }, null, 2));
  if (app.getVersion() !== fixture.versionB) return;
  // Main's own ready continuation creates the persistent partition first.
  await new Promise(resolve => setTimeout(resolve, 1000));
  const checks = { version: app.getVersion(), pid: process.pid, executable: process.execPath,
    packaged: app.isPackaged, shellVersion: null, cookie: false, encryptedSecret: false, profile: false };
  writeFileSync(`${fixture.result}.startup`, JSON.stringify({ version: checks.version, pid: checks.pid, executable: checks.executable, packaged: checks.packaged }, null, 2));
  try {
    const deadline = Date.now() + 20_000;
    while (!checks.shellVersion && Date.now() < deadline) {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.webContents.getURL().startsWith(fixture.origin + '/')) continue;
        checks.shellVersion = await window.webContents.executeJavaScript('window.pockymoeHost?.capabilities().then(c => c.shellVersion)').catch(() => null);
        if (checks.shellVersion) break;
      }
      if (!checks.shellVersion) await new Promise(resolve => setTimeout(resolve, 100));
    }
    checks.profile = app.getPath('userData') === fixture.profile;
    const stored = readFileSync(join(fixture.profile, 'update-fixture-secret.bin'));
    checks.encryptedSecret = safeStorage.isEncryptionAvailable() && safeStorage.decryptString(stored) === fixture.secret;
    const cookies = await session.fromPartition('persist:remote-codex').cookies.get({ url: fixture.origin });
    checks.cookie = cookies.some(cookie => cookie.name === 'update-fixture-session' && cookie.value === fixture.cookie);
  } catch { /* Booleans identify failed persistence without recording values. */ }
  // The Mac detached helper keeps its rollback copy until a five-second live
  // process check passes. Do not mistake this observer's normal exit for a crash.
  await new Promise(resolve => setTimeout(resolve, 8000));
  writeFileSync(fixture.result, JSON.stringify(checks, null, 2));
  app.quit();
});
