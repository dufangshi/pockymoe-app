import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { windowAt } from './windowReady';
import { recordLifecycle } from './lifecycle';

test('update closes every window only after consent and preserves the app on native unload veto', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'pockymoe-close-update-'));
  writeFileSync(join(profile, 'settings.json'), JSON.stringify({ petVisible: false }));
  const server = createServer((_request, response) => {
    response.setHeader('Connection', 'close'); response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><title>Pockymoe fixture</title><h1 id="fixture">Update consent fixture</h1><script>
      window.nativeDirty=false; window.legacy=false;
      addEventListener('beforeunload', event=>{if(window.nativeDirty && event.isTrusted){event.preventDefault();event.returnValue='';}});
      window.pockymoeHost.onCommand(command=>window.pockymoeHost.commandResult(command.id,window.legacy?{ok:true}:{ok:true,data:{prepared:true}}));
    </script>`);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  const origin = `http://127.0.0.1:${address.port}`;
  const env: Record<string, string> = { POCKYMOE_DESKTOP_E2E: '1', POCKYMOE_DESKTOP_USER_DATA: profile, POCKYMOE_DESKTOP_WEB_ORIGIN: origin, POCKYMOE_DESKTOP_RELAY_ORIGIN: origin };
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key]!;
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ ...(process.env.POCKYMOE_PACKAGED_EXECUTABLE ? { executablePath: process.env.POCKYMOE_PACKAGED_EXECUTABLE } : { args: [resolve('.')] }), env });
    await recordLifecycle(app, join(process.env.POCKYMOE_DESKTOP_EVIDENCE || tmpdir(), `update-close-lifecycle-${Date.now()}.jsonl`));
    const page = await windowAt(app, origin); await expect(page.locator('#fixture')).toBeVisible();
    const count = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    const attempt = () => app!.evaluate(async () => {
      try { await globalThis.__pockymoeDesktopTest.windows.closeForUpdate(2000); return 'closed'; }
      catch (error) { return (error as { code?: string }).code; }
    });
    await page.evaluate(() => { Object.assign(window, { legacy: true }); });
    expect(await test.step('legacy page cannot grant consent', attempt)).toBe('updateCancelled');
    await page.evaluate(() => { Object.assign(window, { legacy: false, nativeDirty: true }); });
    await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.main().hide());
    expect(await test.step('native unload veto keeps controllers alive', attempt)).toBe('updateCancelled');
    expect(await app.evaluate(({ BrowserWindow }) => ({ windows: BrowserWindow.getAllWindows().length, quitting: globalThis.__pockymoeDesktopTest.windows.quitting, trayGone: globalThis.__pockymoeDesktopTest.tray.tray.isDestroyed() }))).toEqual({ windows: count, quitting: false, trayGone: false });
    await page.evaluate(() => { Object.assign(window, { nativeDirty: false }); });
    expect(await test.step('all windows actually close', attempt)).toBe('closed');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0);
    expect(await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.quitting)).toBe(false);
    await app.evaluate(async () => { await globalThis.__pockymoeDesktopTest.windows.restoreAfterUpdate(); });
    await expect.poll(() => app!.windows().some(window => window.url().startsWith(origin))).toBe(true);
  } finally {
    if (app) for (const page of app.windows()) if (!page.isClosed() && page.url().startsWith(origin)) await page.evaluate(() => { Object.assign(window, { nativeDirty: false }); }).catch(() => undefined);
    await app?.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
