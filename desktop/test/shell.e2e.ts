import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server, type RequestListener } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ActivityHub } from '../src/main/activity';
import type { SettingsStore } from '../src/main/store';
import type { Windows } from '../src/main/windows';
import type { DesktopTray } from '../src/main/tray';
import type { Notifications } from '../src/main/notifications';
import type { RemoteCodexHost } from '../src/shared/contract';
import { item, snapshot } from './fixtures';

type Runtime = { hub: ActivityHub; settings: SettingsStore; windows: Windows; tray: DesktopTray; notifications: Notifications };
declare global { var __rcDesktopTest: Runtime }
declare global { interface Window { remoteCodexHost?: RemoteCodexHost; commands: unknown[] } }
const evidence = '/tmp/rc-desktop/evidence/shell';
let relay: Server, other: Server, origin: string, otherOrigin: string;
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
  Object.assign(env, { RC_DESKTOP_E2E: '1', RC_DESKTOP_USER_DATA: dir, RC_DESKTOP_THEME: theme });
  if (!firstRun) env.RC_DESKTOP_RELAY_ORIGIN = origin;
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
  const external = await server((_req, res) => res.end('<!doctype html><title>Other origin</title><script>parent.postMessage({otherBridge:!!window.remoteCodexHost},"*")</script>'));
  other = external.server; otherOrigin = external.origin;
  const fixture = await server((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req?.url === '/frame') { res.end('<!doctype html><title>Frame</title><script>parent.postMessage({sameFrameBridge:!!window.remoteCodexHost},"*")</script>'); return; }
    res.end(`<!doctype html><html><head><title>Fixture relay</title></head><body style="font:14px system-ui;padding:60px"><h1>Relay fixture</h1><p id="status">Connected</p><iframe title="same origin" src="/frame"></iframe><iframe title="other origin" src="${otherOrigin}"></iframe><script>
      window.commands=[]; window.frameResults={}; window.addEventListener('message',e=>Object.assign(window.frameResults,e.data));
      window.remoteCodexHost?.onCommand(command=>{window.commands.push(command); if(command.type==='navigate'){history.pushState({},'',command.path);document.getElementById('status').textContent=command.path;} window.remoteCodexHost.commandResult(command.id,{ok:true});});
    </script></body></html>`);
  }); relay = fixture.server; origin = fixture.origin;
});
test.afterEach(async () => { for (const app of apps.splice(0)) await app.close(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
test.afterAll(async () => { await Promise.all([new Promise<void>(done => relay.close(() => done())), new Promise<void>(done => other.close(() => done()))]); });

test('relay origin bridge, activity delivery, tray and quick-window command round trip', async () => {
  const app = await launch('light'); const page = await pageAt(app, origin);
  await expect.poll(() => page.evaluate(() => !!window.remoteCodexHost)).toBe(true);
  expect(await page.evaluate(() => window.remoteCodexHost!.capabilities())).toMatchObject({ surface: 'desktop', bridgeVersion: 1, features: { multiWindow: true, quickWindow: true } });
  await expect.poll(() => page.evaluate(() => (window as unknown as { frameResults: unknown }).frameResults)).toEqual({ sameFrameBridge: false, otherBridge: false });
  await app.evaluate(() => { globalThis.__rcDesktopTest.settings.set({ petVisible: false }); globalThis.__rcDesktopTest.windows.focusMain(); });
  const active = item({ state: 'needsInput', request: { id: 'req-1', kind: 'approval', summary: '运行 cargo test -p runtime' } });
  const running = item({ key: 'pc:thread-2', deviceId: 'pc', deviceName: 'Windows Studio', threadId: 'thread-2', turnId: 'turn-2', title: '完善设备统计视图', workspaceLabel: 'supervisor-web' });
  const completed = item({ key: 'mac:thread-3', threadId: 'thread-3', turnId: 'turn-3', title: '优化工作区树形导航', state: 'completed', unread: true, resultSummary: '键盘导航与过滤已完成' });
  await page.evaluate(s => window.remoteCodexHost!.activity.sync(s), snapshot([active, running, completed]));
  await expect.poll(() => app.evaluate(() => globalThis.__rcDesktopTest.tray.menuLabels)).toContain('修复登录状态同步 — MacBook Pro');
  expect(await app.evaluate(() => globalThis.__rcDesktopTest.notifications.decisions)).toEqual(expect.arrayContaining([expect.objectContaining({ alertId: 'mac:req-1', system: true })]));
  await app.evaluate(({ globalShortcut }) => { if (!globalShortcut.isRegistered('Alt+Space')) throw new Error('Quick shortcut not registered'); globalThis.__rcDesktopTest.windows.toggleQuick(); });
  const quick = await pageAt(app, 'view=quick');
  await expect(quick.getByRole('option')).toHaveCount(3);
  await quick.screenshot({ animations: 'disabled', path: join(evidence, 'quick-light.png') });
  await quick.getByLabel('快速回复').fill('请继续，并运行定向测试'); await quick.getByLabel('发送回复', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.commands)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'reply', threadId: 'thread-1', text: '请继续，并运行定向测试' })]));
  await quick.getByLabel('搜索活动线程').focus(); await quick.keyboard.press('Enter');
  await expect(page).toHaveURL(`${origin}/devices/mac/threads/thread-1`);
  await expect.poll(() => page.evaluate(() => window.commands)).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'navigate', path: '/devices/mac/threads/thread-1' })]));
  // A focused thread must be suppressed even when focus changes in the same sync.
  await app.evaluate(() => globalThis.__rcDesktopTest.windows.focusMain());
  await page.evaluate(s => window.remoteCodexHost!.activity.sync(s), snapshot([item({ state: 'completed', turnId: 'focused-turn', unread: true })], { focusedThreadKey: 'mac:thread-1', generatedAt: '2026-11-01T06:02:00.000Z' }));
  await expect.poll(() => app.evaluate(() => globalThis.__rcDesktopTest.notifications.decisions.find(d => d.alertId === 'mac:focused-turn'))).toMatchObject({ system: false, pet: false });
  await page.evaluate(() => window.remoteCodexHost!.window.openThread('/devices/pc/threads/thread-2', { newWindow: true }));
  const second = await pageAt(app, '/devices/pc/threads/thread-2');
  expect(await second.evaluate(() => !!window.remoteCodexHost)).toBe(true);
  expect(await app.evaluate(({ session }) => [...globalThis.__rcDesktopTest.windows.relay].every(w => w.webContents.session === session.fromPartition('persist:remote-codex')))).toBe(true);
  await app.evaluate(() => {
    const w = [...globalThis.__rcDesktopTest.windows.relay].find(w => w.webContents.getURL().endsWith('/devices/pc/threads/thread-2'))!;
    w.close();
    if (w.isDestroyed() || w.isVisible()) throw new Error('Close must hide the relay window');
    globalThis.__rcDesktopTest.windows.focusMain();
  });
  // A foreign top-level page with the relay preload gets no host bridge either.
  const foreignId = await app.evaluate(({ BrowserWindow, app }, foreign) => {
    const w = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: `${app.getAppPath()}/out/preload/relay.js`, additionalArguments: [`--rc-relay-origin=${globalThis.__rcDesktopTest.settings.get().relayOrigin}`] } });
    void w.loadURL(foreign); return w.webContents.id;
  }, otherOrigin);
  const foreign = await pageAt(app, otherOrigin);
  expect(await foreign.evaluate(() => typeof window.remoteCodexHost)).toBe('undefined');
  await app.evaluate(({ webContents }, id) => webContents.fromId(id)?.close(), foreignId);
});

