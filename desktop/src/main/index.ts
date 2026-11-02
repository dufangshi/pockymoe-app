import { hasConnection } from './store';
import { t, getLocale, setLocale } from '../shared/i18n';
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, nativeTheme, Notification, session, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { localFileMatches } from './platform';
import { release } from 'node:os';
import { saveName, windowsGlassMaterial } from '../shared/platform';
import { basename, join } from 'node:path';
import { mkdirSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import type { HostCapabilities, PetController, PetControllerDeps } from '../shared/contract';
import type { LocalAction, LocalState } from '../shared/local';
import { channels as c } from '../shared/channels';
import { ActivityHub, alertId, validateSnapshot } from './activity';
import { pageSettings, pageSettingsPatch, SettingsStore, validateSettings } from './store';
import { externalUrl, isWebFrame, threadPath } from './security';
import { AppearanceStore } from './appearance';
import { discoverOrigins } from './discovery';
import { Windows, type CommandInput } from './windows';
import { Notifications, itemPath } from './notifications';
import { DesktopTray } from './tray';
import { installMenu } from './menu';
import { apnsEnabled, registerApns } from './apns';
import { autoUpdater, checkUpdate, configureUpdates, type ShowMessage } from './updates';
import { LocalMessages } from './messages';
import { PetCatalog } from './petCatalog';
import { VoiceService } from './voice';

app.setName('Pockymoe');
app.setPath('userData', process.env.POCKYMOE_DESKTOP_USER_DATA || join(app.getPath('appData'), 'Pockymoe'));
// Only migrate the old JSON settings, never inspect or copy credentials/keys.
const settingsPath = join(app.getPath('userData'), 'settings.json');
const oldSettingsPath = join(app.getPath('appData'), 'Remote Codex', 'settings.json');
if (!process.env.POCKYMOE_DESKTOP_USER_DATA && !existsSync(settingsPath) && existsSync(oldSettingsPath)) {
  mkdirSync(app.getPath('userData'), { recursive: true }); copyFileSync(oldSettingsPath, settingsPath);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  if (process.platform === 'win32') app.on('browser-window-created', (_event, window) => { window.setAutoHideMenuBar(false); window.setMenuBarVisibility(false); });
  let windows: Windows | undefined;
  app.on('before-quit', () => { if (windows) windows.quitting = true; });
  let activateToast: ((url: string) => boolean) | undefined;
  const openLink = (url: string): void => { if (!activateToast?.(url)) windows?.openDeepLink(url); };
  const deepLinks: string[] = [];
  app.on('open-url', (event, url) => { event.preventDefault(); if (windows) openLink(url); else deepLinks.push(url); });
  app.on('second-instance', (_event, argv) => {
    const links = argv.filter(arg => /^(pockymoe|remotecodex):/.test(arg));
    const remaining = links.filter(url => !activateToast?.(url));
    if (links.length && !remaining.length) return;
    windows?.focusMain();
    for (const url of remaining) { if (windows) openLink(url); else if (process.platform === 'win32') deepLinks.push(url); }
  });
  app.on('window-all-closed', () => { /* Tray presence keeps the app running. */ });
  void app.whenReady().then(async () => {
    setLocale(app.getLocale());
    if (process.platform === 'win32') app.setAppUserModelId('com.pockymoe.desktop');
    if (process.env.POCKYMOE_DESKTOP_THEME === 'dark' || process.env.POCKYMOE_DESKTOP_THEME === 'light') nativeTheme.themeSource = process.env.POCKYMOE_DESKTOP_THEME;
    const dataDir = app.getPath('userData');
    const settings = new SettingsStore(join(dataDir, 'settings.json'), {
      ...(process.env.POCKYMOE_DESKTOP_WEB_ORIGIN ? { webOrigin: process.env.POCKYMOE_DESKTOP_WEB_ORIGIN } : {}),
      ...(process.env.POCKYMOE_DESKTOP_RELAY_ORIGIN ? { relayOrigin: process.env.POCKYMOE_DESKTOP_RELAY_ORIGIN } : {})
    });
    let connectionError = '';
    if (settings.legacyRelay) {
      try { settings.set(await discoverOrigins(settings.legacyRelay)); }
      catch { settings.set({ webOrigin: '' }); connectionError = t('无法连接已保存的地址，请检查后重试。'); }
    }
    const hub = new ActivityHub(join(dataDir, 'delivered-alerts.json'));
    const manager = new Windows(settings, dataDir); windows = manager;
    const appearance = new AppearanceStore();
    let preferencesRequestId = 0;
    let preferencesSection: LocalState['preferencesSection'] = 'general';
    const openPreferences = (section?: LocalState['preferencesSection']): void => {
      preferencesRequestId++;
      preferencesSection = section || 'general';
      manager.createLocal('preferences'); broadcast();
    };
    const focusedThreads = new Map<number, string | null>();
    let pet: PetController | undefined;
    const notifications = new Notifications(hub, settings, manager, () => pet, () => {
      const w = [...manager.relay].find(w => w.isFocused()); return w ? focusedThreads.get(w.webContents.id) ?? null : null;
    });
    activateToast = url => notifications.activate(url);
    const voice = new VoiceService(dataDir, settings, () => pet?.say(t('语音已就绪')), (command, timeoutMs) => manager.query(command as CommandInput, timeoutMs));
    const petDirectories = [app.isPackaged ? join(process.resourcesPath, 'pets') : join(app.getAppPath(), 'assets/pets'), join(dataDir, 'pets')];
    mkdirSync(petDirectories[1], { recursive: true });
    const petCatalog = new PetCatalog(petDirectories);
    session.defaultSession.protocol.handle('pockymoe-pet', request => petCatalog.asset(request.url));
    const petModules = import.meta.glob('../pet/controller.ts', { eager: true }) as Record<string, { createPetController(deps: PetControllerDeps): PetController }>;
    const petModule = Object.values(petModules)[0];
    if (petModule) {
      try { pet = petModule.createPetController({ hub, settings, dispatch: command => manager.dispatch(command as CommandInput), openPreferences, mainFocused: () => manager.mainFocused(), lowerMain: () => manager.lowerMain(), speak: text => voice.speak(text), summarize: event => voice.summarize(event), shouldSpeak: event => notifications.shouldSpeak(event), petDirectories, appearance: appearance.get, onAppearance: appearance.onChange }); }
      catch { /* Shell remains usable if a pet pack cannot load. */ }
    }
    const tray = new DesktopTray(hub, settings, manager);
    const capabilities = (): HostCapabilities => ({
      surface: 'desktop', bridgeVersion: 2, platform: process.platform as HostCapabilities['platform'], shellVersion: app.getVersion(),
      notifications: apnsEnabled() ? 'local+apns' : 'local',
      windowChrome: { kind: process.platform === 'darwin' ? 'hiddenInset' : 'titleBarOverlay', trafficLightsWidth: process.platform === 'darwin' ? 78 : 138, toolbarHeight: 38, controlsSide: process.platform === 'darwin' ? 'left' : 'right' },
      features: { pet: pet?.isAvailable() ?? false, quickWindow: true, multiWindow: true, nativeSave: true, badge: true }
    });
    const guardRelay = (e: IpcMainEvent | IpcMainInvokeEvent): void => {
      const w = BrowserWindow.fromWebContents(e.sender);
      if (!w || !manager.relay.has(w) || !e.senderFrame || e.senderFrame !== e.sender.mainFrame || !isWebFrame(e.senderFrame.url, settings.get().webOrigin, true)) throw new Error('Untrusted desktop IPC sender');
    };
    const guardLocal = (e: IpcMainInvokeEvent): BrowserWindow => {
      const w = BrowserWindow.fromWebContents(e.sender);
      if (!w || !manager.local.has(w) || e.senderFrame !== e.sender.mainFrame) throw new Error('Untrusted local IPC sender');
      const url = new URL(e.senderFrame.url);
      const valid = process.env.ELECTRON_RENDERER_URL ? url.origin === new URL(process.env.ELECTRON_RENDERER_URL).origin && url.pathname === '/local/index.html' : localFileMatches(url.href, join(__dirname, '../renderer/local/index.html'));
      if (!valid) throw new Error('Untrusted local page');
      return w;
    };
    const handle = (channel: string, fn: (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void => { ipcMain.handle(channel, (e, ...args) => { guardRelay(e); return fn(e, ...args); }); };
    const listen = (channel: string, fn: (e: IpcMainEvent, ...args: unknown[]) => void): void => { ipcMain.on(channel, (e, ...args) => { try { guardRelay(e); fn(e, ...args); } catch { /* Reject malformed or stale renderer messages. */ } }); };
    listen(c.appearance, (_e, value) => appearance.sync(value));
    handle(c.capabilities, () => capabilities());
    listen(c.sync, (e, value) => {
      const snapshot = validateSnapshot(value);
      focusedThreads.set(e.sender.id, snapshot.focusedThreadKey);
      hub.sync(snapshot);
    });
    listen('desktop.command.ready', e => manager.commandReady(e.sender.id));
    listen(c.commandResult, (e, id, result) => manager.commandResult(e.sender.id, id, result));
    listen(c.openThread, (_e, path, options) => { const safe = threadPath(path); if (options && typeof options === 'object' && (options as { newWindow?: boolean }).newWindow === true) manager.createMain(safe); else void manager.dispatch({ type: 'navigate', path: safe }); });
    listen(c.preferences, (_e, section) => {
      if (section !== undefined && !['general', 'pet', 'shortcuts'].includes(String(section))) return;
      openPreferences(section as LocalState['preferencesSection'] | undefined);
    });
    listen(c.title, (e, title) => { if (typeof title === 'string') BrowserWindow.fromWebContents(e.sender)?.setTitle(title.slice(0, 256)); });
    listen(c.external, (_e, url) => { const safe = externalUrl(url); if (safe) void shell.openExternal(safe); });
    handle(c.settingsGet, () => pageSettings(settings.get()));
    handle(c.settingsSet, (_e, patch) => pageSettings(applySettings(pageSettingsPatch(patch))));
    listen(c.petSet, (_e, visible) => { if (typeof visible === 'boolean') settings.set({ petVisible: visible }); });
    handle(c.petGet, () => pet?.isVisible() ?? false);
    listen(c.badge, (_e, count, style) => { if (typeof count === 'number' && Number.isFinite(count) && ['attention', 'running', 'none'].includes(String(style))) { if (hub.snapshot()) tray.update(); else tray.setBadge(count, style as 'attention' | 'running' | 'none'); } });
    const savedNotifications = new Map<Notification, string>();
    const savedNotification = (path: string, id?: string): void => {
      if (!Notification.isSupported()) return;
      const n = new Notification({ ...(id ? { id } : {}), title: t('文件已保存'), body: t(process.platform === 'darwin' ? '{name} · 点按以在 Finder 中显示' : '{name} · 点按以在资源管理器中显示', { name: basename(path) }) });
      savedNotifications.set(n, path);
      n.on('close', () => savedNotifications.delete(n));
      n.on('click', () => shell.showItemInFolder(path)); n.show();
    };
    handle(c.save, async (e, name, data) => {
      if (typeof name !== 'string' || !(data instanceof ArrayBuffer) || data.byteLength > 64 * 1024 * 1024) throw new Error(t('文件无效（最大 64 MB）'));
      const parent = BrowserWindow.fromWebContents(e.sender)!;
      const result = await dialog.showSaveDialog(parent, { title: t('保存文件'), buttonLabel: t('保存'), nameFieldLabel: t('文件名'), defaultPath: process.platform === 'win32' ? saveName(name, process.platform) : basename(name).slice(0, 255) || 'download' });
      if (result.canceled || !result.filePath) return { saved: false };
      writeFileSync(result.filePath, Buffer.from(data)); savedNotification(result.filePath);
      return { saved: true, path: result.filePath };
    });
    const relaySession = session.fromPartition('persist:remote-codex');
    const allowedPermission = (permission: string): boolean => ['notifications', 'clipboard-read', 'clipboard-sanitized-write', 'deprecated-sync-clipboard-read'].includes(permission);
    relaySession.setPermissionCheckHandler((wc, permission, origin, details) => !!wc && allowedPermission(permission) && details.isMainFrame && origin === settings.get().webOrigin && isWebFrame(wc.getURL(), settings.get().webOrigin, true));
    relaySession.setPermissionRequestHandler((wc, permission, callback, details) => callback(allowedPermission(permission) && details.isMainFrame && isWebFrame(details.requestingUrl, settings.get().webOrigin, true) && isWebFrame(wc.getURL(), settings.get().webOrigin, true)));
    relaySession.on('will-download', (event, item, wc) => {
      const w = BrowserWindow.fromWebContents(wc);
      if (!w || !manager.relay.has(w)) { event.preventDefault(); return; }
      item.setSaveDialogOptions({ defaultPath: join(app.getPath('downloads'), process.platform === 'win32' ? saveName(item.getFilename(), process.platform) : basename(item.getFilename())) });
      item.once('done', (_e, state) => { if (state === 'completed') savedNotification(item.getSavePath()); });
    });
    function applySettings(patch: unknown): ReturnType<SettingsStore['get']> {
      const next = validateSettings(patch);
      if (next?.quickWindowShortcut && next.quickWindowShortcut !== settings.get().quickWindowShortcut) {
        if (!globalShortcut.register(next.quickWindowShortcut, () => manager.toggleQuick())) throw new Error(t('快捷键已被占用或无效'));
        globalShortcut.unregister(settings.get().quickWindowShortcut);
      }
      return settings.set(next);
    }
    const messages = new LocalMessages(() => broadcast());
    const showMessageBox: ShowMessage = options => process.platform === 'win32' ? messages.show(options, manager.createLocal('preferences')) : dialog.showMessageBox(options);
    let stateRevision = 0;
    const localState = (window?: BrowserWindow): LocalState => ({ revision: stateRevision, connectionError, message: window ? messages.view(window.id) : null, platform: process.platform, glassFallback: process.platform === 'win32' && windowsGlassMaterial(release(), process.env.POCKYMOE_WINDOWS_GLASS === 'solid') === 'solid', locale: getLocale(), preferencesRequestId, preferencesSection, settings: settings.get(), appearance: appearance.get(), snapshot: hub.snapshot(), petAvailable: pet?.isAvailable() ?? false, petPacks: petCatalog.list(), version: app.getVersion(), voice: voice.status(), summary: voice.summaryStatus() });
    const broadcast = (): void => { stateRevision++; for (const w of manager.local.keys()) if (!w.isDestroyed()) w.webContents.send(c.localState, localState(w)); };
    voice.onChange(broadcast);
    let nativeLocale = getLocale();
    appearance.onChange(next => {
      manager.setAppearance(next); tray.setAppearance(next);
      if (nativeLocale !== getLocale()) { nativeLocale = getLocale(); installMenu(manager, settings); notifications.refreshLocale();
        for (const [notice, path] of [...savedNotifications]) { notice.close(); savedNotification(path, notice.id); } }
      broadcast();
    });
    ipcMain.handle(c.localGet, e => localState(guardLocal(e)));
    ipcMain.handle(c.localAction, async (e, value: unknown) => {
      try {
        const w = guardLocal(e);
        if (!value || typeof value !== 'object') throw new Error(t('操作无效'));
        const action = value as LocalAction;
        if (!hasConnection(settings.get()) && (action.type.startsWith('voice') || ['summaryConnections', 'summaryModels', 'summaryTest', 'muteTargets', 'external'].includes(action.type))) throw new Error(t('请输入有效的 Pockymoe 地址'));
        switch (action.type) {
          case 'settings': applySettings(action.patch); break;
          case 'connect': {
            const pair = await discoverOrigins(action.webOrigin || action.origin, fetch, action.relayOrigin || undefined);
            connectionError = '';
            const changed = pair.webOrigin !== settings.get().webOrigin || pair.relayOrigin !== settings.get().relayOrigin;
            applySettings(pair);
            if (!changed) manager.retryConnection();
            if (process.env.POCKYMOE_DESKTOP_E2E !== '1') void registerApns(settings, manager);
            w.close(); break;
          }
          case 'changeConnection': connectionError = ''; manager.createLocal('relay'); if (manager.local.get(w) === 'offline') w.close(); break;
          case 'retryConnection': w.close(); manager.retryConnection(); break;
          case 'hide': w.hide(); break;
          case 'quickSize': manager.fitQuick(w, action.height); break;
          case 'connectionSize': {
            if (manager.local.get(w) === 'relay' && typeof action.expanded === 'boolean') {
              const [width, height] = w.getContentSize(), next = action.expanded ? 500 : 320;
              if (height !== next) w.setContentSize(width, next);
            }
            break;
          }
          case 'open': case 'reply': {
            const snapshot = hub.snapshot();
            const active = snapshot?.items.find(i => i.key === action.key);
            const item = active || snapshot?.recent?.find(i => i.key === action.key);
            if (!item) throw new Error(t('线程已不在活动列表中'));
            if (action.type === 'reply') {
              if (typeof action.text !== 'string' || !action.text.trim() || action.text.length > 10_000) throw new Error(t('请输入回复'));
              const result = await manager.dispatch({ type: 'reply', deviceId: item.deviceId, threadId: item.threadId, text: action.text.trim() }, false);
              if (!result.ok) return result;
            } else {
              w.hide(); if (active) hub.acknowledge(alertId(active), 'quick');
              const result = await manager.dispatch({ type: 'navigate', path: itemPath(item) });
              if (!result.ok) return result;
              void manager.dispatch({ type: 'markRead', key: item.key }, false);
            }
            break;
          }
          case 'importPet': {
            // Pet module owns pack validation/import and its native file dialog.
            const importer = petModule as typeof petModule & { importPetPack?: (deps: { petDirectories: string[]; settings: SettingsStore; parent: BrowserWindow }) => Promise<void> };
            if (!importer?.importPetPack) throw new Error(t('当前桌宠模块不支持导入'));
            await importer.importPetPack({ petDirectories, settings, parent: w }); petCatalog.refresh(); await pet?.reloadPacks(); broadcast(); break;
          }
          case 'external': {
            const safe = externalUrl(action.url); if (!safe) throw new Error(t('操作无效'));
            await shell.openExternal(safe); break;
          }
          case 'checkUpdate': if (hasConnection(settings.get())) await checkUpdate(showMessageBox); break;
          case 'messageResponse':
            if (!messages.respond(w.id, action.id, action.response)) throw new Error(t('操作无效'));
            break;
          case 'voiceModel':
            if (action.command === 'download') void voice.model.download();
            else if (action.command === 'cancel') voice.model.cancel();
            else if (action.command === 'remove') { voice.stopWorker(); await voice.model.remove(); }
            break;
          case 'voiceInstall': voice.install(); break;
          case 'openUpstreams': {
            const result = await manager.dispatch({ type: 'openUpstreams' });
            if (!result.ok) return result;
            break;
          }
          case 'summaryConnections': await voice.refreshConnections(); break;
          case 'muteTargets': await voice.refreshMuteTargets(); break;
          case 'summaryTest': {
            if (!pet) throw new Error(t('桌宠模块尚未安装。'));
            const line = await voice.testSummary();
            // The summary worked. If the voice can't read it, the voice row says why.
            await voice.preview(line).then(audio => pet!.play(audio), () => undefined);
            break;
          }
          case 'voiceKey': voice.setKey(typeof action.key === 'string' ? action.key : null); break;
          case 'voiceDiscover': await voice.discover(); break;
          case 'voicePreview': {
            if (!pet) throw new Error(t('桌宠模块尚未安装。'));
            pet.play(await voice.preview(t('这个任务已经完成了，来看看结果吧。')));
            break;
          }
          default: throw new Error(t('未知桌面操作'));
        }
        return { ok: true };
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : t('操作失败') }; }
    });
    let old = settings.get();
    settings.onChange(next => {
      // The pet observes SettingsStore itself; calling setVisible here would
      // write settings a second time and can recursively publish the same value.
      if (next.launchAtLogin !== old.launchAtLogin && process.env.POCKYMOE_DESKTOP_E2E !== '1') app.setLoginItemSettings({ openAtLogin: next.launchAtLogin });
      if (next.webOrigin !== old.webOrigin || next.relayOrigin !== old.relayOrigin) {
        for (const w of [...manager.relay]) w.destroy();
        focusedThreads.clear();
        hub.sync({ version: 1, generatedAt: new Date().toISOString(), accountId: 'relay-changed', focusedThreadKey: null, items: [] });
        manager.createMain();
        if (process.env.POCKYMOE_DESKTOP_E2E !== '1') void registerApns(settings, manager);
      }
      old = next; broadcast();
    });
    hub.onSnapshot(broadcast);
    globalShortcut.register(settings.get().quickWindowShortcut, () => manager.toggleQuick());
    installMenu(manager, settings);
    if (!hasConnection(settings.get())) manager.createLocal('relay'); else manager.createMain();
    if (process.env.POCKYMOE_DESKTOP_E2E !== '1') {
      for (const protocol of ['pockymoe', 'remotecodex']) {
        if (app.isPackaged) app.setAsDefaultProtocolClient(protocol);
        else app.setAsDefaultProtocolClient(protocol, process.execPath, [app.getAppPath()]);
      }
    }
    for (const url of [...deepLinks, ...process.argv.filter(a => /^(pockymoe|remotecodex):/.test(a))]) openLink(url);
    if (process.env.POCKYMOE_DESKTOP_E2E !== '1') { configureUpdates(showMessageBox, () => hasConnection(settings.get())); void registerApns(settings, manager); }
    app.on('activate', () => { if (manager.quitting) return; if (manager.relay.size) manager.focusMain(); else manager.createLocal('relay'); });
    app.on('before-quit', () => { manager.quitting = true; messages.dispose(); manager.dispose(); notifications.dispose(); voice.dispose(); pet?.dispose(); tray.dispose(); hub.dispose(); globalShortcut.unregisterAll(); });
    if (process.env.POCKYMOE_DESKTOP_E2E === '1') Object.assign(globalThis, { __pockymoeDesktopTest: { hub, settings, appearance, windows: manager, tray, notifications, capabilities, updater: autoUpdater, showMessageBox, messages } });
  }).catch(error => {
    if (process.env.POCKYMOE_DESKTOP_E2E === '1') console.error(error);
    else dialog.showErrorBox(t('Pockymoe 无法启动'), t('请检查桌面应用的本地配置后重试。'));
    app.quit();
  });
}
