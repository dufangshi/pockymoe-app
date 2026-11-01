// Real app + parent three-device fixture. Credentials are used only inside sign-in.
import { _electron as electron, expect } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const out = '/tmp/rc-desktop/evidence/pet/locale'; mkdirSync(out, { recursive: true });
let fixture;
try { fixture = JSON.parse(readFileSync(join(repo, '.local/e2e-desktop-env.json'), 'utf8')); }
catch { throw new Error('Fixture configuration unavailable'); }
const profile = mkdtempSync(join(tmpdir(), 'pockymoe-pet-locale-'));
const childEnv = {};
for (const key of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME']) if (process.env[key]) childEnv[key] = process.env[key];
Object.assign(childEnv, { POCKYMOE_DESKTOP_E2E: '1', POCKYMOE_DESKTOP_USER_DATA: profile, POCKYMOE_DESKTOP_THEME: 'light', POCKYMOE_DESKTOP_WEB_ORIGIN: fixture.webOrigin, POCKYMOE_DESKTOP_RELAY_ORIGIN: fixture.relayOrigin });
let app, phase = 'launch', signedIn = false;
const results = [];
try {
  app = await electron.launch({ args: ['.'], env: childEnv });
  await expect.poll(() => app.windows().some((page) => page.url().startsWith(fixture.webOrigin))).toBe(true);
  const web = app.windows().find((page) => page.url().startsWith(fixture.webOrigin));
  phase = 'sign-in';
  // Do not allow a locator failure to print a credential argument in its call log.
  try {
    await web.goto(`${fixture.webOrigin}/relay-portal?returnTo=%2F`);
    await web.getByLabel('Email or username', { exact: true }).fill(fixture.username);
    await web.getByLabel('Password', { exact: true }).fill(fixture.password);
    await web.getByRole('button', { name: 'Sign in', exact: true }).click();
    await web.locator('.thread-map[data-presentation="page"]').waitFor({ timeout: 30000 });
  } catch { throw new Error('Fixture sign-in did not complete'); }
  signedIn = true;
  phase = 'pet-ready';
  await expect.poll(() => app.windows().some((page) => page.url().includes('/pet/'))).toBe(true);
  const pet = app.windows().find((page) => page.url().includes('/pet/'));
  await pet.waitForSelector('#sprite');
  await app.evaluate(() => { const runtime = globalThis.__pockymoeDesktopTest; runtime.settings.set({ petVisible: true, snoozeUntil: null }); });
  await pet.evaluate(() => window.rcDesktop.pet.action({ type: 'toggleTray' }));
  phase = 'open-web-settings';
  await web.locator('.matter-rail-bottom button:has(svg[data-icon="settings"])').click();
  const settings = web.getByTestId('settingsDialog'); await expect(settings).toBeVisible();
  let language = settings.getByRole('combobox', { name: /^(Language|语言)$/ });
  if (!await language.count()) { await settings.getByRole('button', { name: /^(Preferences|偏好设置)$/ }).click(); language = settings.getByRole('combobox', { name: /^(Language|语言)$/ }); }
  await expect(language).toBeVisible();
  for (const locale of ['en', 'zh-CN', 'en']) {
    phase = `switch-${locale}`;
    const started = Date.now();
    await language.selectOption(locale);
    phase = `pet-lang-${locale}`;
    await expect(pet.locator('html')).toHaveAttribute('lang', locale, { timeout: 1000 });
    phase = `pet-tray-${locale}`;
    await expect(pet.locator('.tray-title')).toHaveText(locale === 'en' ? 'Activity' : '活动', { timeout: 1000 });
    if (await pet.locator('.bubble').count()) await expect(pet.locator('.bubble-kicker')).toHaveText(locale === 'en' ? /^(Approval needed|Answer needed|Task update)$/ : /^(需要你批准|需要你回答|任务动态)$/, { timeout: 1000 });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('/pet/'))?.getTitle()), { timeout: 1000 }).toBe(locale === 'en' ? 'Pockymoe · Pet' : 'Pockymoe · 桌宠');
    await expect(pet.locator('#app')).toHaveAttribute('aria-label', locale === 'en' ? 'Pockymoe · Pet' : 'Pockymoe · 桌宠', { timeout: 1000 });
    const elapsedMs = Date.now() - started;
    expect(elapsedMs).toBeLessThan(1000);
    const native = await app.evaluate(({ Menu }) => ({
      locale: globalThis.__pockymoeDesktopTest.appearance.get()?.locale,
      tray: globalThis.__pockymoeDesktopTest.tray.menuLabels,
      menu: Menu.getApplicationMenu()?.items.map((item) => item.label) || [],
    }));
    phase = `native-appearance-${locale}`;
    expect(native.locale).toBe(locale);
    phase = `native-tray-${locale}`;
    expect(native.tray).toContain(locale === 'en' ? 'Show pet' : '显示桌宠');
    phase = `native-menu-${locale}`;
    expect(native.menu).toContain(locale === 'en' ? 'File' : '文件');
    await web.screenshot({ path: `${out}/web-settings-${locale}.png` });
    await pet.screenshot({ path: `${out}/pet-tray-${locale}@2x.png`, omitBackground: true });
    phase = `pet-more-${locale}`;
    await pet.locator('[data-action="more"]').click();
    await expect(pet.getByRole('menuitem', { name: locale === 'en' ? 'Hide pet' : '隐藏桌宠', exact: true })).toBeVisible({ timeout: 1000 });
    await pet.screenshot({ path: `${out}/pet-more-${locale}@2x.png`, omitBackground: true });
    await pet.keyboard.press('Escape');
    phase = `quick-${locale}`;
    await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.toggleQuick());
    await expect.poll(() => app.windows().some((page) => page.url().includes('view=quick'))).toBe(true);
    const quick = app.windows().find((page) => page.url().includes('view=quick'));
    await expect(quick.locator('html')).toHaveAttribute('lang', locale, { timeout: 1000 });
    await expect(quick.locator('#search')).toHaveAttribute('aria-label', locale === 'en' ? 'Search active threads' : '搜索活动线程');
    await quick.screenshot({ path: `${out}/quick-${locale}.png` });
    await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.toggleQuick());
    results.push({ locale, elapsedMs, petTray: 'passed', petMore: 'passed', quick: 'passed', trayMenu: 'passed', appMenu: 'passed' });
    console.log(`PASS page Settings → ${locale}: ${elapsedMs} ms`);
  }
  rmSync(`${out}/failure-after-sign-in.png`, { force: true }); rmSync(`${out}/safe-diagnostics.json`, { force: true });
  writeFileSync(`${out}/real-app-results.json`, JSON.stringify({ result: 'passed', results }, null, 2));
} catch {
  if (signedIn && app) { const diagnostics = await app.evaluate(() => ({ appearanceLocale: globalThis.__pockymoeDesktopTest.appearance.get()?.locale ?? null, trayHasEnglish: globalThis.__pockymoeDesktopTest.tray.menuLabels.includes('Show pet'), trayHasChinese: globalThis.__pockymoeDesktopTest.tray.menuLabels.includes('显示桌宠') })).catch(() => null); writeFileSync(`${out}/safe-diagnostics.json`, JSON.stringify(diagnostics)); }
  if (signedIn && app) { const page = app.windows().find((page) => page.url().startsWith(fixture.webOrigin)); await page?.screenshot({ path: `${out}/failure-after-sign-in.png` }).catch(() => {}); }
  writeFileSync(`${out}/real-app-results.json`, JSON.stringify({ result: 'failed', phase, results }, null, 2));
  console.error(`Real-app locale QA failed at ${phase}. No authentication data is logged.`); process.exitCode = 1;
} finally { if (app) await app.close().catch(() => {}); rmSync(profile, { recursive: true, force: true }); }
