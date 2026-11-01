import { app, Menu, nativeImage, nativeTheme, Tray, type MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';
import type { ActivityItem, ActivitySnapshot, DesktopSettings } from '../shared/contract';
import { alertId, type ActivityHub } from './activity';
import { itemPath } from './notifications';
import type { SettingsStore } from './store';
import type { Windows } from './windows';

export function activityCounts(snapshot: ActivitySnapshot | null): { attention: number; running: number } {
  return { attention: snapshot?.items.filter(i => i.state === 'needsInput' || i.state === 'failed' && i.unread).length || 0,
    running: snapshot?.items.filter(i => i.state === 'running').length || 0 };
}
export function trayTemplate(snapshot: ActivitySnapshot | null, settings: DesktopSettings, open: (i: ActivityItem) => void, actions: { pet: () => void; snooze: () => void; main: () => void; settings: () => void; quit: () => void }): MenuItemConstructorOptions[] {
  const needs = snapshot?.items.filter(i => i.state === 'needsInput' || i.state === 'failed' && i.unread).slice(0, 5) || [];
  const running = snapshot?.items.filter(i => i.state === 'running').slice(0, 5) || [];
  const items: MenuItemConstructorOptions[] = [];
  for (const [title, group] of [['需要你', needs], ['进行中', running]] as const) {
    items.push({ label: `${title} · ${group.length}`, enabled: false });
    for (const item of group) items.push({ label: `${item.title.slice(0, 48)} — ${item.deviceName}`, click: () => open(item) });
  }
  items.push({ type: 'separator' }, { label: '显示桌宠', type: 'checkbox', checked: settings.petVisible, click: actions.pet },
    { label: Date.parse(settings.snoozeUntil || '') > Date.now() ? '恢复提醒' : '暂停提醒 1 小时', click: actions.snooze },
    { type: 'separator' }, { label: '打开 Remote Codex', click: actions.main }, { label: '设置…', click: actions.settings },
    { type: 'separator' }, { label: '退出 Remote Codex', accelerator: 'CommandOrControl+Q', click: actions.quit });
  return items;
}
export class DesktopTray {
  readonly tray: Tray;
  menuLabels: string[] = [];
  constructor(private hub: ActivityHub, private settings: SettingsStore, private windows: Windows) {
    this.tray = new Tray(this.icon('none'));
    this.tray.setToolTip('Remote Codex');
    this.tray.on('double-click', () => windows.focusMain());
    hub.onSnapshot(() => this.update()); settings.onChange(() => this.update());
    nativeTheme.on('updated', () => this.update());
    this.update();
  }
  private icon(state: string): Electron.NativeImage {
    const suffix = process.platform === 'win32' ? nativeTheme.shouldUseDarkColors ? '-dark.ico' : '.ico' : 'Template.png';
    const image = nativeImage.createFromPath(join(app.getAppPath(), 'build', `tray-${state}${suffix}`));
    if (process.platform === 'darwin') image.setTemplateImage(true);
    return image;
  }
  setBadge(count: number, style: 'attention' | 'running' | 'none'): void {
    const n = Math.max(0, Math.min(999, Math.trunc(count)));
    if (process.platform === 'darwin') app.dock?.setBadge(n && style !== 'none' ? `${style === 'running' ? '◦' : ''}${n}` : '');
    if (process.platform === 'win32') {
      const icon = n && style !== 'none' ? nativeImage.createFromPath(join(app.getAppPath(), 'build', `overlay-${style}-${n > 9 ? 'many' : n}.png`)) : null;
      for (const w of this.windows.relay) w.setOverlayIcon(icon, n ? `${n} ${style === 'attention' ? '需要你' : '进行中'}` : '');
    }
  }
  update(): void {
    const snapshot = this.hub.snapshot(), settings = this.settings.get();
    const { attention, running } = activityCounts(snapshot);
    const state = attention ? 'attention' : running ? 'running' : 'none';
    this.tray.setImage(this.icon(state));
    this.tray.setToolTip(`Remote Codex · ${attention} 需要你 · ${running} 进行中`);
    this.setBadge(attention || running, state);
    const template = trayTemplate(snapshot, settings, item => {
      this.hub.acknowledge(alertId(item), 'tray');
      void this.windows.dispatch({ type: 'navigate', path: itemPath(item) }).then(() => this.windows.dispatch({ type: 'markRead', key: item.key }, false));
    }, {
      pet: () => this.settings.set({ petVisible: !settings.petVisible }),
      snooze: () => this.settings.set({ snoozeUntil: Date.parse(settings.snoozeUntil || '') > Date.now() ? null : new Date(Date.now() + 3600_000).toISOString() }),
      main: () => this.windows.focusMain(), settings: () => this.windows.createLocal('preferences'), quit: () => app.quit()
    });
    this.menuLabels = template.map(i => i.label || '');
    this.tray.setContextMenu(Menu.buildFromTemplate(template));
  }
  dispose(): void { this.tray.destroy(); }
}
