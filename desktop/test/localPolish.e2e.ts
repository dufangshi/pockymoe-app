import { recordLifecycle } from './lifecycle';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Appearance, PockymoeHost } from '../src/shared/contract';
import { item, snapshot } from './fixtures';
import { windowAt } from './windowReady';
// Runtime type is declared by shell.e2e.ts; this spec runs only local shell flows.
declare global { interface Window { pockymoeHost?: PockymoeHost; commands: unknown[] } }
let server: Server, origin: string, app: ElectronApplication, profile: string;
const evidence = process.env.POCKYMOE_DESKTOP_EVIDENCE || join(tmpdir(), 'pockymoe-local-evidence');
test.beforeAll(async () => {
  server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><title>Isolated shell fixture</title><script>window.commands=[];window.pockymoeHost?.onCommand(command=>{window.commands.push(command);window.pockymoeHost.commandResult(command.id,{ok:true});});</script>`); });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture port missing'); origin = `http://127.0.0.1:${address.port}`;
  mkdirSync(evidence, { recursive: true });
});
test.afterAll(async () => { await new Promise<void>(done => server.close(() => done())); });
test.beforeEach(async () => {
  profile = mkdtempSync(join(tmpdir(), 'pockymoe-polish-'));
  if (test.info().title.startsWith('custom pickers')) {
    const directory = join(profile, 'pets', 'credit-fixture'); mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'pet.json'), JSON.stringify({ id: 'credit-fixture', displayName: 'Credit fixture', description: '', spritesheetPath: 'spritesheet.png', author: 'Fixture Artist', license: 'CC0', licenseUrl: 'https://example.test/license', sourceUrl: 'https://example.test/source' }));
    copyFileSync('assets/pets/placeholder/spritesheet.png', join(directory, 'spritesheet.png'));
  }
  if (test.info().title.startsWith('long pickers')) for (let index = 0; index < 12; index++) {
    const id = `extra-${index}`, directory = join(profile, 'pets', id); mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'pet.json'), JSON.stringify({ id, displayName: `Extra ${index}`, description: '', spritesheetPath: 'spritesheet.png' }));
    copyFileSync('assets/pets/placeholder/spritesheet.png', join(directory, 'spritesheet.png'));
  }
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'DISPLAY', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key]!;
  Object.assign(env, { POCKYMOE_DESKTOP_E2E: '1', POCKYMOE_DESKTOP_USER_DATA: profile, POCKYMOE_DESKTOP_WEB_ORIGIN: origin, POCKYMOE_DESKTOP_RELAY_ORIGIN: origin });
  app = await electron.launch({ ...(process.env.POCKYMOE_PACKAGED_EXECUTABLE ? { executablePath: process.env.POCKYMOE_PACKAGED_EXECUTABLE, args: process.env.POCKYMOE_DESKTOP_SCALE ? [`--force-device-scale-factor=${process.env.POCKYMOE_DESKTOP_SCALE}`] : [] } : { args: [resolve('.')] }), env });
  await recordLifecycle(app, join(evidence, `lifecycle-${Date.now()}.jsonl`));
});
test.afterEach(async () => { await app?.close(); rmSync(profile, { recursive: true, force: true }); });
async function pageAt(fragment: string): Promise<Page> {
  return windowAt(app, fragment);
}
async function mode(pack = 'classic', effective: 'light' | 'dark' = 'light'): Promise<void> {
  await app.evaluate((_e, value) => globalThis.__pockymoeDesktopTest.appearance.sync(value), { pack, effective, accent: pack === 'terminal' ? '#31bd84' : pack === 'plum-pocket' ? '#d99d36' : '#37856d', locale: 'en' } satisfies Appearance);
}
async function capture(page: Page, name: string): Promise<void> {
  for (const [size, width] of [['desktop', name.startsWith('preferences') ? 660 : name.startsWith('quick') ? 560 : 460], ['narrow', 380]] as const) {
    await app.evaluate(({ BrowserWindow }, { url, width }) => {
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url)!;
      const [, height] = window.getContentSize(); window.setContentSize(width, height);
    }, { url: page.url(), width });
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: join(evidence, `${name}-${size}.png`), animations: 'disabled' });
  }
}
test('custom pickers support keyboard, pet thumbnails/credits and recent quick targets', async () => {
  await pageAt(origin); await mode();
  await app.evaluate(() => { globalThis.__pockymoeDesktopTest.settings.set({ petVisible: false }); globalThis.__pockymoeDesktopTest.windows.createLocal('preferences'); });
  const prefs = await pageAt('view=preferences');
  await expect(prefs.locator('select')).toHaveCount(0);
  await prefs.getByRole('button', { name: 'Alert delivery', exact: true }).focus(); await prefs.keyboard.press('ArrowDown');
  await expect(prefs.getByRole('listbox')).toBeVisible(); await prefs.keyboard.press('End'); await prefs.keyboard.press('Enter');
  await expect.poll(() => app.evaluate(() => globalThis.__pockymoeDesktopTest.settings.get().alertMode)).toBe('both');
  await expect(prefs.getByRole('listbox')).toHaveCount(0);
  await prefs.getByRole('button', { name: 'Alert delivery', exact: true }).click(); await prefs.keyboard.press('Escape');
  expect(await app.evaluate(() => [...globalThis.__pockymoeDesktopTest.windows.local].find(([, role]) => role === 'preferences')![0].isVisible())).toBe(true);
  await prefs.getByRole('button', { name: 'Pet', exact: true }).click();
  await expect(prefs.locator('#petEdgeHide')).toBeChecked(); await prefs.locator('#petEdgeHide').uncheck();
  await expect.poll(() => app.evaluate(() => globalThis.__pockymoeDesktopTest.settings.get().petEdgeHide)).toBe(false);
  await prefs.getByRole('button', { name: 'Choose pet', exact: true }).click();
  const dragon = prefs.getByRole('option').filter({ hasText: 'Fixture Artist' }); await expect(dragon).toBeVisible();
  await expect.poll(() => dragon.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await dragon.click(); await expect(prefs.locator('.pet-credit')).toContainText('CC0');
  await expect(prefs.locator('.pet-credit [data-external]')).toHaveCount(2);
  await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.createLocal('about'));
  await expect((await pageAt('view=about')).locator('section')).toContainText('Fixture Artist');
  await app.evaluate(() => {
    globalThis.__pockymoeDesktopTest.hub.sync({ version: 1, accountId: 'recent', generatedAt: new Date().toISOString(), focusedThreadKey: null, items: [], syncedDeviceIds: [], recent: [{ key: 'old:recent', deviceId: 'old', deviceName: 'Older device', workspaceLabel: '21 workspaces', threadId: 'recent', title: 'Recently opened conversation' }] });
    globalThis.__pockymoeDesktopTest.windows.createLocal('quick');
  });
  const quick = await pageAt('view=quick'); await expect(quick.getByRole('option')).toHaveCount(1);
  await quick.locator('#reply').fill('Continue'); await quick.locator('#send').click();
  const web = await pageAt(origin);
  await expect.poll(() => web.evaluate(() => window.commands)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'reply', deviceId: 'old', threadId: 'recent' })]));
  await quick.getByRole('option').click();
  await expect.poll(() => web.evaluate(() => window.commands)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'navigate', path: '/devices/old/threads/recent' })]));
  await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.createLocal('relay'));
  const setup = await pageAt('view=relay'); await setup.getByText('Advanced', { exact: true }).click();
  await setup.getByLabel('Web address', { exact: true }).fill(origin); await setup.getByLabel('Relay address', { exact: true }).fill(origin);
  await setup.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect.poll(() => app.windows().some(page => page.url().includes('view=relay'))).toBe(false);
});
test('long pickers scroll within the overlay and keep keyboard options visible', async () => {
  await pageAt(origin); await mode();
  await app.evaluate(() => { globalThis.__pockymoeDesktopTest.settings.set({ petVisible: false }); globalThis.__pockymoeDesktopTest.windows.createLocal('preferences'); });
  const prefs = await pageAt('view=preferences'); await prefs.getByRole('button', { name: 'Pet', exact: true }).click();
  await prefs.getByRole('button', { name: 'Choose pet', exact: true }).click();
  expect(await prefs.locator('.select-options').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await prefs.keyboard.press('End'); await expect(prefs.getByRole('option').last()).toBeFocused();
  await expect(prefs.getByRole('option').last()).toBeInViewport({ ratio: 1 });
  await prefs.keyboard.press('Home'); await expect(prefs.getByRole('option').first()).toBeInViewport({ ratio: 1 });
  for (const pack of ['classic', 'plum-pocket', 'terminal']) for (const effective of ['light', 'dark'] as const) {
    await mode(pack, effective); await capture(prefs, `preferences-long-picker-${pack}-${effective}`);
  }
});
test('close-to-tray keeps the Web activity source running while unfocused', async () => {
  const web = await pageAt(origin);
  expect(await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.main().webContents.getBackgroundThrottling())).toBe(false);
  await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.main().close());
  expect(await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.main().isVisible())).toBe(false);
  await expect.poll(() => web.evaluate(() => document.visibilityState)).toBe('visible');
  const time = new Date().toISOString();
  await web.evaluate(value => {
    if (document.visibilityState === 'visible') window.pockymoeHost!.activity.sync(value);
  }, snapshot([item({ turnId: 'background-turn', since: time })], { generatedAt: time, syncedDeviceIds: ['mac'] }));
  await expect.poll(() => app.evaluate(() => globalThis.__pockymoeDesktopTest.hub.snapshot()?.items[0]?.turnId)).toBe('background-turn');
  expect(await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.main().isVisible())).toBe(false);
});

