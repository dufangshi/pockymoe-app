import type { ActivityEvent, ActivityItem, ActivitySnapshot } from '../src/shared/contract';
export const item = (patch: Partial<ActivityItem> = {}): ActivityItem => ({
  key: 'mac:thread-1', deviceId: 'mac', deviceName: 'MacBook Pro', workspaceId: 'rc', workspaceLabel: 'remoteCodex',
  threadId: 'thread-1', title: '修复登录状态同步', state: 'running', since: '2026-11-01T06:00:00.000Z', turnId: 'turn-1', unread: false, ...patch
});
export const snapshot = (items: ActivityItem[], patch: Partial<ActivitySnapshot> = {}): ActivitySnapshot => ({
  version: 1, generatedAt: '2026-11-01T06:01:00.000Z', accountId: 'fixture', focusedThreadKey: null, items, ...patch
});
export const event = (patch: Partial<ActivityEvent> = {}): ActivityEvent => ({ type: 'completed', alertId: 'mac:turn-1', item: item({ state: 'completed', unread: true }), at: '2026-11-01T06:01:00.000Z', ...patch });
