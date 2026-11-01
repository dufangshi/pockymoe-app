import { EventEmitter } from 'node:events';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ActivityHub } from '../src/main/activity';
import { defaults } from '../src/main/store';
import { item, snapshot } from './fixtures';
import type { Windows } from '../src/main/windows';
import type { SettingsStore } from '../src/main/store';
import type { MenuItemConstructorOptions } from 'electron';
const notices: { options: Record<string, unknown>; emit: (event: string, ...args: unknown[]) => boolean }[] = [];
vi.mock('electron', () => ({
  app: {}, Menu: {}, nativeImage: {}, nativeTheme: {}, Tray: class {},
  powerMonitor: { getSystemIdleTime: () => 0 },
  Notification: class extends EventEmitter {
    id: string;
    static isSupported = () => true;
    static remove = () => undefined;
    constructor(options: Record<string, unknown>) { super(); this.id = options.id as string; notices.push({ options, emit: this.emit.bind(this) }); }
    show(): void {}
    close(): void { this.emit('close'); }
  }
}));
import { Notifications } from '../src/main/notifications';
import { trayTemplate } from '../src/main/tray';
beforeEach(() => { vi.useFakeTimers(); notices.length = 0; });
afterEach(() => vi.useRealTimers());
it('uses stable native IDs, includes map actions and labels interruptions', async () => {
  const hub = new ActivityHub(), dispatch = vi.fn().mockResolvedValue({ ok: true });
  const settings = { get: () => ({ ...defaults, alertMode: 'system' }), onChange: () => () => undefined } as unknown as SettingsStore;
  const windows = { relay: new Set(), dispatch } as unknown as Windows;
  const notifications = new Notifications(hub, settings, windows, () => undefined, () => null);
  hub.sync(snapshot([item({ state: 'interrupted', unread: true, resultSummary: '设备已断开' })])); vi.advanceTimersByTime(1500);
  expect(notices[0].options).toMatchObject({ id: 'mac:turn-1', body: '已中断 · 设备已断开' });
  if (['darwin', 'win32'].includes(process.platform)) {
    expect(notices[0].options.actions).toEqual([{ type: 'button', text: '在地图中显示' }]);
    notices[0].emit('action', {}, 0);
    expect(dispatch).toHaveBeenCalledWith({ type: 'revealInMap', key: 'mac:thread-1' });
  }
  notifications.dispose();
});
it('adds open/reveal submenus for tray items and an open-map entry', () => {
  const open = vi.fn(), reveal = vi.fn(), map = vi.fn();
  const template = trayTemplate(snapshot([item({ state: 'interrupted', unread: true })]), defaults, open, { reveal, map, pet: vi.fn(), snooze: vi.fn(), main: vi.fn(), settings: vi.fn(), quit: vi.fn() });
  expect(template.map(i => i.label)).toContain('打开地图');
  const row = template.find(i => i.label?.startsWith('修复登录'))!;
  const submenu = row.submenu as MenuItemConstructorOptions[];
  expect(submenu.map(i => i.label)).toEqual(['打开线程', '在地图中显示']);
});
