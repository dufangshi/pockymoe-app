import { recordLifecycle } from './lifecycle';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server, type RequestListener } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ActivityHub } from '../src/main/activity';
import type { SettingsStore } from '../src/main/store';
import type { Windows } from '../src/main/windows';
import type { DesktopTray } from '../src/main/tray';
import type { Notifications } from '../src/main/notifications';
import type { AppearanceStore } from '../src/main/appearance';
import type { ShowMessage } from '../src/main/updates';
import type { LocalMessages } from '../src/main/messages';
import type { Appearance, PockymoeHost } from '../src/shared/contract';
import { resolveLocale } from '../src/shared/i18n';
import { primaryKey } from './nativeKeys';
import { windowAt } from './windowReady';
import { auditSurface } from './surfaceAudit';
import { item, snapshot } from './fixtures';

type Runtime = { messages: LocalMessages; lastMessageResponse?: number; showMessageBox: ShowMessage; lastDialog?: Electron.MessageBoxOptions; lastSave?: Electron.SaveDialogOptions; appearance: AppearanceStore; hub: ActivityHub; settings: SettingsStore; windows: Windows; tray: DesktopTray; notifications: Notifications };
declare global { var __pockymoeDesktopTest: Runtime }
declare global { interface Window { pockymoeHost?: PockymoeHost; commands: unknown[] } }
const evidence = join(process.env.POCKYMOE_DESKTOP_EVIDENCE || join(tmpdir(), 'pockymoe-shell-evidence'), 'compat');
let relay: Server, api: Server, relayOriginValue: string, other: Server, origin: string, otherOrigin: string;
const apps: ElectronApplication[] = [];
const themes = new WeakMap<ElectronApplication, 'light' | 'dark'>();
const directories: string[] = [];
async function server(handler: RequestListener): Promise<{ server: Server; origin: string }> {
  const server = createServer(handler); await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture port');
  return { server, origin: `http://127.0.0.1:${address.port}` };
}
async function launch(theme: 'light' | 'dark', firstRun = false, material = 'native'): Promise<ElectronApplication> {
  const dir = mkdtempSync(join(tmpdir(), 'rc-shell-e2e-')); directories.push(dir);
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'DISPLAY', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key]!;
  Object.assign(env, { POCKYMOE_DESKTOP_E2E: '1', POCKYMOE_DESKTOP_USER_DATA: dir, POCKYMOE_DESKTOP_THEME: theme });
  if (material === 'solid') env.POCKYMOE_WINDOWS_GLASS = 'solid';
  if (!firstRun) { env.POCKYMOE_DESKTOP_WEB_ORIGIN = origin; env.POCKYMOE_DESKTOP_RELAY_ORIGIN = relayOriginValue; }
  // Matrix captures intentionally inspect overlapping utility windows. Keep the
  // test host's native occlusion calculation from suspending their compositor.
  const captureArgs = process.platform === 'win32' ? ['--disable-features=CalculateNativeWinOcclusion'] : [];
  const app = await electron.launch({ ...(process.env.POCKYMOE_PACKAGED_EXECUTABLE ? { executablePath: process.env.POCKYMOE_PACKAGED_EXECUTABLE, args: [...captureArgs, ...(process.env.POCKYMOE_DESKTOP_SCALE ? [`--force-device-scale-factor=${process.env.POCKYMOE_DESKTOP_SCALE}`] : [])] } : { args: [resolve('.'), ...captureArgs] }), env }); await recordLifecycle(app, join(evidence, `lifecycle-${Date.now()}.jsonl`)); apps.push(app); themes.set(app, theme);
  return app;
}
async function pageAt(app: ElectronApplication, fragment: string): Promise<Page> {
  const page = await windowAt(app, fragment);
  await page!.emulateMedia({ colorScheme: themes.get(app) });
  return page!;
}
test.beforeAll(async () => {
  mkdirSync(evidence, { recursive: true });
  const external = await server((_req, res) => res.end('<!doctype html><title>Other origin</title><script>parent.postMessage({otherBridge:!!window.pockymoeHost},"*")</script>'));
  other = external.server; otherOrigin = external.origin;
  const apiFixture = await server((req, res) => {
    if (req.url === '/healthz') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ status: 'ok' })); }
    else if (req.url === '/relay/auth/oauth/github/start') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Provider sign-in</title><h1>Provider</h1>'); }
    else if (req.url === '/relay/auth/oauth/github/callback') { res.writeHead(302, { Location: `${origin}/?signedIn=1` }); res.end(); }
    else if (req.url === '/') { res.writeHead(307, { Location: origin }); res.end(); }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<html><title>Relay API only</title></html>'); }
  });
  api = apiFixture.server; relayOriginValue = apiFixture.origin;
  const fixture = await server((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/healthz') { res.writeHead(404); res.end('{}'); return; }
    if (req.url === '/STATIC_HOSTING.txt') { res.setHeader('Content-Type', 'text/plain'); res.end(`Relay API origin: ${relayOriginValue}\n`); return; }
    if (req?.url === '/frame') { res.end('<!doctype html><title>Frame</title><script>parent.postMessage({sameFrameBridge:!!window.pockymoeHost},"*")</script>'); return; }
    res.end(`<!doctype html><html><head><title>Fixture Pockymoe Web</title></head><body style="font:14px system-ui;padding:60px"><h1>Pockymoe fixture</h1><details open><summary id="settings-title">Settings</summary><label id="language-label" for="language">Interface language</label><select id="language"><option value="zh-CN">简体中文</option><option value="en">English</option></select></details><p id="status">Connected</p><iframe title="same origin" src="/frame"></iframe><iframe title="other origin" src="${otherOrigin}"></iframe><script>
      window.commands=[]; window.uiLocale='zh-CN'; window.needsThread=false; window.syncLocale=()=>{document.documentElement.lang=window.uiLocale;window.pockymoeHost?.appearance.sync({effective:matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light',pack:'classic',accent:'#a57224',locale:window.uiLocale});};document.getElementById('language').onchange=e=>{window.uiLocale=e.target.value;window.syncLocale();}; window.syncLocale(); window.searchKeys=0; window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){e.preventDefault();window.searchKeys++;}}); window.frameResults={}; window.addEventListener('message',e=>Object.assign(window.frameResults,e.data));
      window.pockymoeHost?.onCommand(command=>{window.commands.push(command); if(command.type==='navigate'){history.pushState({},'',command.path);document.getElementById('status').textContent=command.path;} window.pockymoeHost.commandResult(command.id,command.type==='reply'&&window.needsThread?{ok:false,code:'needsThread',error:window.uiLocale==='en'?'Open this thread before replying.':'请在线程中打开后回复。'}:{ok:true});});
    </script></body></html>`);
  }); relay = fixture.server; origin = fixture.origin;
});
test.afterEach(async () => { for (const app of apps.splice(0)) await app.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
test.afterAll(async () => { await Promise.all([new Promise<void>(done => relay.close(() => done())), new Promise<void>(done => other.close(() => done())), new Promise<void>(done => api.close(() => done()))]); });

test('pet controls never raise the main window, and a click shows the capsule first', async () => {
  const app = await launch('light'); const page = await pageAt(app, origin);
  await expect.poll(() => page.evaluate(() => !!window.pockymoeHost)).toBe(true);
  const surfaces = (): Page[] => app.windows().filter(w => w.url().includes('/pet/'));
  await expect.poll(() => surfaces().length).toBe(2);
  const bySurface = async (name: string): Promise<Page> => { for (const w of surfaces()) if (await w.evaluate(() => document.body.dataset.surface) === name) return w; throw new Error(name); };
  await expect.poll(async () => { try { await bySurface('glass'); await bySurface('sprite'); return true; } catch { return false; } }).toBe(true);
  const sprite = await bySurface('sprite'), glass = await bySurface('glass');
  const act = (action: unknown) => sprite.evaluate(a => (window as never as { rcDesktop: { pet: { action(x: unknown): Promise<{ ok: boolean }> } } }).rcDesktop.pet.action(a), action);
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().startsWith('http')) w.hide(); });
  const mainVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.webContents.getURL().startsWith('http') && w.isVisible()));
  expect(await mainVisible()).toBe(false);
  await act({ type: 'click' });
  await expect(glass.locator('nav.controls')).toBeVisible();
  await expect(glass.locator('.panel')).toHaveCount(0);
  await expect.poll(() => sprite.evaluate(() => document.querySelector<HTMLElement>('#app')?.dataset.lastCue)).toBe('click:running');
  await act({ type: 'toggleTray' });
  await expect(glass.locator('.panel')).toBeVisible();
  expect(await mainVisible()).toBe(false);
  await act({ type: 'close' });
  await expect(glass.locator('.panel')).toHaveCount(0);
  expect(await mainVisible()).toBe(false);
  await app.evaluate(() => { void globalThis.__pockymoeDesktopTest.windows.dispatch({ type: 'markRead', key: 'missing' }); });
  expect(await mainVisible()).toBe(false);
  await act({ type: 'preferences' });
  await pageAt(app, 'view=preferences');
  expect(await mainVisible()).toBe(false);
});
test('OAuth finishes in a bridge-free sign-in window on the page session', async () => {
  const app = await launch('light'); const page = await pageAt(app, origin);
  await page.evaluate(start => { location.assign(start); }, `${relayOriginValue}/relay/auth/oauth/github/start`);
  const signIn = await pageAt(app, '/relay/auth/oauth/github/start');
  await expect(signIn).toHaveTitle('Provider sign-in');
  expect(await signIn.evaluate(() => typeof window.pockymoeHost)).toBe('undefined');
  expect(await signIn.evaluate(() => navigator.userAgent)).not.toMatch(/Electron|Pockymoe/i);
  if (process.platform === 'win32') expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isMenuBarVisible() || window.isMenuBarAutoHide()))).toBe(false);
  expect(page.url()).not.toContain('/relay/auth/');
  await signIn.evaluate(callback => { location.assign(callback); }, `${relayOriginValue}/relay/auth/oauth/github/callback`);
  await expect.poll(() => page.url()).toContain('signedIn=1');
  await expect.poll(() => app.windows().some(w => w.url().includes('/relay/auth/'))).toBe(false);
  expect(await page.evaluate(() => !!window.pockymoeHost)).toBe(true);
});
test('a real-length notification id reaches the system without an uncaught error', async () => {
  // Device and turn ids are UUIDs, which together exceed what Windows accepts.
  const device = 'df3c6acc-a4fc-4e7b-94cd-3df6b5505ae8', turn = '28566358-df65-49ee-9b38-eba327d0bf9a', thread = '195525c3-f221-429a-9860-eb82cbd10db9';
  const app = await launch('light'); const page = await pageAt(app, origin);
  await expect.poll(() => page.evaluate(() => !!window.pockymoeHost)).toBe(true);
  await app.evaluate(() => { globalThis.__pockymoeDesktopTest.settings.set({ alertMode: 'system', petVisible: false }); });
  const done = item({ key: `${device}:${thread}`, deviceId: device, threadId: thread, turnId: turn, state: 'completed', unread: true, resultSummary: 'done' });
  await page.evaluate(s => { window.pockymoeHost!.activity.sync({ ...s, items: [], generatedAt: '2026-11-01T05:59:00.000Z', syncedDeviceIds: [s.items[0]!.deviceId] }); window.pockymoeHost!.activity.sync(s); }, snapshot([done]));
  await expect.poll(() => app.evaluate(() => globalThis.__pockymoeDesktopTest.notifications.constructed.map(entry => entry.alertId)), { timeout: 8000 }).toContain(`${device}:${turn}`);
});
test('split origins bridge, activity delivery, tray and quick-window command round trip', async () => {
  const app = await launch('light'); const page = await pageAt(app, origin);
  await expect.poll(() => page.evaluate(() => !!window.pockymoeHost)).toBe(true);
  expect(await page.evaluate(() => window.pockymoeHost!.capabilities())).toMatchObject({ surface: 'desktop', bridgeVersion: 2, features: { multiWindow: true, quickWindow: true } });
  await expect.poll(() => page.evaluate(() => (window as unknown as { frameResults: unknown }).frameResults)).toEqual({ sameFrameBridge: false, otherBridge: false });
  await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.focusMain());
  if (process.platform === 'win32') await expect.poll(() => app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.main().isFocused())).toBe(true);
  await page.getByRole('heading', { name: 'Pockymoe fixture', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
  await primaryKey(app, 'k');
  await expect.poll(() => page.evaluate(() => (window as unknown as { searchKeys: number }).searchKeys)).toBe(1);
  await app.evaluate(() => { globalThis.__pockymoeDesktopTest.settings.set({ petVisible: false }); globalThis.__pockymoeDesktopTest.windows.focusMain(); });
  const active = item({ state: 'needsInput', request: { id: 'req-1', kind: 'approval', summary: '运行 cargo test -p runtime' } });
  const running = item({ key: 'pc:thread-2', deviceId: 'pc', deviceName: 'Windows Studio', threadId: 'thread-2', turnId: 'turn-2', title: '完善设备统计视图', workspaceLabel: 'supervisor-web' });
  const completed = item({ key: 'mac:thread-3', threadId: 'thread-3', turnId: 'turn-3', title: '优化工作区树形导航', state: 'completed', unread: true, resultSummary: '键盘导航与过滤已完成' });
  await page.evaluate(s => { window.pockymoeHost!.activity.sync({ ...s, items: [], generatedAt: '2026-11-01T05:59:00.000Z', syncedDeviceIds: ['mac', 'pc'] }); window.pockymoeHost!.activity.sync(s); }, snapshot([active, running, completed]));
  await expect.poll(() => app.evaluate(() => globalThis.__pockymoeDesktopTest.tray.menuLabels)).toContain('修复登录状态同步 — MacBook Pro');
  expect(await app.evaluate(() => globalThis.__pockymoeDesktopTest.notifications.decisions)).toEqual(expect.arrayContaining([expect.objectContaining({ alertId: 'mac:req-1', system: true })]));
  await app.evaluate(({ globalShortcut }) => { if (!globalShortcut.isRegistered('Alt+Space')) throw new Error('Quick shortcut not registered'); globalThis.__pockymoeDesktopTest.windows.toggleQuick(); });
  const quick = await pageAt(app, 'view=quick');
  await expect(quick.getByRole('option')).toHaveCount(3);
  await quick.screenshot({ animations: 'disabled', path: join(evidence, 'quick-light.png') });
  await quick.getByLabel('快速回复').fill('请继续，并运行定向测试'); await quick.getByLabel('发送回复', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.commands)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'reply', threadId: 'thread-1', text: '请继续，并运行定向测试' })]));
  await quick.getByLabel('搜索活动线程').focus(); await quick.keyboard.press('Enter');
  await expect(page).toHaveURL(`${origin}/devices/mac/threads/thread-1`);
  await expect.poll(() => page.evaluate(() => window.commands)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'navigate', path: '/devices/mac/threads/thread-1' })]));
  // A focused thread must be suppressed even when focus changes in the same sync.
  await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.focusMain());
  await page.evaluate(s => { window.pockymoeHost!.activity.sync({ ...s, items: [], generatedAt: '2026-11-01T05:59:00.000Z', syncedDeviceIds: ['mac', 'pc'] }); window.pockymoeHost!.activity.sync(s); }, snapshot([item({ state: 'completed', turnId: 'focused-turn', unread: true })], { focusedThreadKey: 'mac:thread-1', generatedAt: '2026-11-01T06:02:00.000Z' }));
  await expect.poll(() => app.evaluate(() => globalThis.__pockymoeDesktopTest.notifications.decisions.find(d => d.alertId === 'mac:focused-turn'))).toMatchObject({ system: false, pet: false });
  await page.evaluate(() => window.pockymoeHost!.window.openThread('/devices/pc/threads/thread-2', { newWindow: true }));
  const second = await pageAt(app, '/devices/pc/threads/thread-2');
  expect(await second.evaluate(() => !!window.pockymoeHost)).toBe(true);
  expect(await app.evaluate(({ session }) => [...globalThis.__pockymoeDesktopTest.windows.relay].every(w => w.webContents.session === session.fromPartition('persist:remote-codex')))).toBe(true);
  await app.evaluate(() => {
    const w = [...globalThis.__pockymoeDesktopTest.windows.relay].find(w => w.webContents.getURL().endsWith('/devices/pc/threads/thread-2'))!;
    w.close();
    if (w.isDestroyed() || w.isVisible()) throw new Error('Close must hide the relay window');
    globalThis.__pockymoeDesktopTest.windows.focusMain();
  });
  // A foreign top-level page with the relay preload gets no host bridge either.
  const foreignId = await app.evaluate(({ BrowserWindow, app }, foreign) => {
    const w = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: `${app.getAppPath()}/out/preload/relay.js`, additionalArguments: [`--pockymoe-web-origin=${globalThis.__pockymoeDesktopTest.settings.get().webOrigin}`] } });
    void w.loadURL(foreign); return w.webContents.id;
  }, `${relayOriginValue}/only-api`);
  const foreign = await pageAt(app, relayOriginValue);
  expect(await foreign.evaluate(() => typeof window.pockymoeHost)).toBe('undefined');
  await app.evaluate(({ webContents }, id) => webContents.fromId(id)?.close(), foreignId);
  await page.evaluate(() => window.pockymoeHost!.window.openPreferences('pet'));
  const prefs = await pageAt(app, 'view=preferences'); await expect(prefs.getByRole('heading', { name: '桌宠', exact: true })).toBeVisible();
  await prefs.getByRole('button', { name: '通用', exact: true }).click();
  await expect(prefs.getByRole('heading', { name: '通用', exact: true })).toBeVisible();
  await page.evaluate(() => window.pockymoeHost!.window.openPreferences('pet'));
  await expect(prefs.getByRole('heading', { name: '桌宠', exact: true })).toBeVisible();
  await page.evaluate(() => window.pockymoeHost!.window.openPreferences('shortcuts'));
  await expect(prefs.getByRole('heading', { name: '快捷键', exact: true })).toBeVisible();
  await page.evaluate(() => window.pockymoeHost!.window.openPreferences());
  await expect(prefs.getByRole('heading', { name: '通用', exact: true })).toBeVisible();
  expect(await app.evaluate(() => [...globalThis.__pockymoeDesktopTest.windows.local.values()].filter(role => role === 'preferences').length)).toBe(1);
  await app.evaluate(() => { void globalThis.__pockymoeDesktopTest.windows.dispatch({ type: 'openMap' }); void globalThis.__pockymoeDesktopTest.windows.dispatch({ type: 'revealInMap', key: 'mac:thread-1' }); });
  await expect.poll(() => page.evaluate(() => window.commands)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'openMap' }), expect.objectContaining({ type: 'revealInMap', key: 'mac:thread-1' })]));
});