for (const theme of ['light', 'dark'] as const) test(`local windows visual and settings persistence (${theme})`, async () => {
  const app = await launch(theme, true);
  const setup = await pageAt(app, 'view=relay');
  await expect(setup.getByRole('heading', { name: '你的设备，随时在手边。' })).toBeVisible();
  await setup.screenshot({ animations: 'disabled', path: join(evidence, `relay-${theme}.png`) });
  await setup.getByLabel('Relay 地址', { exact: true }).fill(origin); await setup.getByRole('button', { name: '连接 Relay' }).click();
  const page = await pageAt(app, origin); await expect.poll(() => page.evaluate(() => !!window.remoteCodexHost)).toBe(true);
  await app.evaluate(() => { globalThis.__rcDesktopTest.settings.set({ petVisible: false }); globalThis.__rcDesktopTest.windows.createLocal('preferences'); });
  const preferences = await pageAt(app, 'view=preferences');
  await expect(preferences.getByRole('heading', { name: '通用', exact: true })).toBeVisible();
  await preferences.screenshot({ animations: 'disabled', path: join(evidence, `preferences-${theme}.png`) });
  await preferences.getByLabel('提醒方式').selectOption('both');
  await expect.poll(() => app.evaluate(() => globalThis.__rcDesktopTest.settings.get().alertMode)).toBe('both');
  await preferences.getByRole('button', { name: '快捷键', exact: true }).click();
  await preferences.getByRole('textbox', { name: '快捷窗口快捷键' }).fill('CommandOrControl+Shift+Space'); await preferences.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('CommandOrControl+Shift+Space'))).toBe(true);
  const items = [item({ state: 'needsInput', request: { id: `request-${theme}`, kind: 'input', summary: '请选择部署环境' } }), item({ key: 'mac:thread-2', threadId: 'thread-2', turnId: `run-${theme}`, title: '完善桌面端交互细节' }), item({ key: 'mac:thread-3', threadId: 'thread-3', turnId: `done-${theme}`, title: '检查跨设备索引缓存', state: 'completed', unread: true, resultSummary: '离线恢复验证通过' })];
  await page.evaluate(s => window.remoteCodexHost!.activity.sync(s), snapshot(items));
  await app.evaluate(() => globalThis.__rcDesktopTest.windows.createLocal('quick'));
  const quick = await pageAt(app, 'view=quick'); await expect(quick.getByRole('option')).toHaveCount(3);
  await quick.screenshot({ animations: 'disabled', path: join(evidence, `quick-${theme}.png`) });
  // All controls remain inside the small native window in both themes.
  expect(await quick.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
});
