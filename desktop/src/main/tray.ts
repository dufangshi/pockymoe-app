import { t } from '../shared/i18n';
import { app, Menu, nativeImage, nativeTheme, Tray, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';
import type { ActivityItem, ActivitySnapshot, Appearance, DesktopSettings, UpdateState } from '../shared/contract';
import { activitySecondary, conversationKey, groupActivities } from '../shared/activityGroups';
import { alertId, type ActivityHub } from './activity';
import { itemPath } from './notifications';
import type { SettingsStore } from './store';
import type { Windows } from './windows';

export function activityCounts(snapshot: ActivitySnapshot | null): { attention: number; running: number } {
  return { attention: new Set(snapshot?.items.filter(i => i.state === 'needsInput' || ['failed', 'interrupted'].includes(i.state) && i.unread).map(conversationKey)).size,
    running: new Set(snapshot?.items.filter(i => i.state === 'running').map(conversationKey)).size };
}
export function taskbarBadge(snapshot: ActivitySnapshot | null): { count: number; style: 'attention' | 'running' | 'none' } {
  const waiting = new Set(snapshot?.items.filter(item => item.state === 'needsInput').map(conversationKey)).size;
  const running = new Set(snapshot?.items.filter(item => item.state === 'running').map(conversationKey)).size;
  return { count: waiting || running, style: waiting ? 'attention' : running ? 'running' : 'none' };
}
export function trayTemplate(snapshot: ActivitySnapshot | null, settings: DesktopSettings, open: (i: ActivityItem) => void, actions: { pet: () => void; snooze: () => void; main: () => void; settings: () => void; quit: () => void; map: () => void; reveal: (item: ActivityItem) => void }): MenuItemConstructorOptions[] {
  const all = snapshot?.items || [];
  const needs = groupActivities(all.filter(i => i.state === 'needsInput' || ['failed', 'interrupted'].includes(i.state) && i.unread), all);
  const running = groupActivities(all.filter(i => i.state === 'running'), all);
  const items: MenuItemConstructorOptions[] = [];
  for (const [title, group] of [[t('需要你'), needs], [t('进行中'), running]] as const) {
    items.push({ label: `${title} · ${group.length}`, enabled: false });
    for (const conversation of group.slice(0, 5)) {
      const menuFor = (item: ActivityItem): MenuItemConstructorOptions[] => [{ label: t('打开线程'), click: () => open(item) }, { label: t('在地图中显示'), click: () => actions.reveal(item) }];
      const first = conversation.items[0];
      const rootOnly = conversation.items.length === 1 && first.key === conversation.key;
      items.push({ label: `${conversation.title.slice(0, 48)} — ${first.deviceName}`, submenu: rootOnly ? menuFor(first) : conversation.items.map(item => ({ label: activitySecondary(item), submenu: menuFor(item) })) });
    }
  }
  items.push({ type: 'separator' }, { label: t('显示桌宠'), type: 'checkbox', checked: settings.petVisible, click: actions.pet },
    { label: Date.parse(settings.snoozeUntil || '') > Date.now() ? t('恢复提醒') : t('暂停提醒 1 小时'), click: actions.snooze },
    { type: 'separator' }, { label: t('打开地图'), click: actions.map }, { label: t('打开 Pockymoe'), click: actions.main }, { label: t('设置…'), click: actions.settings },
    { type: 'separator' }, { label: t('退出 Pockymoe'), accelerator: 'CommandOrControl+Q', click: actions.quit });
  return items;
}
export class DesktopTray {
  readonly tray: Tray;
  private disposed = false;
  private pendingWindows = new Map<BrowserWindow, () => void>();
  private unsubscribers: (() => void)[] = [];
  private themeUpdated = (): void => this.update();
  private windowCreated = (_event: Electron.Event, window: BrowserWindow): void => {
    if (this.disposed || this.windows.quitting) return;
    const ready = (): void => { this.pendingWindows.delete(window); this.update(); };
    this.pendingWindows.set(window, ready); window.once('ready-to-show', ready);
    window.once('closed', () => this.pendingWindows.delete(window));
  };
  private updaterState?: () => UpdateState;
  private installUpdate?: () => void;
  setUpdates(state: () => UpdateState, install: () => void): void { this.updaterState = state; this.installUpdate = install; this.update(); }
  menuLabels: string[] = [];
  private appearance: Appearance | null = null;
  setAppearance(appearance: Appearance): void { this.appearance = { ...appearance }; this.update(); }
  constructor(private hub: ActivityHub, private settings: SettingsStore, private windows: Windows) {
    this.tray = new Tray(this.icon('none'));
    this.tray.setToolTip('Pockymoe');
    if (process.platform === 'win32') app.on('browser-window-created', this.windowCreated);
    if (process.platform === 'win32') this.tray.on('click', () => this.tray.popUpContextMenu());
    if (process.platform !== 'win32') this.tray.on('double-click', () => { if (!windows.closingForUpdate) windows.focusMain(); });
    this.unsubscribers = [hub.onSnapshot(() => this.update()), settings.onChange(() => this.update())];
    nativeTheme.on('updated', this.themeUpdated);
    this.update();
  }
  private icon(state: string): Electron.NativeImage {
    const suffix = process.platform === 'win32' ? nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ? '-dark.ico' : '.ico' : 'Template.png';
    const image = nativeImage.createFromPath(join(app.getAppPath(), 'build', `tray-${state}${suffix}`));
    if (process.platform === 'darwin') image.setTemplateImage(true);
    return image;
  }
  private live(): boolean { return !this.disposed && !this.windows.quitting && !this.tray.isDestroyed(); }
  setBadge(count: number, style: 'attention' | 'running' | 'none'): void {
    if (!this.live()) return;
    const n = Math.max(0, Math.min(999, Math.trunc(count)));
    if (process.platform === 'darwin') app.dock?.setBadge(n && style !== 'none' ? `${style === 'running' ? '◦' : ''}${n}` : '');
    if (process.platform === 'win32') {
      const icon = n && style === 'attention' ? nativeImage.createFromPath(join(app.getAppPath(), 'build', `overlay-${style}-${n > 9 ? 'many' : n}.png`)) : null;
      for (const w of this.windows.relay) {
        if (!this.live()) return;
        if (!w.isDestroyed()) w.setOverlayIcon(icon, icon ? `${n} ${t('需要你')}` : '');
      }
    }
  }
  update(): void {
    if (!this.live()) return;
    try { this.updateState(); }
    catch (error) {
      // Native calls may pump ready/quit callbacks while an update is in flight.
      if (!this.live() && error instanceof Error && error.message === 'Object has been destroyed') return;
      throw error;
    }
  }
  private updateState(): void {
    const snapshot = this.hub.snapshot(), settings = this.settings.get();
    const { attention, running } = activityCounts(snapshot);
    const state = attention ? 'attention' : running ? 'running' : 'none';
    const image = this.icon(state);
    if (!this.live()) return;
    this.tray.setImage(image);
    if (!this.live()) return;
    this.tray.setToolTip(`Pockymoe · ${t('{count} 需要你', { count: attention })} · ${t('{count} 进行中', { count: running })}`);
    const badge = taskbarBadge(snapshot);
    this.setBadge(badge.count, badge.style);
    const template = trayTemplate(snapshot, settings, item => {
      this.hub.acknowledge(alertId(item), 'tray');
      void this.windows.dispatch({ type: 'navigate', path: itemPath(item) }).then(() => this.windows.dispatch({ type: 'markRead', key: item.key }, false));
    }, {
      pet: () => this.settings.set({ petVisible: !settings.petVisible }),
      snooze: () => this.settings.set({ snoozeUntil: Date.parse(settings.snoozeUntil || '') > Date.now() ? null : new Date(Date.now() + 3600_000).toISOString() }),
      map: () => { void this.windows.dispatch({ type: 'openMap' }); },
      reveal: item => { void this.windows.dispatch({ type: 'revealInMap', key: item.key }); },
      main: () => { if (!this.windows.closingForUpdate) this.windows.focusMain(); }, settings: () => { if (!this.windows.closingForUpdate) this.windows.createLocal('preferences'); }, quit: () => app.quit()
    });
    const update = this.updaterState?.();
    if (update?.version && ['ready', 'error'].includes(update.status)) template.splice(template.length - 2, 0, { label: t('重启以更新到 {version}', { version: update.version }), enabled: update.retryAllowed !== false, click: () => this.installUpdate?.() });
    this.menuLabels = template.map(i => i.label || '');
    const menu = Menu.buildFromTemplate(template);
    if (this.live()) this.tray.setContextMenu(menu);
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    app.removeListener('browser-window-created', this.windowCreated);
    for (const [window, ready] of this.pendingWindows) window.removeListener('ready-to-show', ready);
    this.pendingWindows.clear();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    nativeTheme.removeListener('updated', this.themeUpdated); if (!this.tray.isDestroyed()) this.tray.destroy();
  }
}
