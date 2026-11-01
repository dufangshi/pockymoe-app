import { t } from '../shared/i18n';
import { app, Menu, nativeImage, nativeTheme, Tray, type MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';
import type { ActivityItem, ActivitySnapshot, Appearance, DesktopSettings } from '../shared/contract';
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
  menuLabels: string[] = [];
  private appearance: Appearance | null = null;
  setAppearance(appearance: Appearance): void { this.appearance = { ...appearance }; this.update(); }
  constructor(private hub: ActivityHub, private settings: SettingsStore, private windows: Windows) {
    this.tray = new Tray(this.icon('none'));
    this.tray.setToolTip('Pockymoe');
    this.tray.on('double-click', () => windows.focusMain());
    hub.onSnapshot(() => this.update()); settings.onChange(() => this.update());
    nativeTheme.on('updated', () => this.update());
    this.update();
  }
  private icon(state: string): Electron.NativeImage {
    const suffix = process.platform === 'win32' ? (this.appearance ? this.appearance.effective === 'dark' : nativeTheme.shouldUseDarkColors) ? '-dark.ico' : '.ico' : 'Template.png';
    const image = nativeImage.createFromPath(join(app.getAppPath(), 'build', `tray-${state}${suffix}`));
    if (process.platform === 'darwin') image.setTemplateImage(true);
    return image;
  }
  setBadge(count: number, style: 'attention' | 'running' | 'none'): void {
    const n = Math.max(0, Math.min(999, Math.trunc(count)));
    if (process.platform === 'darwin') app.dock?.setBadge(n && style !== 'none' ? `${style === 'running' ? '◦' : ''}${n}` : '');
    if (process.platform === 'win32') {
      const icon = n && style !== 'none' ? nativeImage.createFromPath(join(app.getAppPath(), 'build', `overlay-${style}-${n > 9 ? 'many' : n}.png`)) : null;
      for (const w of this.windows.relay) w.setOverlayIcon(icon, n ? `${n} ${style === 'attention' ? t('需要你') : t('进行中')}` : '');
    }
  }
  update(): void {
    const snapshot = this.hub.snapshot(), settings = this.settings.get();
    const { attention, running } = activityCounts(snapshot);
    const state = attention ? 'attention' : running ? 'running' : 'none';
    this.tray.setImage(this.icon(state));
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
      main: () => this.windows.focusMain(), settings: () => this.windows.createLocal('preferences'), quit: () => app.quit()
    });
    this.menuLabels = template.map(i => i.label || '');
    this.tray.setContextMenu(Menu.buildFromTemplate(template));
  }
  dispose(): void { this.tray.destroy(); }
}
