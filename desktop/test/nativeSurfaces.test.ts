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
import { activityCounts, trayTemplate } from '../src/main/tray';
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

it('counts root conversations and nests tray agents without retargeting actions', () => {
  const root = item({ key: 'mac:root', threadId: 'root', title: '根对话' });
  const a = item({ key: 'mac:a', threadId: 'a', agentName: 'A', rootThreadKey: root.key, rootThreadTitle: root.title, state: 'needsInput', request: { id: 'request-a', kind: 'approval', summary: '允许测试' } });
  const b = { ...a, key: 'mac:b', threadId: 'b', agentName: 'B', request: { ...a.request!, id: 'request-b' } };
  const data = snapshot([root, a, b]);
  expect(activityCounts(data)).toEqual({ attention: 1, running: 1 });
  const open = vi.fn(), reveal = vi.fn();
  const menu = trayTemplate(data, defaults, open, { reveal, map: vi.fn(), pet: vi.fn(), snooze: vi.fn(), main: vi.fn(), settings: vi.fn(), quit: vi.fn() });
  expect(menu[0].label).toBe('需要你 · 1');
  const agents = menu[1].submenu as MenuItemConstructorOptions[];
  expect(agents.map(a => a.label)).toEqual(['智能体 A · MacBook Pro · remoteCodex', '智能体 B · MacBook Pro · remoteCodex']);
  const action = (agents[1].submenu as MenuItemConstructorOptions[])[0].click!;
  action({} as Electron.MenuItem, undefined, {}); expect(open).toHaveBeenCalledWith(b);
});
it('groups native notices by root title while approvals retain actual request IDs', async () => {
  const hub = new ActivityHub(), dispatch = vi.fn().mockResolvedValue({ ok: true });
  const settings = { get: () => ({ ...defaults, alertMode: 'system' }), onChange: () => () => undefined } as unknown as SettingsStore;
  const notifications = new Notifications(hub, settings, { relay: new Set(), dispatch } as unknown as Windows, () => undefined, () => null);
  hub.sync(snapshot([item({ key: 'mac:agent', threadId: 'agent', state: 'needsInput', agentName: 'Planner', rootThreadKey: 'mac:root', rootThreadTitle: '根对话', request: { id: 'own-request', kind: 'approval', summary: '运行测试' } })]));
  vi.advanceTimersByTime(1500);
  expect(notices[0].options).toMatchObject({ id: 'mac:own-request', groupId: 'pockymoe:mac:root', title: '根对话', subtitle: '智能体 Planner · MacBook Pro · remoteCodex' });
  notices[0].emit('action', {}, 0); await Promise.resolve();
  expect(dispatch).toHaveBeenCalledWith({ type: 'resolveRequest', deviceId: 'mac', threadId: 'agent', requestId: 'own-request', decision: 'approve' });
  notifications.dispose();
});
it('counts conversations in a completion burst rather than each agent event', () => {
  const hub = new ActivityHub(), dispatch = vi.fn().mockResolvedValue({ ok: true });
  const settings = { get: () => ({ ...defaults, alertMode: 'system' }), onChange: () => () => undefined } as unknown as SettingsStore;
  const notifications = new Notifications(hub, settings, { relay: new Set(), dispatch } as unknown as Windows, () => undefined, () => null);
  hub.sync(snapshot(['a', 'b', 'c'].map(name => item({ key: `mac:${name}`, threadId: name, turnId: `turn-${name}`, state: 'completed', unread: true, rootThreadKey: 'mac:root', rootThreadTitle: '根对话' }))));
  vi.advanceTimersByTime(1500);
  expect(notices).toHaveLength(1); expect(notices[0].options).toMatchObject({ id: 'mac:turn-a', title: '根对话', groupId: 'pockymoe:mac:root' });
  expect(String(notices[0].options.title)).not.toContain('3'); notifications.dispose();
});
