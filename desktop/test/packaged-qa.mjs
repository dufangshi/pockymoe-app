// Real signed bundle + isolated three-device fixture. Never log credentials,
// authentication responses, traces, cookies, storage state or raw exceptions.
import { _electron as electron, expect } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const desktop = join(repo, 'desktop');
const executable = process.env.POCKYMOE_PACKAGED_EXECUTABLE || join(desktop, 'release/mac-arm64/Pockymoe.app/Contents/MacOS/Pockymoe');
const evidence = process.env.POCKYMOE_PACKAGED_EVIDENCE || `${(process.env.POCKYMOE_DESKTOP_EVIDENCE || '.local/desktop-evidence')}/shell/packaged`;
mkdirSync(evidence, { recursive: true });
let fixture;
try {
  fixture = JSON.parse(readFileSync(join(repo, '.local/e2e-desktop-env.json'), 'utf8'));
  for (const value of [fixture.webOrigin, fixture.relayOrigin]) {
    const url = new URL(value);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.port === '45679') throw new Error('Not an isolated fixture');
  }
} catch { throw new Error('Disposable fixture metadata unavailable or unsafe'); }
const profile = mkdtempSync(join(tmpdir(), 'pockymoe-packaged-'));
const childEnv = {};
for (const key of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME']) if (process.env[key]) childEnv[key] = process.env[key];
Object.assign(childEnv, { POCKYMOE_DESKTOP_E2E: '1', POCKYMOE_DESKTOP_APNS: '0', POCKYMOE_DESKTOP_USER_DATA: profile,
  POCKYMOE_DESKTOP_WEB_ORIGIN: fixture.webOrigin, POCKYMOE_DESKTOP_RELAY_ORIGIN: fixture.relayOrigin });
let app, stage = 'launch', authenticated = false, eventCreated = false;
const device = fixture.devices[0];
const eventThread = device.threads.filter(thread => thread.burst).at(-3)?.id || device.scenarios.events;
const eventKey = `${device.id}:${eventThread}`;
const report = { executable: resolve(executable), checks: {}, screenshots: [] };
function save() { writeFileSync(join(evidence, 'qa-results.json'), JSON.stringify(report, null, 2)); }
function control(type) {
  const result = spawnSync(join(repo, 'scripts/e2e-desktop-backend.sh'), [type, String(device.index), eventThread], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) { report.controlFailure = { status: result.status, reason: (result.stderr || '').match(/HTTP \d{3}|[Dd]evice \d+ is stopped|Thread does not belong/)?.[0] || 'Fixture CLI failed' }; throw new Error('Fixture control failed'); }
}
async function launch() {
  const app = await electron.launch({ executablePath: executable, env: childEnv, timeout: 45_000 });
  await app.context().addInitScript(() => {
    if (!localStorage.getItem('remote-codex.locale')) localStorage.setItem('remote-codex.locale', 'en');
    if (!localStorage.getItem('remote-codex-theme-mode')) localStorage.setItem('remote-codex-theme-mode', 'light');
  });
  await expect.poll(() => app.windows().some(page => page.url().startsWith(fixture.webOrigin)), { timeout: 30_000 }).toBe(true);
  return app;
}
async function webPage() { return app.windows().find(page => page.url().startsWith(fixture.webOrigin)); }
async function localPage(part) {
  await expect.poll(() => app.windows().some(page => page.url().includes(part)), { timeout: 15_000 }).toBe(true);
  return app.windows().find(page => page.url().includes(part));
}
async function screenshot(page, name, transparent = false) {
  const path = join(evidence, `${name}.png`);
  await page.screenshot({ path, animations: 'disabled', omitBackground: transparent });
  report.screenshots.push(path);
}
try {
  if (!existsSync(executable)) throw new Error('Packaged executable missing');
  app = await launch();
  const web = await webPage();
  stage = 'sign-in';
  try {
    await web.goto(`${fixture.webOrigin}/relay-portal?returnTo=%2F`);
    await web.getByLabel('Email or username', { exact: true }).fill(fixture.username);
    await web.getByLabel('Password', { exact: true }).fill(fixture.password);
    await web.getByRole('button', { name: 'Sign in', exact: true }).click();
    await web.locator('.thread-map[data-presentation="page"]').waitFor({ timeout: 30_000 });
  } catch { throw new Error('Disposable fixture sign-in did not complete'); }
  authenticated = true; report.checks.mapHome = true;
  stage = 'runtime';
  report.checks.runtime = await app.evaluate(({ app, Notification }) => ({ packaged: app.isPackaged,
    notificationSupported: Notification.isSupported(), notifications: globalThis.__pockymoeDesktopTest.capabilities().notifications,
    tray: !globalThis.__pockymoeDesktopTest.tray.tray.isDestroyed() }));
  expect(report.checks.runtime).toMatchObject({ packaged: true, notificationSupported: true, notifications: 'local', tray: true });
  await app.evaluate(({ globalShortcut }) => {
    const register = globalShortcut.register.bind(globalShortcut);
    globalShortcut.register = (accelerator, callback) => { globalThis.__packagedShortcutCallback = callback; return register(accelerator, callback); };
  });
  await web.evaluate(() => window.pockymoeHost.settings.set({ petVisible: true, petId: 'moe', petMini: false, alertMode: 'both', snoozeUntil: null, quickWindowShortcut: 'Control+Alt+Shift+P' }));
  stage = 'activity';
  await expect.poll(() => app.evaluate(() => globalThis.__pockymoeDesktopTest.hub.snapshot()?.items.filter(item => item.state === 'needsInput').length || 0), { timeout: 30_000 }).toBeGreaterThan(0);
  const counts = await app.evaluate(({ app }) => {
    const items = globalThis.__pockymoeDesktopTest.hub.snapshot().items;
    return { waiting: new Set(items.filter(item => item.state === 'needsInput').map(item => item.rootThreadKey ?? item.key)).size,
      failed: new Set(items.filter(item => ['failed', 'interrupted'].includes(item.state) && item.unread).map(item => item.rootThreadKey ?? item.key)).size,
      badge: app.dock?.getBadge() || '' };
  });
  report.checks.badge = counts;
  expect(counts.badge).toBe(String(counts.waiting));
  stage = 'pet-resources';
  const pet = await localPage('/pet/');
  await pet.waitForSelector('#sprite');
  await pet.evaluate(() => {
    window.rcDesktop.pet.onState(state => { window.__packagedPet = { packName: state.packName, imagePresent: state.imageUrl.startsWith('data:image/'), error: state.error, locale: state.locale }; window.__packagedImage = state.imageUrl; });
    window.rcDesktop.pet.ready();
  });
  await expect.poll(() => pet.evaluate(() => window.__packagedPet?.packName)).toBe('Moe');
  expect(await pet.evaluate(() => window.__packagedPet?.imagePresent)).toBe(true);
  expect(await pet.evaluate(() => window.__packagedPet?.error)).toBeNull();
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/pet/')).isVisible())).toBe(true);
  const resourceDirectory = join(dirname(executable), '../Resources/pets/moe');
  const manifest = JSON.parse(readFileSync(join(resourceDirectory, 'pet.json'), 'utf8'));
  const packagedImage = readFileSync(join(resourceDirectory, manifest.spritesheetPath));
  const renderedImage = Buffer.from((await pet.evaluate(() => window.__packagedImage)).split(',')[1], 'base64');
  const atlas = await pet.evaluate(async () => { const image = new Image(); image.src = window.__packagedImage; await image.decode(); return { width: image.naturalWidth, height: image.naturalHeight }; });
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  expect(sha256(renderedImage)).toBe(sha256(packagedImage)); expect(atlas).toEqual({ width: 1536, height: 1872 });
  report.checks.pet = { resourceDirectory, id: manifest.id, atlas, imageSha256: sha256(packagedImage) };
  stage = 'approval-trigger';
  await expect.poll(() => app.evaluate(() => globalThis.__pockymoeDesktopTest.notifications.constructed.length), { timeout: 10_000 }).toBeGreaterThan(0);
  const previous = await app.evaluate((_electron, key) => globalThis.__pockymoeDesktopTest.hub.snapshot()?.items.find(item => item.key === key)?.request?.id || null, eventKey);
  control('request-approval'); eventCreated = true; stage = 'approval-snapshot';
  let requestId;
  await expect.poll(async () => { requestId = await app.evaluate((_electron, key) => globalThis.__pockymoeDesktopTest.hub.snapshot()?.items.find(item => item.key === key)?.request?.id || null, eventKey); return requestId && requestId !== previous; }, { timeout: 20_000 }).toBeTruthy();
  const alertId = `${device.id}:${requestId}`; stage = 'approval-construction';
  await expect.poll(() => app.evaluate((_electron, alertId) => globalThis.__pockymoeDesktopTest.notifications.constructed.some(item => (item.events || [item]).some(event => event.alertId === alertId && event.type === 'needsInput')), alertId), { timeout: 10_000 }).toBe(true);
  report.checks.notification = await app.evaluate((_electron, alertId) => globalThis.__pockymoeDesktopTest.notifications.constructed.find(item => (item.events || [item]).some(event => event.alertId === alertId)), alertId);
  stage = 'native-shortcut';
  expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Control+Alt+Shift+P'))).toBe(true);
  await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.focusMain());
  if (process.env.POCKYMOE_PACKAGED_NATIVE_KEY === '1') {
    writeFileSync(join(evidence, 'shortcut-ready.json'), JSON.stringify({ shortcut: 'Control+Alt+Shift+P', nativeKey: 'ctrl+alt+shift+p', bundle: dirname(dirname(dirname(executable))) }));
    console.log('Packaged app ready for native Control+Alt+Shift+P shortcut verification.');
    await expect.poll(() => app.windows().some(page => page.url().includes('view=quick')), { timeout: 120_000 }).toBe(true);
  } else {
    // Invoke the exact callback captured while forwarding registration to the OS.
    // This verifies the global-shortcut path without pretending CDP is a HID key.
    await app.evaluate(() => { if (typeof globalThis.__packagedShortcutCallback !== 'function') throw new Error('Shortcut callback not captured'); globalThis.__packagedShortcutCallback(); });
  }
  const quick = await localPage('view=quick');
  await expect(quick.getByRole('option').first()).toBeVisible(); report.checks.shortcut = { registered: true, registeredCallbackPath: true, physicalKey: process.env.POCKYMOE_PACKAGED_NATIVE_KEY === '1' };
  stage = 'screenshots';
  await pet.evaluate(() => window.rcDesktop.pet.action({ type: 'toggleTray' }));
  for (const mode of ['light', 'dark']) {
    await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.focusMain());
    await web.locator('.matter-rail-bottom button:has(svg[data-icon="settings"])').click();
    const settings = web.getByTestId('settingsDialog'); await expect(settings).toBeVisible();
    if (!await settings.locator('input[name="settings-theme"]').count()) await settings.getByRole('button', { name: 'Preferences', exact: true }).click();
    await settings.locator(`label:has(input[name="settings-theme"][value="${mode}"])`).click();
    await expect(quick.locator('html')).toHaveAttribute('data-theme-effective', mode, { timeout: 5000 });
    await web.keyboard.press('Escape');
    await expect(web.locator('.thread-map[data-presentation="page"]')).toBeVisible();
    await web.mouse.move(400, 15);
    await web.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const badge = await app.evaluate(({ app }) => ({ waiting: new Set(globalThis.__pockymoeDesktopTest.hub.snapshot().items.filter(item => item.state === 'needsInput').map(item => item.rootThreadKey ?? item.key)).size, text: app.dock.getBadge() }));
    expect(badge.text).toBe(String(badge.waiting));
    report.checks.badgeByTheme ||= {}; report.checks.badgeByTheme[mode] = badge;
    await screenshot(web, `main-${mode}`); await screenshot(pet, `pet-${mode}`, true); await screenshot(quick, `quick-${mode}`);
  }
  stage = 'persist-and-relaunch';
  const before = await web.evaluate(() => window.pockymoeHost.settings.get());
  await app.close(); app = undefined;
  app = await launch();
  const relaunched = await webPage();
  await expect(relaunched.locator('.thread-map[data-presentation="page"]')).toBeVisible({ timeout: 30_000 });
  expect(await relaunched.evaluate(() => window.pockymoeHost.settings.get())).toEqual(before);
  await expect((await localPage('/pet/')).locator('#sprite')).toBeVisible(); report.checks.settingsSurviveRelaunch = true; report.checks.sessionSurvivesRelaunch = true;
  report.result = 'passed'; rmSync(join(evidence, 'failure-after-sign-in.png'), { force: true }); save(); console.log('Packaged app QA passed. Safe report and screenshots saved.');
} catch {
  report.result = 'failed'; report.stage = stage;
  if (authenticated && app) {
    const web = await webPage();
    report.safePage = web ? new URL(web.url()).pathname : null;
    report.runtime = await app.evaluate(() => { const runtime = globalThis.__pockymoeDesktopTest; return { hubItems: runtime?.hub.snapshot()?.items.length || 0, locale: runtime?.appearance.get()?.locale || null, constructed: runtime?.notifications.constructed?.length || 0 }; }).catch(() => null);
    await web?.screenshot({ path: join(evidence, 'failure-after-sign-in.png'), mask: [web.locator('input'), web.locator('pre'), web.locator('code')] }).catch(() => {});
  }
  save(); console.error(`Packaged QA failed at ${stage}; authentication data is not logged.`); process.exitCode = 1;
} finally {
  if (eventCreated) { try { control('complete'); } catch { /* Fixture-only best-effort settlement. */ } }
  if (app) await app.close().catch(() => {});
  rmSync(join(evidence, 'shortcut-ready.json'), { force: true });
  rmSync(profile, { recursive: true, force: true });
}