test('compact local surfaces in all packs, modes and desktop/narrow widths', async () => {
  test.setTimeout(120_000);
  await pageAt(origin);
  await app.evaluate(() => { globalThis.__pockymoeDesktopTest.settings.set({ petVisible: false }); for (const role of ['relay', 'preferences', 'quick', 'about'] as const) globalThis.__pockymoeDesktopTest.windows.createLocal(role); });
  const setup = await pageAt('view=relay'), prefs = await pageAt('view=preferences'), quick = await pageAt('view=quick'), about = await pageAt('view=about');
  const since = new Date().toISOString();
  const rows = [item({ since, title: 'Review the approval queue', state: 'needsInput', request: { id: 'approval', kind: 'approval', summary: 'Run targeted checks?' } }), item({ key: 'old:failed', deviceId: 'old', threadId: 'failed', title: 'Historical failed conversation', state: 'failed', unread: true }), item({ key: 'pc:running', deviceId: 'pc', threadId: 'running', title: 'Audit workspace usage', since: new Date(Date.now() - 65_000).toISOString() })];
  await app.evaluate((_e, value) => globalThis.__pockymoeDesktopTest.hub.sync(value), snapshot(rows, { generatedAt: since, syncedDeviceIds: ['mac', 'old', 'pc'] }));
  await expect(quick.getByRole('option')).toHaveCount(3); await expect(quick.locator('h2')).toHaveCount(0);
  expect((await quick.getByRole('option').first().boundingBox())!.height).toBe(34);
  expect(await quick.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  for (const pack of ['classic', 'plum-pocket', 'terminal']) for (const effective of ['light', 'dark'] as const) {
    await mode(pack, effective); await expect(prefs.locator('html')).toHaveAttribute('data-theme-effective', effective);
    await capture(setup, `setup-${pack}-${effective}`);
    await setup.locator('#advanced').evaluate((details: HTMLDetailsElement) => { details.open = true; }); await expect(setup.locator('.connect')).toBeInViewport(); await capture(setup, `setup-advanced-${pack}-${effective}`); await setup.locator('#advanced').evaluate((details: HTMLDetailsElement) => { details.open = false; });
    for (const section of ['general', 'pet', 'shortcuts']) {
      await prefs.locator(`[data-section=${section}]`).click(); await capture(prefs, `preferences-${section}-${pack}-${effective}`);
      if (section === 'pet') { await prefs.locator('#petId').click(); await capture(prefs, `preferences-picker-${pack}-${effective}`); await prefs.keyboard.press('Escape'); }
    }
    await capture(quick, `quick-${pack}-${effective}`); await capture(about, `about-${pack}-${effective}`);
  }
});

test('local confirmations trap and restore focus, cancel safely and follow every theme', async () => {
  test.setTimeout(120_000);
  await pageAt(origin);
  await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.createLocal('preferences'));
  const prefs = await pageAt('view=preferences');
  for (const pack of ['classic', 'plum-pocket', 'terminal']) for (const effective of ['light', 'dark'] as const) {
    await mode(pack, effective);
    await prefs.locator('#update').focus();
    // Exercise the Windows local renderer/queue on Mac too, without replacing Mac's native dialog path.
    await app.evaluate(() => {
      const runtime = globalThis.__pockymoeDesktopTest;
      void runtime.messages.show({ title: 'Pockymoe', message: 'Update available', detail: 'Isolated confirmation fixture', buttons: ['Download', 'Later'], cancelId: 1, defaultId: 1 }, runtime.windows.createLocal('preferences')).then(result => { runtime.lastMessageResponse = result.response; });
    });
    const prompt = prefs.getByRole('dialog'); await expect(prompt).toBeVisible();
    await expect(prompt.getByRole('button', { name: 'Later', exact: true })).toBeFocused();
    await prefs.keyboard.press('Tab'); await expect(prompt.getByRole('button', { name: 'Download', exact: true })).toBeFocused();
    await prefs.keyboard.press('Shift+Tab'); await expect(prompt.getByRole('button', { name: 'Later', exact: true })).toBeFocused();
    await capture(prefs, `preferences-confirmation-${pack}-${effective}`);
    await app.evaluate(() => [...globalThis.__pockymoeDesktopTest.windows.local].find(([, role]) => role === 'preferences')![0].setContentSize(660, 500));
    await expect.poll(() => prefs.evaluate(() => innerWidth)).toBe(660);
    await prefs.keyboard.press('Escape'); await expect(prompt).toHaveCount(0);
    await expect.poll(() => app.evaluate(() => globalThis.__pockymoeDesktopTest.lastMessageResponse)).toBe(1);
    await expect(prefs.locator('#update')).toBeFocused();
  }
});


test('empty quick reply placeholder follows language changes', async () => {
  await pageAt(origin);
  await mode();
  await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.createLocal('quick'));
  const quick = await pageAt('view=quick');
  await expect(quick.locator('#reply')).toBeDisabled();
  for (const locale of ['zh-CN', 'en']) {
    await app.evaluate((_electron, locale) => globalThis.__pockymoeDesktopTest.appearance.sync({ pack: 'classic', effective: 'light', accent: '#a57224', locale }), locale);
    await expect(quick.locator('#reply')).toHaveAttribute('placeholder', locale === 'en' ? 'Quick reply to the selected thread…' : '给选中的线程快速回复…');
  }
});
