import { app, BrowserWindow, dialog, globalShortcut, ipcMain, nativeTheme, Notification, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { basename, join } from 'node:path';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { HostCapabilities, PetController, PetControllerDeps } from '../shared/contract';
import type { LocalAction, LocalState } from '../shared/local';
import { channels as c } from '../shared/channels';
import { ActivityHub, alertId, validateSnapshot } from './activity';
import { SettingsStore, validateSettings } from './store';
import { externalUrl, isRelayFrame, relayOrigin, threadPath } from './security';
import { Windows, type CommandInput } from './windows';
import { Notifications, itemPath } from './notifications';
import { DesktopTray } from './tray';
import { installMenu } from './menu';
import { apnsEnabled, registerApns } from './apns';
import { checkUpdate, configureUpdates } from './updates';

if (process.env.RC_DESKTOP_USER_DATA) app.setPath('userData', process.env.RC_DESKTOP_USER_DATA);
app.setName('Remote Codex');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let windows: Windows | undefined;
  const deepLinks: string[] = [];
  app.on('open-url', (event, url) => { event.preventDefault(); if (windows) windows.openDeepLink(url); else deepLinks.push(url); });
  app.on('second-instance', (_event, argv) => { windows?.focusMain(); for (const arg of argv) if (arg.startsWith('remotecodex:')) windows?.openDeepLink(arg); });
  app.on('window-all-closed', () => { /* Tray presence keeps the app running. */ });
  void app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('com.remotecodex.desktop');
    if (process.env.RC_DESKTOP_THEME === 'dark' || process.env.RC_DESKTOP_THEME === 'light') nativeTheme.themeSource = process.env.RC_DESKTOP_THEME;
    const dataDir = app.getPath('userData');
    const settings = new SettingsStore(join(dataDir, 'settings.json'), process.env.RC_DESKTOP_RELAY_ORIGIN);
    const hub = new ActivityHub(join(dataDir, 'delivered-alerts.json'));
    const manager = new Windows(settings, dataDir); windows = manager;
    const focusedThreads = new Map<number, string | null>();
    let pet: PetController | undefined;
    const notifications = new Notifications(hub, settings, manager, () => pet, () => {
      const w = [...manager.relay].find(w => w.isFocused()); return w ? focusedThreads.get(w.webContents.id) ?? null : null;
    });
    const petDirectories = [app.isPackaged ? join(process.resourcesPath, 'pets') : join(app.getAppPath(), 'assets/pets'), join(dataDir, 'pets')];
    mkdirSync(petDirectories[1], { recursive: true });
    const petModules = import.meta.glob('../pet/controller.ts', { eager: true }) as Record<string, { createPetController(deps: PetControllerDeps): PetController }>;
    const petModule = Object.values(petModules)[0];
    if (petModule) {
      try { pet = petModule.createPetController({ hub, settings, dispatch: command => manager.dispatch(command as CommandInput), shouldSpeak: event => notifications.shouldSpeak(event), petDirectories }); }
      catch { /* Shell remains usable if a pet pack cannot load. */ }
    }
    const tray = new DesktopTray(hub, settings, manager);
    const capabilities = (): HostCapabilities => ({
      surface: 'desktop', bridgeVersion: 1, platform: process.platform as HostCapabilities['platform'], shellVersion: app.getVersion(),
      notifications: apnsEnabled() ? 'local+apns' : 'local',
      windowChrome: { kind: process.platform === 'darwin' ? 'hiddenInset' : 'titleBarOverlay', trafficLightsWidth: process.platform === 'darwin' ? 78 : 138, toolbarHeight: 38, controlsSide: process.platform === 'darwin' ? 'left' : 'right' },
      features: { pet: !!pet, quickWindow: true, multiWindow: true, nativeSave: true, badge: true }
    });
    const guardRelay = (e: IpcMainEvent | IpcMainInvokeEvent): void => {
      const w = BrowserWindow.fromWebContents(e.sender);
      if (!w || !manager.relay.has(w) || !e.senderFrame || e.senderFrame !== e.sender.mainFrame || !isRelayFrame(e.senderFrame.url, settings.get().relayOrigin, true)) throw new Error('Untrusted desktop IPC sender');
    };
    const guardLocal = (e: IpcMainInvokeEvent): BrowserWindow => {
      const w = BrowserWindow.fromWebContents(e.sender);
      if (!w || !manager.local.has(w) || e.senderFrame !== e.sender.mainFrame) throw new Error('Untrusted local IPC sender');
      const url = new URL(e.senderFrame.url);
      const valid = process.env.ELECTRON_RENDERER_URL ? url.origin === new URL(process.env.ELECTRON_RENDERER_URL).origin && url.pathname === '/local/index.html' : url.protocol === 'file:' && decodeURIComponent(url.pathname) === join(__dirname, '../renderer/local/index.html');
      if (!valid) throw new Error('Untrusted local page');
      return w;
    };
    const handle = (channel: string, fn: (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void => { ipcMain.handle(channel, (e, ...args) => { guardRelay(e); return fn(e, ...args); }); };
    const listen = (channel: string, fn: (e: IpcMainEvent, ...args: unknown[]) => void): void => { ipcMain.on(channel, (e, ...args) => { try { guardRelay(e); fn(e, ...args); } catch { /* Reject malformed or stale renderer messages. */ } }); };
    handle(c.capabilities, () => capabilities());
    listen(c.sync, (e, value) => {
      const snapshot = validateSnapshot(value);
      focusedThreads.set(e.sender.id, snapshot.focusedThreadKey);
      hub.sync(snapshot);
    });
    listen('desktop.command.ready', e => manager.commandReady(e.sender.id));
    listen(c.commandResult, (e, id, result) => manager.commandResult(e.sender.id, id, result));
    listen(c.openThread, (_e, path, options) => { const safe = threadPath(path); if (options && typeof options === 'object' && (options as { newWindow?: boolean }).newWindow === true) manager.createMain(safe); else void manager.dispatch({ type: 'navigate', path: safe }); });
    listen(c.title, (e, title) => { if (typeof title === 'string') BrowserWindow.fromWebContents(e.sender)?.setTitle(title.slice(0, 256)); });
    listen(c.external, (_e, url) => { const safe = externalUrl(url); if (safe) void shell.openExternal(safe); });
    handle(c.settingsGet, () => settings.get());
    handle(c.settingsSet, (_e, patch) => applySettings(patch));
    listen(c.petSet, (_e, visible) => { if (typeof visible === 'boolean') settings.set({ petVisible: visible }); });
    handle(c.petGet, () => pet?.isVisible() ?? false);
    listen(c.badge, (_e, count, style) => { if (typeof count === 'number' && Number.isFinite(count) && ['attention', 'running', 'none'].includes(String(style))) tray.setBadge(count, style as 'attention' | 'running' | 'none'); });
    const savedNotifications = new Set<Notification>();
    const savedNotification = (path: string): void => {
      if (!Notification.isSupported()) return;
      const n = new Notification({ title: '文件已保存', body: `${basename(path)} · 点按以在${process.platform === 'darwin' ? ' Finder ' : '资源管理器'}中显示` });
      savedNotifications.add(n);
      n.on('close', () => savedNotifications.delete(n));
      n.on('click', () => shell.showItemInFolder(path)); n.show();
    };
    handle(c.save, async (e, name, data) => {
      if (typeof name !== 'string' || !(data instanceof ArrayBuffer) || data.byteLength > 64 * 1024 * 1024) throw new Error('Invalid file (maximum 64 MB)');
      const parent = BrowserWindow.fromWebContents(e.sender)!;
      const result = await dialog.showSaveDialog(parent, { defaultPath: basename(name).slice(0, 255) || 'download' });
      if (result.canceled || !result.filePath) return { saved: false };
      writeFileSync(result.filePath, Buffer.from(data)); savedNotification(result.filePath);
      return { saved: true, path: result.filePath };
    });
    const relaySession = session.fromPartition('persist:remote-codex');
    const allowedPermission = (permission: string): boolean => ['notifications', 'clipboard-read', 'clipboard-sanitized-write', 'deprecated-sync-clipboard-read'].includes(permission);
    relaySession.setPermissionCheckHandler((wc, permission, origin, details) => !!wc && allowedPermission(permission) && details.isMainFrame && origin === settings.get().relayOrigin && isRelayFrame(wc.getURL(), settings.get().relayOrigin, true));
    relaySession.setPermissionRequestHandler((wc, permission, callback, details) => callback(allowedPermission(permission) && details.isMainFrame && isRelayFrame(details.requestingUrl, settings.get().relayOrigin, true) && isRelayFrame(wc.getURL(), settings.get().relayOrigin, true)));
    relaySession.on('will-download', (event, item, wc) => {
      const w = BrowserWindow.fromWebContents(wc);
      if (!w || !manager.relay.has(w)) { event.preventDefault(); return; }
      item.setSaveDialogOptions({ defaultPath: join(app.getPath('downloads'), basename(item.getFilename())) });
      item.once('done', (_e, state) => { if (state === 'completed') savedNotification(item.getSavePath()); });
    });
    function applySettings(patch: unknown): ReturnType<SettingsStore['get']> {
      const next = validateSettings(patch);
      if (next?.quickWindowShortcut && next.quickWindowShortcut !== settings.get().quickWindowShortcut) {
        if (!globalShortcut.register(next.quickWindowShortcut, () => manager.toggleQuick())) throw new Error('快捷键已被占用或无效');
        globalShortcut.unregister(settings.get().quickWindowShortcut);
      }
      return settings.set(next);
    }
    function packs(): LocalState['petPacks'] {
      const entries = new Map<string, string>();
      for (const dir of petDirectories) {
        try { for (const entry of readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory()) {
          try { const json = JSON.parse(readFileSync(join(dir, entry.name, 'pet.json'), 'utf8')); entries.set(entry.name, typeof json.name === 'string' ? json.name : entry.name); } catch { /* Ignore incomplete packs. */ }
        } } catch { /* No installed packs yet. */ }
      }
      return [...entries].map(([id, name]) => ({ id, name }));
    }
    const localState = (): LocalState => ({ settings: settings.get(), snapshot: hub.snapshot(), petAvailable: !!pet, petPacks: packs(), version: app.getVersion() });
    const broadcast = (): void => { for (const w of manager.local.keys()) if (!w.isDestroyed()) w.webContents.send(c.localState, localState()); };
    ipcMain.handle(c.localGet, e => { guardLocal(e); return localState(); });
    ipcMain.handle(c.localAction, async (e, value: unknown) => {
      try {
        const w = guardLocal(e);
        if (!value || typeof value !== 'object') throw new Error('Invalid action');
        const action = value as LocalAction;
        switch (action.type) {
          case 'settings': applySettings(action.patch); break;
          case 'connect': {
            const origin = relayOrigin(action.origin);
            const changed = origin !== settings.get().relayOrigin;
            applySettings({ relayOrigin: origin });
            if (!changed) manager.focusMain();
            if (process.env.RC_DESKTOP_E2E !== '1') void registerApns(settings, manager);
            w.close(); break;
          }
          case 'hide': w.hide(); break;
          case 'open': case 'reply': {
            const item = hub.snapshot()?.items.find(i => i.key === action.key);
            if (!item) throw new Error('线程已不在活动列表中');
            if (action.type === 'reply') {
              if (typeof action.text !== 'string' || !action.text.trim() || action.text.length > 10_000) throw new Error('请输入回复');
              const result = await manager.dispatch({ type: 'reply', deviceId: item.deviceId, threadId: item.threadId, text: action.text.trim() }, false);
              if (!result.ok) return result;
            } else {
              w.hide(); hub.acknowledge(alertId(item), 'quick');
              const result = await manager.dispatch({ type: 'navigate', path: itemPath(item) });
              if (!result.ok) return result;
              void manager.dispatch({ type: 'markRead', key: item.key }, false);
            }
            break;
          }
          case 'importPet': {
            // Pet module owns pack validation/import and its native file dialog.
            const importer = petModule as typeof petModule & { importPetPack?: (deps: { petDirectories: string[]; settings: SettingsStore; parent: BrowserWindow }) => Promise<void> };
            if (!importer?.importPetPack) throw new Error('当前桌宠模块不支持导入');
            await importer.importPetPack({ petDirectories, settings, parent: w }); broadcast(); break;
          }
          case 'checkUpdate': await checkUpdate(); break;
          default: throw new Error('Unknown desktop action');
        }
        return { ok: true };
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : '操作失败' }; }
    });
    let old = settings.get();
    settings.onChange(next => {
      pet?.setVisible(next.petVisible);
      if (next.launchAtLogin !== old.launchAtLogin && process.env.RC_DESKTOP_E2E !== '1') app.setLoginItemSettings({ openAtLogin: next.launchAtLogin });
      if (next.relayOrigin !== old.relayOrigin) {
        for (const w of [...manager.relay]) w.destroy();
        focusedThreads.clear();
        hub.sync({ version: 1, generatedAt: new Date().toISOString(), accountId: 'relay-changed', focusedThreadKey: null, items: [] });
        manager.createMain();
        if (process.env.RC_DESKTOP_E2E !== '1') void registerApns(settings, manager);
      }
      old = next; broadcast();
    });
    hub.onSnapshot(broadcast);
    globalShortcut.register(settings.get().quickWindowShortcut, () => manager.toggleQuick());
    installMenu(manager, settings);
    if (settings.firstRun) manager.createLocal('relay'); else manager.createMain();
    if (process.env.RC_DESKTOP_E2E !== '1') {
      if (app.isPackaged) app.setAsDefaultProtocolClient('remotecodex');
      else app.setAsDefaultProtocolClient('remotecodex', process.execPath, [app.getAppPath()]);
    }
    for (const url of [...deepLinks, ...process.argv.filter(a => a.startsWith('remotecodex:'))]) manager.openDeepLink(url);
    if (process.env.RC_DESKTOP_E2E !== '1') { configureUpdates(); void registerApns(settings, manager); }
    app.on('activate', () => { if (manager.relay.size) manager.focusMain(); else manager.createLocal('relay'); });
    app.on('before-quit', () => { manager.quitting = true; manager.dispose(); notifications.dispose(); pet?.dispose(); tray.dispose(); globalShortcut.unregisterAll(); });
    if (process.env.RC_DESKTOP_E2E === '1') Object.assign(globalThis, { __rcDesktopTest: { hub, settings, windows: manager, tray, notifications, capabilities } });
  }).catch(error => {
    if (process.env.RC_DESKTOP_E2E === '1') console.error(error);
    else dialog.showErrorBox('Remote Codex 无法启动', '请检查桌面应用的本地配置后重试。');
    app.quit();
  });
}
