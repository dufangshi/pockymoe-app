import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ActivityHub, alertId, validateSnapshot } from '../src/main/activity';
import type { ActivityEvent } from '../src/shared/contract';
import { connected, item, snapshot } from './fixtures';

describe('ActivityHub', () => {
  it('rechecks a terminal state when its timestamp catches up after the status update', () => {
    const hub = connected(new ActivityHub()), events: ActivityEvent[] = []; hub.onEvent(event => events.push(event));
    hub.sync(snapshot([item()]));
    hub.sync(snapshot([item({ state: 'failed', unread: true, since: '2026-11-01T05:00:00.000Z' })]));
    expect(events.map(event => event.type)).toEqual(['started']);
    hub.sync(snapshot([item({ state: 'failed', unread: true, since: '2026-11-01T06:00:10.000Z' })]));
    hub.sync(snapshot([item({ state: 'failed', unread: true, since: '2026-11-01T06:00:10.000Z' })]));
    expect(events.map(event => event.type)).toEqual(['started', 'failed']); hub.dispose();
  });
  it.each(['failed', 'completed', 'interrupted'] as const)('emits fresh %s when unread arrives after the terminal state', state => {
    const hub = connected(new ActivityHub()), events: ActivityEvent[] = []; hub.onEvent(event => events.push(event));
    hub.sync(snapshot([item({ state, unread: false })])); expect(events).toHaveLength(0);
    hub.sync(snapshot([item({ state, unread: true })])); hub.sync(snapshot([item({ state, unread: true })]));
    expect(events.map(event => [event.type, event.alertId])).toEqual([[state === 'completed' ? 'completed' : 'failed', 'mac:turn-1']]);
    hub.dispose();
  });
  it('diffs turns, requests and explicit resolutions without duplicating snapshots', () => {
    const hub = connected(new ActivityHub()), events: ActivityEvent[] = [];
    hub.onEvent(e => events.push(e));
    hub.sync(snapshot([item()])); hub.sync(snapshot([item()]));
    const request = item({ state: 'needsInput', request: { id: 'req-1', kind: 'approval', summary: '运行 cargo test' } });
    hub.sync(snapshot([request])); hub.sync(snapshot([request]));
    hub.sync(snapshot([item({ state: 'completed', unread: true, resultSummary: '已完成' })]));
    hub.sync(snapshot([item({ state: 'running', turnId: 'turn-2' })]));
    hub.sync(snapshot([item({ state: 'failed', turnId: 'turn-2', unread: true })]));
    hub.sync(snapshot([item({ state: 'needsInput', request: { id: 'req-2', kind: 'input', summary: '哪个环境？' } })]));
    hub.sync(snapshot([item({ state: 'idle' })]));
    expect(events.map(e => [e.type, e.alertId])).toEqual([
      ['started', 'mac:turn-1'], ['needsInput', 'mac:req-1'], ['resolved', 'mac:req-1'],
      ['completed', 'mac:turn-1'], ['started', 'mac:turn-2'], ['failed', 'mac:turn-2'], ['needsInput', 'mac:req-2'], ['resolved', 'mac:req-2']
    ]);
  });
  it('projects interrupted into the failed event lifecycle', () => {
    const hub = connected(new ActivityHub()), events: ActivityEvent[] = []; hub.onEvent(e => events.push(e));
    hub.sync(snapshot([item({ state: 'interrupted', unread: true })]));
    expect(events[0]).toMatchObject({ type: 'failed', item: { state: 'interrupted' } });
  });
  it('persists alert deduplication across restarts and expires after seven days', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-alerts-'));
    try {
      const path = join(dir, 'seen.json'), now = Date.now();
      connected(new ActivityHub(path, () => now)).sync(snapshot([item({ state: 'completed', unread: true })]));
      const restart = connected(new ActivityHub(path, () => now + 60_000)), events: ActivityEvent[] = [];
      restart.onEvent(e => events.push(e)); restart.sync(snapshot([item({ state: 'completed', unread: true })]));
      expect(events).toHaveLength(0);
      const expired = connected(new ActivityHub(path, () => now + 8 * 86400_000));
      expired.onEvent(e => events.push(e)); expired.sync(snapshot([item({ state: 'completed', unread: true })]));
      expect(events.map(e => e.alertId)).toEqual(['mac:turn-1']);
    } finally { rmSync(dir, { recursive: true }); }
  });
  it('bounds dedupe history to 500 ids and namespaces accounts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-bounded-'));
    try {
      const path = join(dir, 'seen.json');
      const many = Array.from({ length: 501 }, (_, i) => item({ key: `mac:t${i}`, threadId: `t${i}`, turnId: `turn${i}`, state: 'completed', unread: true }));
      connected(new ActivityHub(path)).sync(snapshot(many));
      const restarted = connected(new ActivityHub(path)), events: ActivityEvent[] = [];
      restarted.onEvent(e => events.push(e)); restarted.sync(snapshot(many));
      expect(events.map(e => e.alertId)).toEqual(['mac:turn0']);
      restarted.sync(snapshot([], { accountId: 'another', generatedAt: '2026-11-01T05:59:00.000Z', syncedDeviceIds: ['mac'] }));
      restarted.sync(snapshot([many[1]], { accountId: 'another' }));
      expect(events.at(-1)?.alertId).toBe('mac:turn1');
    } finally { rmSync(dir, { recursive: true }); }
  });
  it('acknowledges read state and does not leak mutable snapshots', () => {
    const hub = new ActivityHub(), seen: string[] = [];
    hub.onAcknowledge(id => seen.push(id));
    hub.sync(snapshot([item({ state: 'completed', unread: true })]));
    hub.snapshot()!.items[0].title = 'mutated';
    expect(hub.snapshot()!.items[0].title).not.toBe('mutated');
    hub.sync(snapshot([item({ state: 'completed', unread: false })]));
    expect(seen).toEqual(['mac:turn-1']);
  });
  it('rejects malformed or oversized snapshots atomically and ignores stale updates', () => {
    const hub = new ActivityHub(); hub.sync(snapshot([item()]));
    expect(() => hub.sync(snapshot([item({ resultSummary: 'x'.repeat(141) })]))).toThrow();
    expect(() => validateSnapshot(snapshot(Array(2001).fill(item())))).toThrow();
    expect(() => validateSnapshot(snapshot([item(), item()]))).toThrow();
    expect(() => validateSnapshot(snapshot([item({ state: 'needsInput' })]))).toThrow();
    hub.sync(snapshot([], { generatedAt: '2026-11-01T05:00:00.000Z' }));
    expect(hub.snapshot()!.items).toHaveLength(1);
  });
  it('uses stable request/turn ids and stable state-time fallback for old relays', () => {
    expect(alertId(item({ state: 'needsInput', request: { id: 'req', kind: 'input', summary: '' } }))).toBe('mac:req');
    expect(alertId(item())).toBe('mac:turn-1');
    expect(alertId(item({ turnId: null }))).toBe('mac:thread-1:2026-11-01T06:00:00.000Z');
  });
});