const packs = ['classic', 'plum-pocket', 'terminal'] as const;
function appearanceFor(pack: string, effective: 'light' | 'dark'): Appearance {
  return { effective, pack, locale: 'zh-CN', accent: pack === 'terminal' ? effective === 'dark' ? '#4de3a2' : '#0a47c4' : pack === 'plum-pocket' ? '#e8a93a' : '#a57224' };
}
async function capture(app: ElectronApplication, page: Page, name: string, pack: string, mode: string, widths = [1440, 900]): Promise<void> {
  await page.screenshot({ animations: 'disabled', path: join(evidence, `${name}-${pack}-${mode}-native.png`) });
  const original = await app.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL() === url)!.getContentSize(), page.url());
  for (const width of widths) {
    await app.evaluate(({ BrowserWindow }, { url, width, height }) => {
      const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL() === url)!;
      w.setContentSize(width, height);
    }, { url: page.url(), width, height: width <= 560 ? original[1] : 640 });
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ animations: 'disabled', path: join(evidence, `${name}-${pack}-${mode}-${width}.png`) });
  }
  await app.evaluate(({ BrowserWindow }, { url, size }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL() === url)!.setContentSize(size[0], size[1]), { url: page.url(), size: original });
}
for (const pack of packs) for (const theme of ['light', 'dark'] as const) test(`local windows appearance and origin discovery (${pack} ${theme})`, async () => {
  test.setTimeout(60_000); // Capture native, phone and desktop surfaces before the live-timer check.
  const app = await launch(theme, true);
  const setup = await pageAt(app, 'view=relay');
  const appearance = appearanceFor(pack, theme);
  await app.evaluate((_electron, value) => globalThis.__pockymoeDesktopTest.appearance.sync(value), appearance);
  await expect(setup.locator('html')).toHaveAttribute('data-theme-preset', pack);
  await expect(setup.locator('html')).toHaveAttribute('data-theme-effective', theme);
  await expect(setup.getByRole('heading', { name: '连接 Pockymoe' })).toBeVisible();
  await capture(app, setup, 'relay', pack, theme, [380, 1440]);
  await setup.getByText('高级', { exact: true }).click();
  await capture(app, setup, 'relay-advanced', pack, theme, [380, 1440]);
  if (pack === 'classic' && theme === 'light') {
    await setup.getByLabel('Pockymoe 地址', { exact: true }).fill(origin);
    await setup.getByLabel('Relay 地址', { exact: true }).fill(relayOriginValue);
  } else await setup.getByText('高级', { exact: true }).click();
  await setup.getByLabel('Pockymoe 地址', { exact: true }).fill(pack === 'classic' && theme === 'light' ? origin : theme === 'light' ? relayOriginValue : origin); await setup.getByRole('button', { name: '连接', exact: true }).click();
  const page = await pageAt(app, origin); await expect.poll(() => page.evaluate(() => !!window.pockymoeHost)).toBe(true);
  expect(await page.evaluate(() => window.pockymoeHost!.settings.get())).toMatchObject({ webOrigin: origin, relayOrigin: relayOriginValue });
  await page.evaluate(a => window.pockymoeHost!.appearance.sync(a), appearance);
  await app.evaluate(() => { globalThis.__pockymoeDesktopTest.settings.set({ petVisible: false }); globalThis.__pockymoeDesktopTest.windows.createLocal('preferences'); });
  const preferences = await pageAt(app, 'view=preferences');
  await expect(preferences.getByRole('heading', { name: '通用', exact: true })).toBeVisible();
  await expect(preferences.locator('html')).toHaveAttribute('data-theme-effective', theme);
  await capture(app, preferences, 'preferences', pack, theme);
  await preferences.getByRole('button', { name: '提醒方式', exact: true }).click();
  await preferences.getByRole('option', { name: '两者都用', exact: true }).click();
  await expect.poll(() => app.evaluate(() => globalThis.__pockymoeDesktopTest.settings.get().alertMode)).toBe('both');
  await preferences.getByRole('button', { name: '桌宠', exact: true }).click();
  await capture(app, preferences, 'preferences-pet', pack, theme);
  await preferences.getByRole('button', { name: '快捷键', exact: true }).click();
  await capture(app, preferences, 'preferences-shortcuts', pack, theme);
  await preferences.getByRole('textbox', { name: '快捷窗口快捷键' }).fill('CommandOrControl+Shift+Space'); await preferences.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('CommandOrControl+Shift+Space'))).toBe(true);
  const items = [item({ state: 'needsInput', request: { id: `request-${theme}`, kind: 'input', summary: '请选择部署环境' } }), item({ key: 'mac:thread-2', threadId: 'thread-2', turnId: `run-${theme}`, title: '完善桌面端交互细节', since: new Date(Date.now() - 65_000).toISOString() }), item({ key: 'mac:thread-3', threadId: 'thread-3', turnId: `done-${theme}`, title: '检查跨设备索引缓存', state: 'completed', unread: true, resultSummary: '离线恢复验证通过' })];
  await page.evaluate(s => { window.pockymoeHost!.activity.sync({ ...s, items: [], generatedAt: '2026-11-01T05:59:00.000Z', syncedDeviceIds: ['mac', 'pc'] }); window.pockymoeHost!.activity.sync(s); }, snapshot(items));
  await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.createLocal('quick'));
  const quick = await pageAt(app, 'view=quick'); await expect(quick.getByRole('option')).toHaveCount(3);
  await expect(quick.locator('.elapsed')).toHaveText(/^01:0[5-9]$/);
  expect((await quick.getByRole('option').first().boundingBox())!.height).toBe(34);
  expect(await quick.locator('svg[data-status=running] circle').count()).toBe(2);
  await capture(app, quick, 'quick', pack, theme);
  const before = await quick.locator('.elapsed').textContent();
  await expect.poll(() => quick.locator('.elapsed').textContent()).not.toBe(before);
});

