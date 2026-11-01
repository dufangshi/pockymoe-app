import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityHub, validateSnapshot } from '../src/main/activity';
import type { ActivityEvent, ActivityItem } from '../src/shared/contract';
import { item, snapshot } from './fixtures';

const start = Date.parse('2026-11-01T18:00:00Z');
const at = (offset = 0): string => new Date(start + offset).toISOString();
const activity = (device: number, index: number, patch: Partial<ActivityItem> = {}): ActivityItem => item({
  deviceId: `device-${device}`, deviceName: `Device ${device}`, threadId: `thread-${index}`, key: `device-${device}:thread-${index}`,
  turnId: `turn-${index}`, since: at(-3600_000), state: index % 2 ? 'failed' : 'completed', unread: true, ...patch
});
describe('per-device connection baselines', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(start); });
  afterEach(() => vi.useRealTimers());
  it('accepts 250 historical items arriving across 11 devices without events', () => {
    const hub = new ActivityHub(), events: ActivityEvent[] = []; hub.onEvent(event => events.push(event));
    const history = Array.from({ length: 250 }, (_, index) => activity(index % 9, index));
    hub.sync(snapshot([], { generatedAt: at(), syncedDeviceIds: ['device-9', 'device-10'] }));
    for (let device = 0; device < 9; device++) {
      vi.advanceTimersByTime(1000);
      hub.sync(snapshot(history.filter(i => Number(i.deviceId.split('-')[1]) <= device), {
        generatedAt: at((device + 1) * 1000), syncedDeviceIds: Array.from({ length: device + 1 }, (_, n) => `device-${n}`).concat(['device-9', 'device-10'])
      }));
    }
    expect(hub.snapshot()?.items).toHaveLength(250);
    expect(events).toEqual([]);
    const fresh = activity(10, 251, { state: 'needsInput', since: at(10_000), request: { id: 'new-request', kind: 'input', summary: 'Which workspace?' } });
    hub.sync(snapshot([...history, fresh], { generatedAt: at(11_000), syncedDeviceIds: Array.from({ length: 11 }, (_, n) => `device-${n}`) }));
    expect(events.map(event => [event.type, event.alertId])).toEqual([['needsInput', 'device-10:new-request']]);
    hub.dispose();
  });
  it('uses first arrival for older pages without syncedDeviceIds and waits for explicit first reads', () => {
    const hub = new ActivityHub(), events: ActivityEvent[] = []; hub.onEvent(event => events.push(event));
    hub.sync(snapshot([activity(0, 0)], { generatedAt: at() }));
    hub.sync(snapshot([activity(0, 0), activity(1, 1)], { generatedAt: at(1000) }));
    expect(events).toEqual([]);
    hub.sync(snapshot([activity(2, 2, { since: at(2000) })], { generatedAt: at(2000), syncedDeviceIds: [] }));
    expect(events).toEqual([]);
    hub.sync(snapshot([activity(2, 2, { since: at(2000) })], { generatedAt: at(3000), syncedDeviceIds: ['device-2'] }));
    expect(events).toEqual([]);
    hub.sync(snapshot([activity(2, 2, { since: at(4000), turnId: 'new-turn' })], { generatedAt: at(4000), syncedDeviceIds: ['device-2'] }));
    expect(events).toMatchObject([{ type: 'completed', alertId: 'device-2:new-turn' }]);
    hub.dispose();
  });
  it('never treats the first item from an older page as news, even with a current timestamp', () => {
    const hub = new ActivityHub(), events: ActivityEvent[] = []; hub.onEvent(event => events.push(event));
    hub.sync(snapshot([activity(0, 0, { since: at() })], { generatedAt: at() }));
    expect(events).toHaveLength(0);
    hub.sync(snapshot([activity(0, 0, { since: at() })], { generatedAt: at(1000) }));
    hub.sync(snapshot([activity(0, 0, { since: at(2000), turnId: 'fresh' })], { generatedAt: at(2000) }));
    expect(events.map(event => event.alertId)).toEqual(['device-0:fresh']); hub.dispose();
  });
  it('keeps delayed unread flags on historical terminal states silent', () => {
    const hub = new ActivityHub(), events: ActivityEvent[] = []; hub.onEvent(event => events.push(event));
    hub.sync(snapshot([], { generatedAt: at(), syncedDeviceIds: ['device-0'] }));
    const history = ['failed', 'completed', 'interrupted'].map((state, index) => activity(0, index, { state: state as ActivityItem['state'], unread: false }));
    hub.sync(snapshot(history, { generatedAt: at(1000), syncedDeviceIds: ['device-0'] }));
    hub.sync(snapshot(history.map(item => ({ ...item, unread: true })), { generatedAt: at(2000), syncedDeviceIds: ['device-0'] }));
    expect(events).toHaveLength(0); hub.dispose();
  });
  it('retains a flapping request for 60 seconds without resolve, acknowledge or repeat events', () => {
    const hub = new ActivityHub(), events: ActivityEvent[] = [], acknowledgements: string[] = [];
    hub.onEvent(event => events.push(event)); hub.onAcknowledge(id => acknowledgements.push(id));
    hub.sync(snapshot([], { generatedAt: at(), syncedDeviceIds: ['device-0'] }));
    const waiting = activity(0, 0, { since: at(1000), state: 'needsInput', request: { id: 'request', kind: 'approval', summary: 'Run checks?' } });
    hub.sync(snapshot([waiting], { generatedAt: at(1000), syncedDeviceIds: ['device-0'] }));
    hub.sync(snapshot([], { generatedAt: at(2000), syncedDeviceIds: [] }));
    vi.advanceTimersByTime(59_999);
    expect(hub.snapshot()?.items).toEqual([expect.objectContaining({ key: waiting.key })]);
    expect(events.map(event => event.type)).toEqual(['needsInput']); expect(acknowledgements).toEqual([]);
    hub.sync(snapshot([waiting], { generatedAt: at(60_000), syncedDeviceIds: ['device-0'] }));
    expect(events.map(event => event.type)).toEqual(['needsInput']);
    hub.sync(snapshot([], { generatedAt: at(60_001), syncedDeviceIds: [] }));
    vi.advanceTimersByTime(60_000);
    expect(hub.snapshot()?.items).toEqual([]);
    expect(events.map(event => event.type)).toEqual(['needsInput', 'resolved']);
    hub.dispose();
  });
  it('resolves explicit state/request changes immediately and resets baselines between accounts', () => {
    const hub = new ActivityHub(), events: ActivityEvent[] = []; hub.onEvent(event => events.push(event));
    hub.sync(snapshot([], { generatedAt: at(), syncedDeviceIds: ['device-0'] }));
    const waiting = activity(0, 0, { since: at(1000), state: 'needsInput', request: { id: 'request', kind: 'approval', summary: '' } });
    hub.sync(snapshot([waiting], { generatedAt: at(1000), syncedDeviceIds: ['device-0'] }));
    hub.sync(snapshot([{ ...waiting, state: 'running', since: at(2000), request: null }], { generatedAt: at(2000), syncedDeviceIds: ['device-0'] }));
    expect(events.map(event => event.type)).toEqual(['needsInput', 'resolved', 'started']);
    events.length = 0;
    hub.sync(snapshot([activity(0, 0)], { accountId: 'another', generatedAt: at(3000), syncedDeviceIds: ['device-0'] }));
    expect(events).toEqual([]); hub.dispose();
  });
  it('validates and projects recent/sync metadata without forwarding extra fields', () => {
    const recent = { key: 'd:t', deviceId: 'd', deviceName: 'Device', workspaceLabel: 'Work', threadId: 't', title: 'Recent', secret: 'discard' };
    const valid = validateSnapshot(snapshot([], { syncedDeviceIds: ['d'], recent: [recent] }));
    expect(valid.syncedDeviceIds).toEqual(['d']); expect(valid.recent).toEqual([{ ...recent, secret: undefined }]);
    expect(() => validateSnapshot(snapshot([], { syncedDeviceIds: ['d', 'd'] }))).toThrow();
    expect(() => validateSnapshot(snapshot([], { recent: Array(6).fill(recent) }))).toThrow();
    expect(() => validateSnapshot(snapshot([], { recent: [{ ...recent, key: 'wrong' }] }))).toThrow();
  });
});
