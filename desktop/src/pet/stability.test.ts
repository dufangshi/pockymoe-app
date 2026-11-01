import { describe, expect, it } from 'vitest';
import type { ActivityItem, ActivitySnapshot } from '../shared/contract';
import { StableMood, withoutResolvedRequest } from './stability';
import { ActivityHub } from '../main/activity';
import { deliveryPolicy } from '../main/delivery';
import { defaults } from '../main/store';
const item = (state: ActivityItem['state'], id = 'a', since = 0): ActivityItem => ({ key: `d:${id}`, threadId: id, deviceId: 'd', deviceName: 'Mac', workspaceId: 'w', workspaceLabel: 'Workspace', title: id, state, since: new Date(since).toISOString(), unread: true });
const snapshot = (items: ActivityItem[], at = 1000): ActivitySnapshot => ({ version: 1, generatedAt: new Date(at).toISOString(), accountId: 'a', focusedThreadKey: null, items, syncedDeviceIds: ['d'] });
describe('v3 stability under sparse multi-device history', () => {
  it('keeps historical failures and unread completions out of the pose for the full login minute', () => {
    const history = Array.from({ length: 250 }, (_, i) => item(i % 2 ? 'failed' : 'completed', String(i)));
    const mood = new StableMood(0); const poses = new Set();
    for (let at = 0; at <= 60000; at += 100) poses.add(mood.value(history, at));
    expect([...poses]).toEqual(['idle']);
  });
  it('dwells for 2 seconds and uses failures only as one-shot reactions', () => {
    const mood = new StableMood(0);
    expect(mood.value([item('running')], 1999)).toBe('idle'); expect(mood.value([item('running')], 2000)).toBe('running');
    expect(mood.value([item('needsInput')], 3999)).toBe('running'); expect(mood.value([item('needsInput')], 4000)).toBe('waiting');
    expect(mood.value([], 6000)).toBe('idle'); mood.react('failed', 6000);
    expect(mood.value([item('failed')], 7999)).toBe('failed'); expect(mood.value([item('failed')], 8000)).toBe('idle');
  });
  it('retains transient losses for 60 seconds without hiding newer explicit states', () => {
    let now = 0; const hub = new ActivityHub(undefined, () => now);
    try {
      hub.sync(snapshot([item('running')])); now = 1000; hub.sync(snapshot([]));
      expect(hub.snapshot()?.items[0].state).toBe('running'); now = 60999; hub.sync(snapshot([])); expect(hub.snapshot()?.items).toHaveLength(1);
      now = 61000; hub.sync(snapshot([])); expect(hub.snapshot()?.items).toHaveLength(0);
      hub.sync(snapshot([item('running')])); hub.sync(snapshot([item('completed')])); expect(hub.snapshot()?.items[0].state).toBe('completed');
      hub.sync({ ...snapshot([]), accountId: 'other' }); expect(hub.snapshot()?.items).toEqual([]);
    } finally { hub.dispose(); }
  });
  it('preserves a resumed running item when the old request resolves after its snapshot', () => {
    const waiting = { ...item('needsInput'), request: { id: 'request-a', kind: 'approval' as const, summary: 'Run tests?' } };
    const running = { ...waiting, state: 'running' as const, request: null };
    expect(withoutResolvedRequest([running], waiting)).toEqual([running]);
    const newer = { ...waiting, request: { ...waiting.request, id: 'request-b' } };
    expect(withoutResolvedRequest([waiting, newer], waiting)).toEqual([newer]);
  });
  it.each(['completed', 'failed'] as const)('plays a fresh %s reaction over historical waiting, then returns to waiting', type => {
    const mood = new StableMood(0), waiting = [item('needsInput')];
    expect(mood.value(waiting, 2000)).toBe('waiting'); mood.onEvent(type, 2100, true, 'waving', 700);
    expect(mood.value(waiting, 2101)).toBe(type === 'completed' ? 'waving' : 'failed');
    expect(mood.value(waiting, type === 'completed' ? 2800 : 4100)).toBe('waiting');
  });
  it.each(['waving', 'jumping'] as const)('a fresh input request preempts a %s celebration', reaction => {
    const mood = new StableMood(0), waiting = [item('needsInput')]; mood.value(waiting, 2000);
    mood.onEvent('completed', 2100, true, reaction, 2000); expect(mood.value(waiting, 2200)).toBe(reaction);
    mood.onEvent('needsInput', 2300, true); expect(mood.value(waiting, 2300)).toBe('waiting');
  });
  it.each(['system', 'focused', 'snoozed', 'hidden'] as const)('keeps reactions silent when pet delivery is %s', reason => {
    const mood = new StableMood(0), waiting = [item('needsInput')]; mood.value(waiting, 2000);
    for (const type of ['completed', 'failed'] as const) {
      const event = { type, alertId: 'd:fresh', item: item(type), at: new Date(2100).toISOString() };
      const policy = deliveryPolicy(event, { settings: { ...defaults, ...(reason === 'system' ? { alertMode: 'system' as const } : {}), snoozeUntil: reason === 'snoozed' ? new Date(10000).toISOString() : null }, focused: reason === 'focused', focusedThreadKey: reason === 'focused' ? event.item.key : null, petVisible: reason !== 'hidden', idleSeconds: 0, now: 2100 });
      mood.onEvent(type, 2100, policy.pet); expect(mood.value(waiting, 2101)).toBe('waiting');
    }
  });
});