for (const pack of packs) for (const theme of ['light', 'dark'] as const) test(`agent conversations preserve targets (${pack} ${theme})`, async () => {
  const app = await launch(theme), page = await pageAt(app, origin);
  await app.evaluate(() => globalThis.__pockymoeDesktopTest.settings.set({ petVisible: false }));
  await page.evaluate(a => window.pockymoeHost!.appearance.sync(a), appearanceFor(pack, theme));
  const root = item({ key: 'mac:root', threadId: 'root', title: '完善 Pockymoe 桌面体验', since: new Date(Date.now() - 70_000).toISOString() });
  const agent = (id: string, name: string) => item({ key: `mac:${id}`, threadId: id, title: `子任务 ${name}`, agentName: name, rootThreadKey: root.key, rootThreadTitle: '旧根标题', state: 'needsInput', request: { id: `request-${id}`, kind: 'approval', summary: '运行定向测试' } });
  await page.evaluate(s => { window.pockymoeHost!.activity.sync({ ...s, items: [], generatedAt: '2026-11-01T05:59:00.000Z', syncedDeviceIds: ['mac', 'pc'] }); window.pockymoeHost!.activity.sync(s); }, snapshot([root, { ...agent('a', 'Planner'), state: 'running', request: null }, agent('b', 'Reviewer'), item({ key: 'pc:resource', deviceId: 'pc', threadId: 'resource', title: '校验打包资源', since: root.since })]));
  await expect.poll(() => app.evaluate(() => globalThis.__pockymoeDesktopTest.tray.menuLabels)).toContain('需要你 · 1');
  await page.evaluate(async () => { window.pockymoeHost!.badge.set(99, 'attention'); await window.pockymoeHost!.settings.get(); });
  if (process.platform === 'darwin') expect(await app.evaluate(({ app }) => app.dock!.getBadge())).toBe('1');
  await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.createLocal('quick'));
  const quick = await pageAt(app, 'view=quick');
  await expect(quick.getByRole('option')).toHaveCount(2);
  await expect(quick.locator('[data-key="mac:b"] strong')).toHaveText(root.title);
  await expect(quick.locator('.conversation-count')).toHaveText('2');
  await expect(quick.locator('.conversation-count svg')).toHaveCount(1);
  await expect(quick.locator('.conversation-toggle')).toHaveCount(0);
  await expect(quick.locator('.row-copy>span')).toHaveCount(0);
  await expect(quick.locator('#reply')).not.toHaveAttribute('placeholder', /智能体|Agent/);
  expect(await quick.locator('#quick-list').innerText()).not.toMatch(/智能体|Agent|MacBook Pro|remoteCodex/);
  await capture(app, quick, 'conversation-row', pack, theme, [560, 380]);
  // Searching a member keeps the conversation intact and targets its waiting request.
  await quick.getByLabel('搜索活动线程').fill('Planner');
  await expect(quick.getByRole('option')).toHaveCount(1);
  await expect(quick.locator('.conversation-count')).toHaveText('2');
  await expect(quick.locator('[data-key="mac:b"]')).toHaveAttribute('aria-selected', 'true');
  await quick.getByLabel('快速回复').fill('请继续审查'); await quick.getByLabel('发送回复', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.commands)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'reply', threadId: 'b', text: '请继续审查' })]));
  await quick.locator('[data-key="mac:b"]').click();
  await expect(page).toHaveURL(`${origin}/devices/mac/threads/b`);
});

