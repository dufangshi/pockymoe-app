import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { createServer, type Server, type RequestListener } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { windowAt } from './windowReady';

let app: ElectronApplication, dir: string;
const servers: Server[] = [];
async function fixture(handler: RequestListener): Promise<string> {
  const server = createServer(handler); servers.push(server);
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture port');
  return `http://127.0.0.1:${address.port}`;
}
test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pockymoe-connect-'));
  const env: Record<string, string> = { POCKYMOE_DESKTOP_E2E: '1', POCKYMOE_DESKTOP_USER_DATA: dir };
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'DISPLAY', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key]!;
  app = await electron.launch({ args: [resolve('.')], env });
  await windowAt(app, 'view=relay');
});
const stop = (server: Server): Promise<void> => new Promise(done => { server.close(() => done()); server.closeAllConnections(); });
test.afterEach(async () => { await test.step('close disposable app', () => app.close()); await test.step('close disposable servers', () => Promise.all(servers.splice(0).map(stop))); rmSync(dir, { recursive: true, force: true }); });
const html = '<!doctype html><html><head><title>Pockymoe</title></head><body><h1>Pockymoe fixture</h1></body></html>';

test('typed relay redirect discovers Web and keeps the typed Relay', async () => {
  const web = await fixture((_req, res) => res.end(html));
  const relay = await fixture((req, res) => { if (req.url === '/healthz') res.end('{"status":"ok"}'); else { res.writeHead(307, { Location: web }); res.end(); } });
  const setup = await windowAt(app, 'view=relay');
  await expect(setup.locator('#origin')).toHaveValue('');
  await setup.locator('#origin').fill(relay); await setup.locator('.connect').click();
  await windowAt(app, web);
  expect(await app.evaluate(() => globalThis.__pockymoeDesktopTest.settings.get())).toMatchObject({ webOrigin: web, relayOrigin: relay });
});
test('same-origin self-host connects and Advanced overrides its Relay', async () => {
  const self = await fixture((req, res) => res.end(req.url === '/healthz' ? '{"status":"ok"}' : html));
  const setup = await windowAt(app, 'view=relay');
  await setup.locator('#origin').fill(self); await setup.locator('.connect').click(); await windowAt(app, self);
  expect(await app.evaluate(() => globalThis.__pockymoeDesktopTest.settings.get())).toMatchObject({ webOrigin: self, relayOrigin: self });
  const override = await fixture((_req, res) => res.end('{"status":"ok"}'));
  await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.createLocal('relay'));
  const change = await windowAt(app, 'view=relay');
  await change.locator('#advanced').evaluate((el: HTMLDetailsElement) => { el.open = true; });
  await change.locator('#relay-origin').fill(override); await change.locator('.connect').click();
  await expect.poll(() => app.evaluate(() => globalThis.__pockymoeDesktopTest.settings.get().relayOrigin)).toBe(override);
});
test('wrong address stays on setup; a later outage offers retry and change address', async () => {
  const wrong = await fixture((_req, res) => res.end('<html><title>Unrelated site</title></html>'));
  const setup = await windowAt(app, 'view=relay'); await setup.locator('#origin').fill(wrong); await setup.locator('.connect').click();
  await expect(setup.locator('#relay-error')).not.toBeEmpty();
  expect(await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.relay.size)).toBe(0);
  expect(app.windows().some(page => page.url().includes('view=offline'))).toBe(false);
  const self = await fixture((req, res) => res.end(req.url === '/healthz' ? '{"status":"ok"}' : html));
  await setup.locator('#origin').fill(self); await setup.locator('.connect').click();
  const main = await windowAt(app, self);
  await stop(servers.at(-1)!);
  await main.reload().catch(() => undefined);
  const offline = await windowAt(app, 'view=offline');
  await expect(offline.locator('#retry')).toBeVisible(); await expect(offline.locator('#change-address')).toBeVisible();
  const closed = offline.waitForEvent('close');
  await offline.locator('#retry').click(); await closed;
  const again = await windowAt(app, 'view=offline'); await again.locator('#change-address').click();
  const form = await windowAt(app, 'view=relay'); await expect(form.locator('#origin')).toHaveValue(self);
});

test('cold-window readiness follows navigation rather than a five-second URL poll', async () => {
  const slow = await fixture((_req, res) => { setTimeout(() => res.end(html), 6000); });
  await app.evaluate((_electron, origin) => globalThis.__pockymoeDesktopTest.settings.set({ webOrigin: origin, relayOrigin: origin }), slow);
  const page = await windowAt(app, slow);
  await expect(page.getByRole('heading', { name: 'Pockymoe fixture' })).toBeVisible();
});
