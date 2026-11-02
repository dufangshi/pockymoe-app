import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import type { LocalBridge } from '../src/shared/local';

for (const profile of ['fresh', 'legacy', 'saved'] as const) test(`startup network and setup: ${profile}`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pockymoe-startup-'));
  const server = createServer((_req, res) => res.end('<h1>Saved address</h1>'));
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  const origin = `http://127.0.0.1:${address.port}`;
  if (profile !== 'fresh') writeFileSync(join(dir, 'settings.json'), JSON.stringify({ petVisible: false, petVoice: profile === 'legacy', ...(profile === 'saved' ? { webOrigin: origin, relayOrigin: origin } : {}) }));
  const bootstrap = join(dir, 'bootstrap.cjs');
  // Observe before importing main, with real startup enabled, no credentials,
  // and a simulated packaged updater that counts checks without downloading.
  writeFileSync(bootstrap, `
    const {app, net, session} = require('electron');
    app.setAppPath(${JSON.stringify(resolve('.'))});
    global.startupRequests = []; global.updateChecks = 0;
    Object.defineProperty(app, 'isPackaged', {get: () => true});
    app.setAsDefaultProtocolClient = () => true;
    require(${JSON.stringify(resolve('node_modules/electron-updater'))}).autoUpdater.checkForUpdates = async () => { global.updateChecks++; return null; };
    const fetch = net.fetch.bind(net);
    net.fetch = (url, ...args) => { global.startupRequests.push(String(url)); return fetch(url, ...args); };
    app.whenReady().then(() => {
      for (const s of [session.defaultSession, session.fromPartition('persist:remote-codex')])
        s.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']}, (details, callback) => {
          global.startupRequests.push(details.url);
          callback({cancel: !details.url.startsWith(${JSON.stringify(origin)})});
        });
    });
    require(${JSON.stringify(resolve('out/main/index.js'))});
  `);
  const env: Record<string, string> = { POCKYMOE_DESKTOP_USER_DATA: dir };
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'DISPLAY', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key]!;
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ args: [bootstrap], env });
    await expect.poll(async () => (await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.webContents.getURL()))).some(url => profile === 'saved' ? url.startsWith(origin) : url.includes('view=relay')), { timeout: 15_000 }).toBe(true);
    if (profile !== 'saved') {
      const page = app.windows().find(w => w.url().includes('view=relay'))!;
      await expect(page.locator('#origin')).toHaveValue('');
      await expect(page.locator('#origin')).toHaveAttribute('placeholder', 'https://app.example.com');
      await expect(page.locator('.hint').first()).toContainText(/default address|不再提供默认地址/);
      await page.evaluate(async () => {
        const bridge = (window as unknown as { pockymoeDesktop: LocalBridge }).pockymoeDesktop;
        await bridge.action({ type: 'checkUpdate' });
        await bridge.action({ type: 'voiceModel', command: 'download' });
        await bridge.action({ type: 'voiceDiscover' });
        await bridge.action({ type: 'voicePreview' });
      });
      await page.waitForTimeout(1000);
      expect(await app.evaluate(() => (globalThis as unknown as { startupRequests: string[] }).startupRequests)).toEqual([]);
      expect(await app.evaluate(() => (globalThis as unknown as { updateChecks: number }).updateChecks)).toBe(0);
    } else {
      expect(await app.evaluate(() => (globalThis as unknown as { updateChecks: number }).updateChecks)).toBe(1);
      expect(await app.evaluate(() => (globalThis as unknown as { startupRequests: string[] }).startupRequests)).toContain(`${origin}/`);
      expect(app.windows().some(w => w.url().includes('view=relay'))).toBe(false);
    }
  } finally {
    await app?.close();
    await new Promise<void>(done => server.close(() => done()));
    rmSync(dir, { recursive: true, force: true });
  }
});