for (const pack of packs) for (const theme of ['light', 'dark'] as const) test(`one language across surfaces (${pack} ${theme})`, async () => {
  const app = await launch(theme, true);
  const first = await pageAt(app, 'view=relay');
  const fallback = resolveLocale(await app.evaluate(({ app }) => app.getLocale()));
  await expect(first.locator('html')).toHaveAttribute('lang', fallback);
  await app.evaluate(async (_electron, pair) => {
    const runtime = globalThis.__pockymoeDesktopTest;
    runtime.settings.set(pair);
    // Origin changes create a new native window. Observe its completed navigation,
    // rather than treating the initial about:blank URL as a failed ready window.
    const contents = runtime.windows.main().webContents;
    if (contents.isLoading()) await new Promise<void>((resolve, reject) => {
      contents.once('did-finish-load', () => resolve());
      contents.once('did-fail-load', (_event, code) => reject(new Error(`Fixture navigation failed: ${code}`)));
    });
  }, { webOrigin: origin, relayOrigin: relayOriginValue, petVisible: false });
  const page = await pageAt(app, origin);
  await page.evaluate(a => { window.pockymoeHost!.appearance.sync(a); }, appearanceFor(pack, theme));
  const rows = [item({ title: 'Review desktop shell', state: 'needsInput', request: { id: 'locale-request', kind: 'approval', summary: 'Approve targeted tests' }, workspaceLabel: 'pockymoe' }), item({ key: 'mac:locale-running', threadId: 'locale-running', title: 'Verify activity updates', workspaceLabel: 'pockymoe', since: new Date(Date.now() - 65_000).toISOString() })];
  await page.evaluate(async s => { window.pockymoeHost!.activity.sync({ ...s, items: [], generatedAt: '2026-11-01T05:59:00.000Z', syncedDeviceIds: ['mac', 'pc'] }); window.pockymoeHost!.activity.sync(s); await window.pockymoeHost!.capabilities(); }, snapshot(rows));
  await page.evaluate(() => window.pockymoeHost!.window.openPreferences('general'));
  const prefs = await pageAt(app, 'view=preferences');
  await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.createLocal('quick'));
  const quick = await pageAt(app, 'view=quick'); await expect(quick.getByRole('option')).toHaveCount(2);
  await first.locator('#origin').fill('https://draft.example.test');
  await quick.locator('#reply').fill('Draft text must survive language changes');
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async (...args: unknown[]) => { globalThis.__pockymoeDesktopTest.lastDialog = args.at(-1) as Electron.MessageBoxOptions; return { response: 0, checkboxChecked: false }; }) as typeof dialog.showMessageBox;
    dialog.showSaveDialog = (async (...args: unknown[]) => { globalThis.__pockymoeDesktopTest.lastSave = args.at(-1) as Electron.SaveDialogOptions; return { canceled: true, filePath: '' }; }) as typeof dialog.showSaveDialog;
  });
  const packaged = await app.evaluate(({ app, net }) => {
    if (app.isPackaged) net.fetch = async () => new Response(JSON.stringify({tag_name: `v${app.getVersion()}`, prerelease: false, draft: false}), { status: 200 });
    return app.isPackaged;
  });
  const timings: { locale: string; milliseconds: number }[] = [];
  for (const locale of ['en', 'zh-CN'] as const) {
    const switchedAt = Date.now();
    // The fixture Web Settings control uses the same appearance.sync path as Web i18n.
    await page.selectOption('#language', locale);
    await page.evaluate(a => window.pockymoeHost!.appearance.sync(a), { ...appearanceFor(pack, theme), locale });
    const expected = locale === 'en' ? 'General' : '通用';
    await expect(prefs.getByRole('heading', { name: expected, exact: true })).toBeVisible({ timeout: 1000 });
    await expect(quick.locator('html')).toHaveAttribute('lang', locale, { timeout: 1000 });
    await expect(first.locator('html')).toHaveAttribute('lang', locale, { timeout: 1000 });
    await expect(quick.locator('#search')).toHaveAttribute('placeholder', locale === 'en' ? 'Search active threads…' : '搜索活动线程…', { timeout: 1000 });
    await expect(quick.locator('#reply')).toHaveValue('Draft text must survive language changes');
    await expect(first.locator('#origin')).toHaveValue('https://draft.example.test');
    await expect.poll(() => app.evaluate(() => globalThis.__pockymoeDesktopTest.tray.menuLabels), { timeout: 1000 }).toContain(locale === 'en' ? 'Open map' : '打开地图');
    const menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map(item => ({ label: item.label, submenu: item.submenu?.items.map(child => child.label) })));
    expect(menu.map(item => item.label)).toContain(locale === 'en' ? 'Edit' : '编辑');
    timings.push({ locale, milliseconds: Date.now() - switchedAt });
    expect(timings.at(-1)!.milliseconds).toBeLessThan(1000);
    writeFileSync(join(evidence, `menu-${locale}.json`), JSON.stringify(menu, null, 2));
    await prefs.locator('#update').click();
    const updateMessage = packaged ? locale === 'en' ? "You're up to date" : '已是最新版本' : locale === 'en' ? 'Development builds do not check for updates' : '开发版本不检查更新';
    if (process.platform === 'win32') {
      const prompt = prefs.getByRole('dialog'); await expect(prompt).toContainText(updateMessage);
      await prompt.getByRole('button', { name: locale === 'en' ? 'OK' : '好', exact: true }).click();
      await expect(prompt).toHaveCount(0);
    } else await expect.poll(() => app.evaluate(() => globalThis.__pockymoeDesktopTest.lastDialog?.message)).toBe(updateMessage);
    expect(await page.evaluate(() => window.pockymoeHost!.files.saveAs('locale.txt', new ArrayBuffer(0)))).toEqual({ saved: false });
    expect(await app.evaluate(() => globalThis.__pockymoeDesktopTest.lastSave?.buttonLabel)).toBe(locale === 'en' ? 'Save' : '保存');
    await capture(app, first, `locale-${locale}-setup`, pack, theme);
    await capture(app, prefs, `locale-${locale}-preferences`, pack, theme);
    await prefs.locator('[data-section=pet]').click(); await capture(app, prefs, `locale-${locale}-pet`, pack, theme);
    await prefs.locator('[data-section=shortcuts]').click(); await capture(app, prefs, `locale-${locale}-shortcuts`, pack, theme);
    await prefs.locator('[data-section=general]').click();
    await capture(app, quick, `locale-${locale}-quick`, pack, theme);
  }
  writeFileSync(join(evidence, `locale-timings-${pack}-${theme}.json`), JSON.stringify(timings, null, 2));
  await page.evaluate(() => { (window as unknown as { needsThread: boolean }).needsThread = true; });
  await quick.locator('#reply').fill('Please continue'); await quick.locator('#send').click();
  await expect(quick.getByRole('button', { name: '在线程中打开', exact: true })).toBeVisible();
  await page.selectOption('#language', 'en');
  await expect(quick.getByRole('button', { name: 'Open in thread', exact: true })).toBeVisible({ timeout: 1000 });
  await quick.getByRole('button', { name: 'Open in thread', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/devices/mac/threads/thread-1`);
});

for (const material of ['native', 'solid']) for (const pack of packs) for (const theme of ['light', 'dark'] as const) test(`Windows surface acceptance (${material} ${pack} ${theme})`, async () => {
  test.skip(process.platform !== 'win32', 'Windows native window acceptance');
  test.setTimeout(120_000);
  const app = await launch(theme, false, material), web = await pageAt(app, origin);
  await web.evaluate(value => window.pockymoeHost!.appearance.sync(value), appearanceFor(pack, theme));
  await app.evaluate(() => {
    for (const role of ['preferences', 'quick', 'about', 'relay'] as const) globalThis.__pockymoeDesktopTest.windows.createLocal(role);
  });
  const prefs = await pageAt(app, 'view=preferences');
  await prefs.locator('[data-section=shortcuts]').click();
  await expect(prefs.locator('kbd').first()).toContainText('Ctrl');
  const sprite = await pageAt(app, '/pet/');
  await sprite.evaluate(() => (window as unknown as { rcDesktop: { pet: { action(value: unknown): Promise<unknown> } } }).rcDesktop.pet.action({ type: 'toggleTray' }));
  await expect.poll(() => app.windows().filter(page => page.url().includes('/pet/')).length).toBe(2);
  const scales: { url: string; devicePixelRatio: number }[] = [];
  for (const page of app.windows()) {
    await page.waitForLoadState('domcontentloaded');
    if (page.url().includes('/pet/') && await page.evaluate(() => document.body.dataset.surface) === 'glass') {
      if (!await page.locator('.panel').count()) await page.evaluate(() => (window as unknown as { rcDesktop: { pet: { action(value: unknown): Promise<unknown> } } }).rcDesktop.pet.action({ type: 'toggleTray' }));
      await expect(page.locator('.panel')).toBeVisible();
    }
    const violations = await page.evaluate(() => {
      const text = [document.body.innerText, ...Array.from(document.querySelectorAll('*')).flatMap(el => [el.getAttribute('title') || '', el.getAttribute('aria-label') || ''])].join(' ');
      const scrollbars = Array.from(document.querySelectorAll<HTMLElement>('*')).filter(el => {
        const style = getComputedStyle(el);
        const body = getComputedStyle(document.body), viewport = el === document.scrollingElement;
        const overflowing = (/auto|scroll/.test(style.overflowY) || viewport && !/hidden|clip/.test(body.overflowY)) && el.scrollHeight > el.clientHeight + 1 || (/auto|scroll/.test(style.overflowX) || viewport && !/hidden|clip/.test(body.overflowX)) && el.scrollWidth > el.clientWidth + 1;
        return overflowing && style.scrollbarWidth !== 'none' && getComputedStyle(el, '::-webkit-scrollbar').display !== 'none';
      }).map(el => el.className);
      return { macLabels: /[⌘⌥]/.test(text), scrollbars, devicePixelRatio };
    });
    expect(violations.macLabels, page.url()).toBe(false);
    expect(violations.scrollbars, page.url()).toEqual([]);
    if (page.url().includes('/pet/') || page.url().includes('view=quick')) {
      const panel = page.locator('.glass, .quick').first();
      if (await panel.count()) {
        const color = await panel.evaluate(element => {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d')!; context.fillStyle = getComputedStyle(element).backgroundColor;
          context.fillRect(0, 0, 1, 1); return Array.from(context.getImageData(0, 0, 1, 1).data);
        });
        expect(color[3]).toBeGreaterThanOrEqual(material === 'solid' ? 255 : 244);
      }
    }
    test.info().annotations.push({ type: 'scale', description: `${page.url()}: devicePixelRatio=${violations.devicePixelRatio}` });
    scales.push({ url: page.url(), devicePixelRatio: violations.devicePixelRatio });
    const label = page.url().includes('/pet/') ? await page.evaluate(() => `pet-${document.body.dataset.surface}`) : new URL(page.url()).searchParams.get('view') || 'main-fixture';
    // Some utility/child windows become hidden when another surface takes focus.
    // Ask Electron to wake their compositor without focusing them; CDP
    // screenshots can otherwise wait forever for a frame from a hidden window.
    await test.step(`capture ${label}`, async () => {
      await page.evaluate(() => document.fonts.ready);
      // Pet sprite/glass share a URL. Resolve the exact native window for this
      // Page, never the first URL match (which can silently capture its sibling).
      const target = await app.browserWindow(page);
      try {
        const capture = await target.evaluate(async (window: Electron.BrowserWindow) => {
          const surface = await window.webContents.executeJavaScript('document.body.dataset.surface || null') as string | null;
          // Keep this fixture painting even if the normal hide timer fires.
          window.webContents.setBackgroundThrottling(false);
          window.getParentWindow()?.showInactive();
          window.showInactive(); window.moveTop();
          const png = await window.webContents.capturePage(undefined, { stayHidden: false, stayAwake: true });
          return { id: window.id, surface, size: png.getSize(), png: png.toPNG().toString('base64') };
        });
        if (label.startsWith('pet-')) expect(capture.surface).toBe(label.slice(4));
        expect(capture.size.width).toBeGreaterThan(0); expect(capture.size.height).toBeGreaterThan(0);
        writeFileSync(join(evidence, `windows-${material}-${label}-${pack}-${theme}.png`), Buffer.from(capture.png, 'base64'));
        writeFileSync(join(evidence, `windows-${material}-${label}-${pack}-${theme}.json`), JSON.stringify({ nativeWindowId: capture.id, surface: capture.surface, size: capture.size }));
      } finally { await target.dispose(); }
    });
  }
  const displays = await app.evaluate(({ screen }) => screen.getAllDisplays().map(display => ({ bounds: display.bounds, workArea: display.workArea, scaleFactor: display.scaleFactor })));
  writeFileSync(join(evidence, `windows-${material}-scale-${pack}-${theme}.json`), JSON.stringify({ requested: process.env.POCKYMOE_DESKTOP_SCALE || 'system', scales, displays }, null, 2));
  // Page screenshots omit native chrome. Also retain the OS window thumbnails when available.
  const native = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1920, height: 1440 } });
    return BrowserWindow.getAllWindows().map(window => {
      const source = sources.find(source => source.id === window.getMediaSourceId());
      return { id: window.id, url: window.webContents.getURL(), bounds: window.getBounds(), visible: window.isVisible(), image: source && !source.thumbnail.isEmpty() ? source.thumbnail.toPNG().toString('base64') : null };
    });
  });
  for (const window of native) if (window.image) writeFileSync(join(evidence, `windows-${material}-native-window-${window.id}-${pack}-${theme}.png`), Buffer.from(window.image, 'base64'));
  writeFileSync(join(evidence, `windows-${material}-native-windows-${pack}-${theme}.json`), JSON.stringify(native.map(({ image, ...window }) => ({ ...window, captured: !!image })), null, 2));
  await prefs.locator('[data-section=pet]').click();
  await prefs.locator('#petVoiceProvider').click();
  await prefs.getByRole('option', { name: 'OpenAI 兼容服务', exact: true }).click();
  await prefs.locator('.voice-advanced summary').click();
  const extra = prefs.locator('#voice-extra');
  await extra.fill(JSON.stringify({ fixture: Array.from({ length: 30 }, () => 'scrollbar fixture') }, null, 2));
  expect(await extra.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  expect(await extra.evaluate(element => getComputedStyle(element).scrollbarWidth)).toBe('none');
  await prefs.screenshot({ path: join(evidence, `windows-${material}-preferences-voice-${pack}-${theme}.png`), animations: 'disabled' });
  await app.evaluate(() => { void globalThis.__pockymoeDesktopTest.showMessageBox({ title: 'Pockymoe', message: '确认更新', detail: 'Windows local confirmation fixture', buttons: ['继续', '取消'], cancelId: 1, defaultId: 1 }); });
  const prompt = prefs.getByRole('dialog'); await expect(prompt).toBeVisible();
  await expect(prompt.getByRole('button', { name: '取消' })).toBeFocused();
  await prefs.keyboard.press('Tab'); await expect(prompt.getByRole('button', { name: '继续' })).toBeFocused();
  await prefs.keyboard.press('Tab'); await expect(prompt.getByRole('button', { name: '取消' })).toBeFocused();
  await prefs.screenshot({ path: join(evidence, `windows-${material}-confirmation-${pack}-${theme}.png`), animations: 'disabled' });
  await prefs.keyboard.press('Escape'); await expect(prompt).toHaveCount(0);
  await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) { if (window.isMenuBarVisible() || window.isMenuBarAutoHide()) throw new Error('Native menu must stay hidden, including on Alt'); } });
  await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.focusMain());
  await web.keyboard.press('Alt');
  expect(await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.main().isMenuBarVisible())).toBe(false);

});


test('native menu accelerators have no collisions, including role defaults', async () => {
  const app = await launch('light'); const page = await pageAt(app, origin);
  const shortcuts = await app.evaluate(({ Menu }) => {
    const found: { label: string; accelerator: string }[] = [];
    const visit = (menu: Electron.Menu): void => { for (const item of menu.items) {
      // Electron resolves role defaults when constructing real native MenuItems.
      const roleDefault = (item as Electron.MenuItem & { getDefaultRoleAccelerator?: () => string }).getDefaultRoleAccelerator?.();
      const accelerator = item.accelerator === undefined ? roleDefault : item.accelerator;
      if (accelerator) found.push({ label: item.id || item.role || item.label, accelerator });
      if (item.submenu) visit(item.submenu);
    } };
    visit(Menu.getApplicationMenu()!); return found;
  });
  const normalized = shortcuts.map(item => item.accelerator.toLowerCase().replace(/commandorcontrol|cmdorctrl|command|control/g, 'primary').replace(/cmd/g, 'primary'));
  expect(new Set(normalized).size, JSON.stringify(shortcuts)).toBe(normalized.length);
  expect(shortcuts.find(item => item.label === 'pockymoe-open-map')?.accelerator).toBe('CommandOrControl+0');
  expect(shortcuts.find(item => item.label === 'resetzoom')).toBeUndefined();
  await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.focusMain());
  await page.getByRole('heading', { name: 'Pockymoe fixture', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
  await primaryKey(app, '0');
  await expect.poll(() => app.windows().find(page => page.url().startsWith(origin))!.evaluate(() => window.commands)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'openMap' })]));
});


test('surface audit rejects Mac labels and unstyled bars but accepts a painted theme scrollbar', async () => {
  const app = await launch('light'); const page = await pageAt(app, origin);
  await page.evaluate(() => {
    const box = document.createElement('div'); box.className = 'audit-native-scrollbar';
    box.style.cssText = 'height:20px;width:100px;overflow:scroll';
    const content = document.createElement('div'); content.style.height = '200px'; box.append(content);
    const label = document.createElement('button'); label.id = 'audit-mac-label'; label.title = '⌘0'; label.textContent = 'Audit label';
    document.body.append(box, label);
  });
  const unstyled = await auditSurface(page);
  expect(unstyled.macLabels).toBe(true); expect(unstyled.scrollbars).toContain('audit-native-scrollbar');
  await page.evaluate(() => {
    document.getElementById('audit-mac-label')!.remove();
    const style = document.createElement('style');
    style.textContent = '.audit-native-scrollbar::-webkit-scrollbar{width:8px;height:8px}.audit-native-scrollbar::-webkit-scrollbar-thumb{background:rgb(110 120 130);border:2px solid transparent;border-radius:4px;background-clip:padding-box}.audit-native-scrollbar::-webkit-scrollbar-button{width:0;height:0}';
    document.head.append(style);
  });
  const painted = await auditSurface(page);
  expect(painted.macLabels).toBe(false); expect(painted.scrollbars).not.toContain('audit-native-scrollbar');
});
