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
import type { Appearance, PockymoeHost } from '../src/shared/contract';
import { resolveLocale } from '../src/shared/i18n';
import { item, snapshot } from './fixtures';

type Runtime = { lastDialog?: Electron.MessageBoxOptions; lastSave?: Electron.SaveDialogOptions; appearance: AppearanceStore; hub: ActivityHub; settings: SettingsStore; windows: Windows; tray: DesktopTray; notifications: Notifications };
declare global { var __pockymoeDesktopTest: Runtime }
declare global { interface Window { pockymoeHost?: PockymoeHost; commands: unknown[] } }
const evidence = join(process.env.POCKYMOE_DESKTOP_EVIDENCE || '/tmp/rc-desktop/evidence/round3/shell', 'compat');
let relay: Server, api: Server, relayOriginValue: string, other: Server, origin: string, otherOrigin: string;
const apps: ElectronApplication[] = [];
const themes = new WeakMap<ElectronApplication, 'light' | 'dark'>();
const directories: string[] = [];
async function server(handler: RequestListener): Promise<{ server: Server; origin: string }> {
  const server = createServer(handler); await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture port');
  return { server, origin: `http://127.0.0.1:${address.port}` };
}
async function launch(theme: 'light' | 'dark', firstRun = false): Promise<ElectronApplication> {
  const dir = mkdtempSync(join(tmpdir(), 'rc-shell-e2e-')); directories.push(dir);
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'DISPLAY']) if (process.env[key]) env[key] = process.env[key]!;
  Object.assign(env, { POCKYMOE_DESKTOP_E2E: '1', POCKYMOE_DESKTOP_USER_DATA: dir, POCKYMOE_DESKTOP_THEME: theme });
  if (!firstRun) { env.POCKYMOE_DESKTOP_WEB_ORIGIN = origin; env.POCKYMOE_DESKTOP_RELAY_ORIGIN = relayOriginValue; }
  const app = await electron.launch({ args: [resolve('.')], env }); apps.push(app); themes.set(app, theme);
  return app;
}
async function pageAt(app: ElectronApplication, fragment: string): Promise<Page> {
  let page: Page | undefined;
  await expect.poll(() => { page = app.windows().find(w => w.url().includes(fragment)); return !!page; }).toBe(true);
  await page!.waitForLoadState('domcontentloaded');
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

test('OAuth finishes in a bridge-free sign-in window on the page session', async () => {
  const app = await launch('light'); const page = await pageAt(app, origin);
  await page.evaluate(start => { location.assign(start); }, `${relayOriginValue}/relay/auth/oauth/github/start`);
  const signIn = await pageAt(app, '/relay/auth/oauth/github/start');
  await expect(signIn).toHaveTitle('Provider sign-in');
  expect(await signIn.evaluate(() => typeof window.pockymoeHost)).toBe('undefined');
  expect(await signIn.evaluate(() => navigator.userAgent)).not.toMatch(/Electron|Pockymoe/i);
  expect(page.url()).not.toContain('/relay/auth/');
  await signIn.evaluate(callback => { location.assign(callback); }, `${relayOriginValue}/relay/auth/oauth/github/callback`);
  await expect.poll(() => page.url()).toContain('signedIn=1');
  await expect.poll(() => app.windows().some(w => w.url().includes('/relay/auth/'))).toBe(false);
  expect(await page.evaluate(() => !!window.pockymoeHost)).toBe(true);
});
test('split origins bridge, activity delivery, tray and quick-window command round trip', async () => {
  const app = await launch('light'); const page = await pageAt(app, origin);
  await expect.poll(() => page.evaluate(() => !!window.pockymoeHost)).toBe(true);
  expect(await page.evaluate(() => window.pockymoeHost!.capabilities())).toMatchObject({ surface: 'desktop', bridgeVersion: 2, features: { multiWindow: true, quickWindow: true } });
  await expect.poll(() => page.evaluate(() => (window as unknown as { frameResults: unknown }).frameResults)).toEqual({ sameFrameBridge: false, otherBridge: false });
  await app.evaluate(({ Menu }) => { const item = Menu.getApplicationMenu()!.getMenuItemById('pockymoe-search')!; item.click(item, globalThis.__pockymoeDesktopTest.windows.main(), {}); });
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
  const app = await launch(theme, true);
  const setup = await pageAt(app, 'view=relay');
  const appearance = appearanceFor(pack, theme);
  await app.evaluate((_electron, value) => globalThis.__pockymoeDesktopTest.appearance.sync(value), appearance);
  await expect(setup.locator('html')).toHaveAttribute('data-theme-preset', pack);
  await expect(setup.locator('html')).toHaveAttribute('data-theme-effective', theme);
  await expect(setup.getByRole('heading', { name: '连接 Pockymoe' })).toBeVisible();
  await capture(app, setup, 'relay', pack, theme);
  await setup.getByText('高级', { exact: true }).click();
  await capture(app, setup, 'relay-advanced', pack, theme);
  if (pack === 'classic' && theme === 'light') {
    await setup.getByLabel('网页地址', { exact: true }).fill(origin);
    await setup.getByLabel('Relay 地址', { exact: true }).fill(relayOriginValue);
  } else await setup.getByText('高级', { exact: true }).click();
  await setup.getByLabel('Pockymoe 地址', { exact: true }).fill(theme === 'light' ? relayOriginValue : origin); await setup.getByRole('button', { name: '连接', exact: true }).click();
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
  await app.evaluate((_electron, pair) => { globalThis.__pockymoeDesktopTest.settings.set(pair); }, { webOrigin: origin, relayOrigin: relayOriginValue, petVisible: false });
  const page = await pageAt(app, origin);
  await page.evaluate(a => { window.pockymoeHost!.appearance.sync(a); }, appearanceFor(pack, theme));
  const rows = [item({ title: 'Review desktop shell', state: 'needsInput', request: { id: 'locale-request', kind: 'approval', summary: 'Approve targeted tests' }, workspaceLabel: 'pockymoe' }), item({ key: 'mac:locale-running', threadId: 'locale-running', title: 'Verify activity updates', workspaceLabel: 'pockymoe', since: new Date(Date.now() - 65_000).toISOString() })];
  await page.evaluate(s => { window.pockymoeHost!.activity.sync({ ...s, items: [], generatedAt: '2026-11-01T05:59:00.000Z', syncedDeviceIds: ['mac', 'pc'] }); window.pockymoeHost!.activity.sync(s); }, snapshot(rows));
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
    await expect.poll(() => app.evaluate(() => globalThis.__pockymoeDesktopTest.lastDialog?.message)).toBe(locale === 'en' ? 'Development builds do not check for updates' : '开发版本不检查更新');
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
