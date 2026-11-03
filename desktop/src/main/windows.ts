import { canUnload, closeForUpdate, UpdateCancelled } from './updateWindows';
import { hasConnection } from './store';
import { pageChrome, readPageChrome } from './pageChrome';
import { t } from '../shared/i18n';
import { BrowserWindow, nativeTheme, screen, shell, type Rectangle } from 'electron';
import { join } from 'node:path';
import { release } from 'node:os';
import { windowPalette, windowsMaterial, windowsGlassMaterial } from '../shared/platform';
import { randomUUID } from 'node:crypto';
import type { Appearance, HostCommand, HostCommandResult } from '../shared/contract';
import { channels as c } from '../shared/channels';
import { deepLinkPath, externalUrl, isSignInUrl, isWebFrame, threadPath } from './security';
import { readJson, writeJson, type SettingsStore } from './store';

export type CommandInput = HostCommand extends infer T ? T extends HostCommand ? Omit<T, 'id'> : never : never;
export type LocalRole = 'quick' | 'preferences' | 'relay' | 'about' | 'offline';
export class Windows {
  readonly relay = new Set<BrowserWindow>();
  readonly local = new Map<BrowserWindow, LocalRole>();
  private ready = new Set<number>();
  private waiters = new Map<string, { sender: number; resolve: (r: HostCommandResult) => void; timer: ReturnType<typeof setTimeout> }>();
  private bounds: Record<string, Rectangle>;
  private pending = new Map<number, (() => void)[]>();
  private positionTimer?: ReturnType<typeof setTimeout>;
  private signInWindow?: BrowserWindow;
  private failedPath = '/';
  retryConnection(): BrowserWindow {
    for (const window of [...this.relay]) window.destroy();
    return this.createMain(this.failedPath);
  }
  private shownQuick = new WeakSet<BrowserWindow>();
  quitting = false;
  closingForUpdate = false;
  private updateWindows: { window: BrowserWindow; path?: string; role?: LocalRole }[] = [];
  private preparedPages: BrowserWindow[] = [];
  async closeForUpdate(prepareTimeoutMs = 300_000): Promise<void> {
    if (this.closingForUpdate) throw new UpdateCancelled();
    const all = BrowserWindow.getAllWindows().filter(window => !window.isDestroyed());
    this.updateWindows = all.map(window => ({ window, ...(this.relay.has(window) ? { path: window.webContents.getURL().slice(this.settings.get().webOrigin.length) || '/' } : {}), role: this.local.get(window) }));
    this.preparedPages = [];
    try {
      for (const window of [...this.relay]) {
        if (window.isDestroyed()) continue;
        this.preparedPages.push(window);
        // Tray-initiated updates must not put a confirmation in a hidden page.
        if (window.isMinimized()) window.restore();
        window.show(); window.focus();
        const answer = await this.queryWindow(window, { type: 'prepareUpdate' }, prepareTimeoutMs);
        if (!answer.ok || !answer.data || typeof answer.data !== 'object' || !('prepared' in answer.data) || answer.data.prepared !== true) throw new UpdateCancelled();
      }
      // Check every renderer before closing any. Shared approval survives this
      // synthetic check, and real beforeunload still has the final veto.
      for (const window of all) if (!await canUnload(window)) throw new UpdateCancelled();
      this.closingForUpdate = true;
      // Data-bearing/utility windows go first; pet close handlers may dispose
      // their paired local windows only after every guarded page has closed.
      const guarded = all.filter(window => this.relay.has(window) || this.local.has(window) || window === this.signInWindow);
      for (const window of [...guarded, ...all.filter(window => !guarded.includes(window))]) if (!await closeForUpdate(window)) throw new UpdateCancelled();
      if (BrowserWindow.getAllWindows().some(window => !window.isDestroyed())) throw new UpdateCancelled();
    } catch (error) { await this.restoreAfterUpdate(); throw error; }
  }
  async restoreAfterUpdate(): Promise<void> {
    this.closingForUpdate = false;
    const prepared = this.preparedPages; this.preparedPages = [];
    await Promise.allSettled(prepared.filter(window => !window.isDestroyed()).map(window => this.queryWindow(window, { type: 'prepareUpdate', cancel: true }, 1000)));
    for (const saved of this.updateWindows) if (saved.window.isDestroyed()) {
      if (saved.path !== undefined) this.createMain(saved.path);
      else if (saved.role) this.createLocal(saved.role);
    }
    this.updateWindows = [];
  }
  private appearance: Appearance | null = null;
  private chromeEpoch = new WeakMap<BrowserWindow, number>();
  setAppearance(appearance: Appearance): void {
    this.appearance = { ...appearance };
    this.refreshChrome();
    for (const [w, role] of this.local) {
      w.setBackgroundColor(role === 'quick' ? '#00000000' : process.platform === 'win32' ? this.palette().background : appearance.effective === 'dark' ? '#232325' : '#f8f8f7');
      w.setTitle(role === 'preferences' ? t('设置 — Pockymoe') : role === 'relay' ? t('连接 — Pockymoe') : 'Pockymoe');
    }
  }
  constructor(private settings: SettingsStore, private dataDir: string) {
    const stored = readJson(join(dataDir, 'window-bounds.json'));
    this.bounds = stored && typeof stored === 'object' ? stored as Record<string, Rectangle> : {};
    nativeTheme.on('updated', () => this.refreshChrome());
  }
  private refreshChrome(): void {
    if (process.platform !== 'win32') return;
    for (const w of [...this.relay, ...[...this.local].filter(([, role]) => role !== 'quick').map(([window]) => window)]) {
      if (w.isDestroyed()) continue;
      w.setTitleBarOverlay(this.overlay()); w.setBackgroundColor(this.palette().background);
      if (this.relay.has(w)) this.syncPageChrome(w);
    }
  }
  private syncPageChrome(window: BrowserWindow): void {
    if (process.platform !== 'win32' || window.isDestroyed() || !isWebFrame(window.webContents.getURL(), this.settings.get().webOrigin, true)) return;
    const epoch = (this.chromeEpoch.get(window) || 0) + 1; this.chromeEpoch.set(window, epoch);
    void window.webContents.executeJavaScript(`(${readPageChrome.toString()})()`).then(value => {
      if (window.isDestroyed() || this.chromeEpoch.get(window) !== epoch || !isWebFrame(window.webContents.getURL(), this.settings.get().webOrigin, true)) return;
      const colors = pageChrome(value); if (!colors) return;
      window.setBackgroundColor(colors.background);
      window.setTitleBarOverlay({ color: colors.toolbar, symbolColor: colors.foreground, height: 38 });
    }).catch(() => { /* Keep the palette fallback while the page navigates or is unavailable. */ });
  }
  private palette() { return windowPalette(this.appearance, nativeTheme.shouldUseDarkColors); }
  private overlay(): { color: string; symbolColor: string; height: number } {
    const palette = this.palette();
    return { color: palette.background, symbolColor: palette.foreground, height: 38 };
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
    if (!hasConnection(this.settings.get())) return this.createLocal('relay');
    const w = new BrowserWindow({
      ...this.currentBounds(), minWidth: 900, minHeight: 600, show: false, title: 'Pockymoe',
      backgroundColor: process.platform === 'darwin' ? '#00000000' : this.palette().background,
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 13 }, vibrancy: 'sidebar' as const, visualEffectState: 'followWindow' as const, transparent: true } : { titleBarStyle: 'hidden' as const, titleBarOverlay: this.overlay(), backgroundMaterial: windowsMaterial(release()) }),
      // The Web window owns account activity even when hidden. Keep its timers
      // and visibility state active so close-to-tray cannot pause native alerts.
      // Keep the persisted session partition name across the product rename.
      webPreferences: { preload: join(__dirname, '../preload/relay.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, partition: 'persist:remote-codex', additionalArguments: [`--pockymoe-web-origin=${this.settings.get().webOrigin}`] }
    });
    let backgrounded = false;
    const webContentsId = w.webContents.id;
    this.relay.add(w);
    w.webContents.on('did-finish-load', () => this.syncPageChrome(w));
    this.secure(w, true);
    w.on('close', e => { if (!this.quitting && !this.closingForUpdate) { e.preventDefault(); backgrounded = true; w.hide(); } });
    w.on('closed', () => {
      this.relay.delete(w); this.ready.delete(webContentsId); this.pending.delete(webContentsId);
      for (const [id, pending] of this.waiters) if (pending.sender === webContentsId) {
        clearTimeout(pending.timer); pending.resolve({ ok: false, error: t('Pockymoe 窗口已关闭') }); this.waiters.delete(id);
      }
    });
    w.webContents.on('did-start-navigation', (_e, _url, inPlace, isMain) => { if (isMain && !inPlace) this.ready.delete(w.webContents.id); });
    w.once('ready-to-show', () => { if (!backgrounded) w.show(); });
    const savePosition = (): void => {
      clearTimeout(this.positionTimer);
      this.positionTimer = setTimeout(() => {
        if (w.isDestroyed() || w.isMinimized() || w.isMaximized()) return;
        const b = w.getBounds(); this.bounds[String(screen.getDisplayMatching(b).id)] = b;
        writeJson(join(this.dataDir, 'window-bounds.json'), this.bounds);
      }, 250);
    };
    w.on('move', savePosition); w.on('resize', savePosition);
    const offline = (): void => {
      if (this.quitting || w.isDestroyed() || !this.relay.has(w)) return;
      backgrounded = true;
      this.failedPath = path;
      w.hide();
      this.createLocal('offline');
    };
    w.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
      if (mainFrame && code !== -3) offline(); // An intentional navigation abort is not an outage.
    });
    void w.loadURL(`${this.settings.get().webOrigin}${threadPath(path)}`).catch(error => { if (error.code !== 'ERR_ABORTED') offline(); });
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
      width: 520, height: 720, title: 'Pockymoe', parent: owner, autoHideMenuBar: process.platform !== 'win32',
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
    const acrylic = process.platform === 'win32' && windowsGlassMaterial(release(), process.env.POCKYMOE_WINDOWS_GLASS === 'solid') === 'acrylic';
    const w = new BrowserWindow({ width: quick ? 560 : role === 'preferences' ? 660 : 460, height: quick ? 340 : role === 'preferences' ? 500 : role === 'about' ? 330 : 320,
      minWidth: quick ? 360 : 380, minHeight: quick ? 100 : 300,
      show: false, resizable: !quick, maximizable: false, minimizable: false, frame: !quick,
      title: role === 'preferences' ? t('设置 — Pockymoe') : role === 'relay' ? t('连接 — Pockymoe') : 'Pockymoe',
      titleBarStyle: !quick ? process.platform === 'darwin' ? 'hiddenInset' : process.platform === 'win32' ? 'hidden' : undefined : undefined,
      ...(process.platform === 'win32' && !quick ? { titleBarOverlay: this.overlay() } : {}),
      vibrancy: process.platform === 'darwin' ? quick ? 'hud' : 'popover' : undefined, visualEffectState: 'active',
      ...(quick ? { transparent: process.platform === 'darwin' || process.platform === 'win32' && !acrylic, ...(acrylic ? { backgroundMaterial: 'acrylic' as const, roundedCorners: true } : {}) } : {}),
      backgroundColor: quick ? '#00000000' : process.platform === 'win32' ? this.palette().background : nativeTheme.shouldUseDarkColors ? '#202022' : '#f8f8f7',
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
    if (this.closingForUpdate) return;
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
  /** Approving, replying or marking read works from the pet or a notification without raising the window. */
  dispatch(input: CommandInput, focus = !['resolveRequest', 'reply', 'markRead'].includes(input.type), timeoutMs = 15_000): Promise<HostCommandResult> {
    if (this.closingForUpdate && input.type !== 'prepareUpdate') return Promise.resolve({ ok: false, error: t('应用正在退出') });
    const w = focus ? this.focusMain() : this.main();
    return this.queryWindow(w, input, timeoutMs);
  }
  queryWindow(w: BrowserWindow, input: CommandInput, timeoutMs = 15_000): Promise<HostCommandResult> {
    const command = { ...input, id: randomUUID() } as HostCommand;
    return new Promise(resolve => {
      const id = w.webContents.id;
      const timer = setTimeout(() => { this.waiters.delete(command.id); resolve({ ok: false, error: t('Pockymoe 页面未响应，请确认已登录并重试') }); }, timeoutMs);
      this.waiters.set(command.id, { sender: id, resolve, timer });
      const send = (): void => { if (!w.isDestroyed() && this.waiters.has(command.id)) w.webContents.send(c.command, command); };
      if (this.ready.has(id)) send();
      else { const queue = this.pending.get(id) || []; queue.push(send); this.pending.set(id, queue.slice(-100)); }
    });
  }
  mainFocused(): boolean { return [...this.relay].some(w => !w.isDestroyed() && w.isFocused()); }
  /** Puts back a main window that macOS raised on its own; blur() also sends it behind other apps. */
  lowerMain(): void { for (const w of this.relay) if (!w.isDestroyed() && w.isFocused()) w.blur(); }
  /** Asks the page for data. It never opens or raises a window: without a page there is simply no answer. */
  query(input: CommandInput, timeoutMs = 15_000): Promise<HostCommandResult> {
    if (![...this.relay].some(w => !w.isDestroyed())) return Promise.resolve({ ok: false, error: t('Pockymoe 页面未响应，请确认已登录并重试') });
    return this.dispatch(input, false, timeoutMs);
  }
  commandResult(sender: number, id: unknown, result: unknown): void {
    if (typeof id !== 'string' || !result || typeof result !== 'object' || typeof (result as HostCommandResult).ok !== 'boolean') return;
    const pending = this.waiters.get(id);
    if (!pending || pending.sender !== sender) return;
    clearTimeout(pending.timer); this.waiters.delete(id);
    const r = result as HostCommandResult;
    pending.resolve({ ok: r.ok, error: typeof r.error === 'string' ? r.error.slice(0, 500) : undefined, ...(r.code === 'needsThread' || r.code === 'supervisorTooOld' ? { code: r.code } : {}), ...(r.data !== undefined ? { data: r.data } : {}) });
  }
  openDeepLink(url: string): void { const path = deepLinkPath(url); if (path) void this.dispatch({ type: 'navigate', path }); }
  dispose(): void { clearTimeout(this.positionTimer); for (const p of this.waiters.values()) { clearTimeout(p.timer); p.resolve({ ok: false, error: t('应用正在退出') }); } }
}
