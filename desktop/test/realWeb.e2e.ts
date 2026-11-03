import { recordLifecycle } from './lifecycle';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { auditSurface } from './surfaceAudit';

const enabled = process.env.POCKYMOE_REAL_WEB === '1';
const evidence = join(process.env.POCKYMOE_DESKTOP_EVIDENCE || join(tmpdir(), 'pockymoe-desktop-evidence'), 'real-web');
for (const surface of ['main', 'map', 'devices'] as const) for (const pack of ['classic', 'plum-pocket', 'terminal']) for (const mode of ['light', 'dark'] as const) test(`real Web ${surface} (${pack} ${mode})`, async () => {
  test.skip(!enabled, 'Start the isolated desktop backend and set POCKYMOE_REAL_WEB=1');
  test.setTimeout(90_000);
  // Private fixture metadata is consumed only here, never included in assertions or artifacts.
  const fixture = JSON.parse(readFileSync(resolve('../.local/e2e-desktop-env.json'), 'utf8'));
  for (const origin of [fixture.webOrigin, fixture.relayOrigin]) {
    const url = new URL(origin);
    if (url.hostname !== '127.0.0.1' || url.port === '45679') throw new Error('Unsafe fixture origin');
  }
  const profile = mkdtempSync(join(tmpdir(), 'pockymoe-real-web-'));
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key]!;
  Object.assign(env, { POCKYMOE_DESKTOP_E2E: '1', POCKYMOE_DESKTOP_USER_DATA: profile, POCKYMOE_DESKTOP_WEB_ORIGIN: fixture.webOrigin, POCKYMOE_DESKTOP_RELAY_ORIGIN: fixture.relayOrigin });
  let app: ElectronApplication | undefined, stage = 'launch', authenticated = false;
  try {
    app = await electron.launch({ ...(process.env.POCKYMOE_PACKAGED_EXECUTABLE ? { executablePath: process.env.POCKYMOE_PACKAGED_EXECUTABLE, args: process.env.POCKYMOE_DESKTOP_SCALE ? [`--force-device-scale-factor=${process.env.POCKYMOE_DESKTOP_SCALE}`] : [] } : { args: [resolve('.')] }), env });
  await recordLifecycle(app, join(evidence, `lifecycle-${Date.now()}.jsonl`));
    await app.context().addInitScript(({ mode }) => { localStorage.setItem('remote-codex.locale', 'en'); localStorage.setItem('remote-codex-theme-mode', mode); }, { mode });
    await expect.poll(() => app!.windows().some(page => page.url().startsWith(fixture.webOrigin))).toBe(true);
    const page = app.windows().find(page => page.url().startsWith(fixture.webOrigin))!;
    stage = 'sign in'; console.log('Real Web stage: sign in');
    await page.goto(`${fixture.webOrigin}/relay-portal?returnTo=%2F`);
    await page.getByLabel('Email or username', { exact: true }).fill(fixture.username);
    await page.getByLabel('Password', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('.thread-map[data-presentation="page"]')).toBeVisible({ timeout: 30_000 });
    authenticated = true; stage = 'choose theme'; console.log('Real Web stage: choose theme');
    stage = 'open Web Settings';
    await page.locator('.matter-rail-bottom button:has(svg[data-icon="settings"])').click();
    const settings = page.getByTestId('settingsDialog'); await expect(settings).toBeVisible();
    if (!await settings.locator('input[name="settings-theme"]').count()) await settings.getByRole('button', { name: 'Preferences', exact: true }).click();
    stage = 'choose color mode';
    await settings.locator(`label:has(input[name="settings-theme"][value="${mode}"])`).click();
    // Theme pack uses the actual Web Settings picker, not injected CSS or host-only sync.
    stage = 'choose theme pack';
    await settings.locator(`label:has(input[name="settings-theme-preset"][value="${pack}"])`).click();
    stage = 'close Web Settings';
    await page.keyboard.press('Escape');
    stage = 'wait for theme application';
    await expect(page.locator('html')).toHaveAttribute('data-theme-preset', pack);
    stage = `open ${surface}`;
    if (surface === 'main') {
      const device = fixture.devices[0];
      await app.evaluate((_electron, path) => { void globalThis.__pockymoeDesktopTest.windows.dispatch({ type: 'navigate', path }); }, `/devices/${device.id}/threads/${device.scenarios.events}`);
      stage = 'thread navigation URL';
      await expect(page).toHaveURL(new RegExp(`/threads/${device.scenarios.events}`));
      stage = 'thread content';
      await expect(page.locator('.thread-map[data-presentation="page"]')).not.toBeVisible();
      await expect(page.locator('.thread-timeline-surface').first()).toBeVisible();
      await expect(page.getByText('已完成代码审查与验证。', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
      const later = page.getByRole('button', { name: 'Later', exact: true });
      if (await later.isVisible()) await later.click();
    } else {
      await app.evaluate((_electron, type: 'openMap' | 'openDevices') => { void globalThis.__pockymoeDesktopTest.windows.dispatch({ type }); }, surface === 'map' ? 'openMap' : 'openDevices');
      await expect(page.locator(surface === 'map' ? '.thread-map-canvas' : '.pd-page').first()).toBeVisible({ timeout: 20_000 });
      if (surface === 'devices') {
        const devices = page.locator('.pd-page');
        // Seeded history can fall on yesterday when CI crosses midnight; inspect
        // that history through the real range control rather than assuming Today.
        stage = 'device history range';
        const allTime = devices.getByRole('button', { name: 'All time', exact: true });
        await allTime.click();
        await expect(allTime).toHaveAttribute('aria-pressed', 'true');
        stage = 'device historical usage';
        await expect(devices.locator('.pd-account-usage')).toContainText('gpt-5.4', { timeout: 15_000 });
      }
    }
    if (surface === 'map') await page.locator('.thread-map-filter').hover(); else await page.mouse.move(700, 12);
    await expect(page.locator('.thread-map-tip').first()).toBeHidden();
    await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, `${surface}-${pack}-${mode}.png`), animations: 'disabled' });
    if (process.platform === 'win32') {
      const expectedChrome = await page.locator('.desktop-window-titlebar').evaluate(element => {
        const style = getComputedStyle(element), canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d')!;
        const rgb = (color: string): string => {
          context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
          return '#' + Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(value => value.toString(16).padStart(2, '0')).join('');
        };
        return { toolbar: rgb(style.backgroundColor), foreground: rgb(style.color) };
      });
      await app.evaluate(({ BrowserWindow }, url) => {
        const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url)!;
        const original = window.setTitleBarOverlay.bind(window);
        window.setTitleBarOverlay = options => { (globalThis as unknown as { __capturedChrome: unknown }).__capturedChrome = options; original(options); };
        globalThis.__pockymoeDesktopTest.windows.setAppearance(globalThis.__pockymoeDesktopTest.appearance.get()!);
      }, page.url());
      await expect.poll(() => app!.evaluate(() => (globalThis as unknown as { __capturedChrome: unknown }).__capturedChrome)).toEqual({ color: expectedChrome.toolbar, symbolColor: expectedChrome.foreground, height: 38 });
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isMenuBarVisible() || window.isMenuBarAutoHide()))).toBe(false);
      const native = await app.evaluate(async ({ BrowserWindow, desktopCapturer }, url) => {
        const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url)!;
        window.show(); window.focus();
        const source = (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 2560, height: 1600 } })).find(source => source.id === window.getMediaSourceId());
        return source && !source.thumbnail.isEmpty() ? source.thumbnail.toPNG().toString('base64') : null;
      }, page.url());
      if (native) writeFileSync(join(evidence, `${surface}-${pack}-${mode}-native.png`), Buffer.from(native, 'base64'));
    }
    const facts = await page.evaluate(() => ({ devicePixelRatio, pack: document.documentElement.dataset.themePreset, mode: document.documentElement.dataset.themeEffective, width: innerWidth, height: innerHeight }));
    writeFileSync(join(evidence, `${surface}-${pack}-${mode}.json`), JSON.stringify(facts, null, 2));
    stage = 'audit real Web labels and scrollbars';
    if (process.platform === 'win32') expect(await auditSurface(page)).toEqual({ macLabels: false, scrollbars: [] });
  } catch {
    if (authenticated && app) {
      mkdirSync(evidence, { recursive: true });
      const page = app.windows().find(page => page.url().startsWith(fixture.webOrigin));
      if (page) await page.screenshot({ path: join(evidence, `failure-${surface}-${pack}-${mode}.png`), mask: [page.locator('input'), page.locator('pre'), page.locator('code')] }).catch(() => {});
    }
    // Never serialize Playwright auth errors, form values, cookies or fixture metadata.
    throw new Error(`Real Web acceptance failed at ${stage} (${surface}, ${pack}, ${mode})`);
  } finally { if (app) await app.close(); rmSync(profile, { recursive: true, force: true }); }
});
