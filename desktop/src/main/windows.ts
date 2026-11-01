import { t } from '../shared/i18n';
import { BrowserWindow, nativeTheme, screen, shell, type Rectangle } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Appearance, HostCommand, HostCommandResult } from '../shared/contract';
import { channels as c } from '../shared/channels';
import { deepLinkPath, externalUrl, isSignInUrl, isWebFrame, threadPath } from './security';
import { readJson, writeJson, type SettingsStore } from './store';

export type CommandInput = HostCommand extends infer T ? T extends HostCommand ? Omit<T, 'id'> : never : never;
export type LocalRole = 'quick' | 'preferences' | 'relay' | 'about';
export class Windows {
  readonly relay = new Set<BrowserWindow>();
  readonly local = new Map<BrowserWindow, LocalRole>();
  private ready = new Set<number>();
  private waiters = new Map<string, { sender: number; resolve: (r: HostCommandResult) => void; timer: ReturnType<typeof setTimeout> }>();
  private bounds: Record<string, Rectangle>;
  private pending = new Map<number, (() => void)[]>();
  private positionTimer?: ReturnType<typeof setTimeout>;
  private signInWindow?: BrowserWindow;
  private shownQuick = new WeakSet<BrowserWindow>();
  quitting = false;
  private appearance: Appearance | null = null;
  setAppearance(appearance: Appearance): void {
    this.appearance = { ...appearance };
    if (process.platform === 'win32') for (const w of this.relay) w.setTitleBarOverlay(this.overlay());
    for (const [w, role] of this.local) {
      w.setBackgroundColor(role === 'quick' ? '#00000000' : appearance.effective === 'dark' ? '#232325' : '#f8f8f7');
      w.setTitle(role === 'preferences' ? t('设置 — Pockymoe') : role === 'relay' ? t('连接 — Pockymoe') : 'Pockymoe');
    }
  }
  constructor(private settings: SettingsStore, private dataDir: string) {
    const stored = readJson(join(dataDir, 'window-bounds.json'));
    this.bounds = stored && typeof stored === 'object' ? stored as Record<string, Rectangle> : {};
    nativeTheme.on('updated', () => { if (process.platform === 'win32') for (const w of this.relay) w.setTitleBarOverlay(this.overlay()); });
  }
  private overlay(): { color: string; symbolColor: string; height: number } {
    const dark = this.appearance ? this.appearance.effective === 'dark' : nativeTheme.shouldUseDarkColors;
    return { color: dark ? '#202022' : '#f4f4f3', symbolColor: dark ? '#ededed' : '#252525', height: 38 };
  }
  private currentBounds(): Rectangle {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const saved = this.bounds[String(display.id)];
    const area = display.workArea;
    if (saved && [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite) && saved.width >= 900 && saved.height >= 600) {
      const width = Math.min(saved.width, area.width), height = Math.min(saved.height, area.height);
      return { x: Math.max(area.x, Math.min(saved.x, area.x + area.width - width)), y: Math.max(area.y, Math.min(saved.y, area.y + area.height - height)), width, height };
    }
    return { x: area.x + Math.max(0, Math.round((area.width - 1240) / 2)), y: area.y + Math.max(0, Math.round((area.height - 820) / 2)), width: Math.min(1240, area.width), height: Math.min(820, area.height) };
  }
  createMain(path = '/'): BrowserWindow {
    const w = new BrowserWindow({
      ...this.currentBounds(), minWidth: 900, minHeight: 600, show: false, title: 'Pockymoe',
      backgroundColor: process.platform === 'darwin' ? '#00000000' : '#202022',
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 13 }, vibrancy: 'sidebar' as const, visualEffectState: 'followWindow' as const, transparent: true } : { titleBarStyle: 'hidden' as const, titleBarOverlay: this.overlay(), backgroundMaterial: 'mica' as const }),
      // The Web window owns account activity even when hidden. Keep its timers
      // and visibility state active so close-to-tray cannot pause native alerts.
      // Keep the persisted session partition name across the product rename.
      webPreferences: { preload: join(__dirname, '../preload/relay.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, partition: 'persist:remote-codex', additionalArguments: [`--pockymoe-web-origin=${this.settings.get().webOrigin}`] }
    });
    const webContentsId = w.webContents.id;
    this.relay.add(w);
    this.secure(w, true);
    w.on('close', e => { if (!this.quitting) { e.preventDefault(); w.hide(); } });
    w.on('closed', () => {
      this.relay.delete(w); this.ready.delete(webContentsId); this.pending.delete(webContentsId);
      for (const [id, pending] of this.waiters) if (pending.sender === webContentsId) {
        clearTimeout(pending.timer); pending.resolve({ ok: false, error: t('Pockymoe 窗口已关闭') }); this.waiters.delete(id);
      }
    });
    w.webContents.on('did-start-navigation', (_e, _url, inPlace, isMain) => { if (isMain && !inPlace) this.ready.delete(w.webContents.id); });
    w.once('ready-to-show', () => w.show());
    const savePosition = (): void => {
      clearTimeout(this.positionTimer);
      this.positionTimer = setTimeout(() => {
        if (w.isDestroyed() || w.isMinimized() || w.isMaximized()) return;
        const b = w.getBounds(); this.bounds[String(screen.getDisplayMatching(b).id)] = b;
        writeJson(join(this.dataDir, 'window-bounds.json'), this.bounds);
      }, 250);
    };
    w.on('move', savePosition); w.on('resize', savePosition);
    void w.loadURL(`${this.settings.get().webOrigin}${threadPath(path)}`).catch(() => {
      if (!w.isDestroyed()) {
        w.show();
        this.createLocal('relay');
      }
    });
    return w;
  }
  secure(w: BrowserWindow, remote: boolean): void {
    const signIn = (url: string): boolean => remote && isSignInUrl(url, this.settings.get().relayOrigin);
    const external = (url: string): void => {
      if (signIn(url)) { this.openSignIn(w, url); return; }
      const safe = externalUrl(url); if (safe) void shell.openExternal(safe);
    };
    w.webContents.setWindowOpenHandler(({ url }) => {
      if (remote && isWebFrame(url, this.settings.get().webOrigin, true)) {
        const u = new URL(url); this.createMain(`${u.pathname}${u.search}${u.hash}`);
      } else external(url);
      return { action: 'deny' };
    });
    w.webContents.on('will-navigate', (e, url) => {
      if (remote && isWebFrame(url, this.settings.get().webOrigin, true)) return;
      e.preventDefault(); external(url);
    });
    w.webContents.on('will-redirect', (e, url) => {
      if (remote && isWebFrame(url, this.settings.get().webOrigin, true)) return;
      e.preventDefault(); external(url);
    });
    w.webContents.on('will-attach-webview', e => e.preventDefault());
  }
  /**
   * Google and GitHub sign-in gets a plain window on the page's session: in the system
   * browser the relay's cookie would never reach the app. The window has no preload, so
   * a provider's page cannot touch the host bridge. Returning to the Web origin ends it
   * and hands that URL to the page that started it.
   */
  private openSignIn(owner: BrowserWindow, url: string): void {
    if (this.signInWindow && !this.signInWindow.isDestroyed()) { this.signInWindow.focus(); void this.signInWindow.loadURL(url).catch(() => undefined); return; }
    const w = new BrowserWindow({
      width: 520, height: 720, title: 'Pockymoe', parent: owner, autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, partition: 'persist:remote-codex' },
    });
    this.signInWindow = w;
    // Providers refuse browsers that announce themselves as an embedded Electron app.
    w.webContents.setUserAgent(w.webContents.getUserAgent().replace(/ (?:Electron|Pockymoe|pockymoe|@pockymoe\/desktop)\/\S+/g, ''));
    const finish = (e: { preventDefault(): void }, target: string): void => {
      if (!isWebFrame(target, this.settings.get().webOrigin, true)) return;
      e.preventDefault(); w.close();
      if (!owner.isDestroyed()) { void owner.loadURL(target).catch(() => undefined); owner.show(); owner.focus(); }
    };
    w.webContents.on('will-navigate', finish);
    w.webContents.on('will-redirect', finish);
    w.webContents.setWindowOpenHandler(({ url: opened }) => { const safe = externalUrl(opened); if (safe) void shell.openExternal(safe); return { action: 'deny' }; });
    w.webContents.on('will-attach-webview', e => e.preventDefault());
    w.on('closed', () => { if (this.signInWindow === w) this.signInWindow = undefined; });
    void w.loadURL(url).catch(() => undefined);
  }
  createLocal(role: LocalRole): BrowserWindow {
    const existing = [...this.local].find(([w, r]) => r === role && !w.isDestroyed())?.[0];
    if (existing) { existing.show(); existing.focus(); return existing; }
    const quick = role === 'quick';
    const w = new BrowserWindow({ width: quick ? 560 : role === 'preferences' ? 660 : 460, height: quick ? 340 : role === 'preferences' ? 500 : role === 'about' ? 330 : 320,
      minWidth: quick ? 360 : 380, minHeight: quick ? 100 : 300,
      show: false, resizable: !quick, maximizable: false, minimizable: false, frame: !quick,
      title: role === 'preferences' ? t('设置 — Pockymoe') : role === 'relay' ? t('连接 — Pockymoe') : 'Pockymoe',
      titleBarStyle: process.platform === 'darwin' && !quick ? 'hiddenInset' : undefined,
      vibrancy: process.platform === 'darwin' ? quick ? 'hud' : 'popover' : undefined, visualEffectState: 'active',
      ...(quick ? { transparent: process.platform === 'darwin', ...(process.platform === 'win32' ? { backgroundMaterial: 'acrylic' as const } : {}) } : {}),
      backgroundColor: quick ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#202022' : '#f8f8f7',
      webPreferences: { preload: join(__dirname, '../preload/local.js'), contextIsolation: true, sandbox: true, nodeIntegration: false,
        additionalArguments: process.env.ELECTRON_RENDERER_URL ? ['--pockymoe-local-dev'] : [] }
    });
    this.local.set(w, role); this.secure(w, false);
    w.on('closed', () => this.local.delete(w));
    if (quick) { w.setAlwaysOnTop(true, 'floating'); w.on('blur', () => { if (process.env.POCKYMOE_DESKTOP_E2E !== '1') w.hide(); }); }
    w.once('ready-to-show', () => { if (!quick) w.show(); });
    if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(`${process.env.ELECTRON_RENDERER_URL}/local/index.html?view=${role}`);
    else void w.loadFile(join(__dirname, '../renderer/local/index.html'), { query: { view: role } });
    return w;
  }
  fitQuick(window: BrowserWindow, height: number): void {
    if (this.local.get(window) !== 'quick' || !Number.isInteger(height) || height < 100 || height > 420) return;
    const [width, previous] = window.getContentSize();
    if (previous !== height) window.setContentSize(width, height);
    // Show once the first populated render has its final size; later background
    // activity updates must never reopen a quick window the user hid.
    if (!this.shownQuick.has(window)) { this.shownQuick.add(window); window.show(); window.focus(); }
  }
  toggleQuick(): void {
    const w = [...this.local].find(([, r]) => r === 'quick')?.[0];
    if (w?.isVisible() && w.isFocused()) w.hide(); else this.createLocal('quick');
  }
  main(): BrowserWindow { return [...this.relay].find(w => w.isFocused()) || [...this.relay].find(w => !w.isDestroyed()) || this.createMain(); }
  focusMain(): BrowserWindow { const w = this.main(); if (w.isMinimized()) w.restore(); w.show(); w.focus(); return w; }
  commandReady(id: number): void {
    this.ready.add(id);
    const pending = this.pending.get(id); this.pending.delete(id);
    for (const send of pending || []) send();
  }
  dispatch(input: CommandInput, focus = true): Promise<HostCommandResult> {
    const w = focus ? this.focusMain() : this.main();
    const command = { ...input, id: randomUUID() } as HostCommand;
    return new Promise(resolve => {
      const id = w.webContents.id;
      const timer = setTimeout(() => { this.waiters.delete(command.id); resolve({ ok: false, error: t('Pockymoe 页面未响应，请确认已登录并重试') }); }, 15_000);
      this.waiters.set(command.id, { sender: id, resolve, timer });
      const send = (): void => { if (!w.isDestroyed() && this.waiters.has(command.id)) w.webContents.send(c.command, command); };
      if (this.ready.has(id)) send();
      else { const queue = this.pending.get(id) || []; queue.push(send); this.pending.set(id, queue.slice(-100)); }
    });
  }
  commandResult(sender: number, id: unknown, result: unknown): void {
    if (typeof id !== 'string' || !result || typeof result !== 'object' || typeof (result as HostCommandResult).ok !== 'boolean') return;
    const pending = this.waiters.get(id);
    if (!pending || pending.sender !== sender) return;
    clearTimeout(pending.timer); this.waiters.delete(id);
    const r = result as HostCommandResult;
    pending.resolve({ ok: r.ok, error: typeof r.error === 'string' ? r.error.slice(0, 500) : undefined, ...(r.code === 'needsThread' ? { code: r.code } : {}) });
  }
  openDeepLink(url: string): void { const path = deepLinkPath(url); if (path) void this.dispatch({ type: 'navigate', path }); }
  dispose(): void { clearTimeout(this.positionTimer); for (const p of this.waiters.values()) { clearTimeout(p.timer); p.resolve({ ok: false, error: t('应用正在退出') }); } }
}
