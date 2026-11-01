import type { ActivityEvent, ActivityHubLike, ActivityItem, ActivityRecent, ActivitySnapshot } from '../shared/contract';
import { readJson, writeJson } from './store';

const states = new Set(['needsInput', 'failed', 'interrupted', 'completed', 'running', 'idle']);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const date = (value: unknown): value is string => text(value, 40) && Number.isFinite(Date.parse(value));
export function validateSnapshot(value: unknown): ActivitySnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid snapshot');
  const s = value as ActivitySnapshot;
  if (s.version !== 1 || !date(s.generatedAt) || !text(s.accountId, 256) || !s.accountId ||
      !(s.focusedThreadKey === null || text(s.focusedThreadKey, 513)) || !Array.isArray(s.items) || s.items.length > 2000) throw new Error('Invalid snapshot');
  const keys = new Set<string>();
  const items = s.items.map((i): ActivityItem => {
    if (!i || typeof i !== 'object' || !text(i.deviceId, 256) || !i.deviceId || !text(i.threadId, 256) || !i.threadId ||
        i.key !== `${i.deviceId}:${i.threadId}` || keys.has(i.key) || !text(i.deviceName, 256) || !text(i.workspaceId, 256) ||
        !text(i.workspaceLabel, 512) || !text(i.title, 512) || !states.has(i.state) || !date(i.since) || typeof i.unread !== 'boolean' ||
        (i.agentName != null && !text(i.agentName, 256)) ||
        (i.rootThreadKey != null && (!text(i.rootThreadKey, 513) || i.rootThreadKey.indexOf(':') <= 0 || i.rootThreadKey.endsWith(':'))) ||
        (i.rootThreadTitle != null && !text(i.rootThreadTitle, 512)) || (i.turnId != null && !text(i.turnId, 256)) ||
        (i.resultSummary != null && !text(i.resultSummary, 140)) ||
        (i.durationMs != null && (!Number.isFinite(i.durationMs) || i.durationMs < 0)) ||
        (i.request != null && (!text(i.request.id, 256) || !i.request.id || !['approval', 'input'].includes(i.request.kind) || !text(i.request.summary, 140)))) throw new Error('Invalid activity item');
    if (i.state === 'needsInput' && !i.request) throw new Error('Missing activity request');
    keys.add(i.key);
    return {
      key: i.key, deviceId: i.deviceId, deviceName: i.deviceName, workspaceId: i.workspaceId,
      workspaceLabel: i.workspaceLabel, threadId: i.threadId, title: i.title, state: i.state,
      rootThreadKey: i.rootThreadKey, rootThreadTitle: i.rootThreadTitle,
      since: i.since, unread: i.unread, agentName: i.agentName, turnId: i.turnId,
      resultSummary: i.resultSummary, durationMs: i.durationMs,
      request: i.request ? { id: i.request.id, kind: i.request.kind, summary: i.request.summary } : null
    };
  });
  let recent: ActivityRecent[] | undefined;
  if (s.recent !== undefined) {
    if (!Array.isArray(s.recent) || s.recent.length > 5) throw new Error('Invalid recent threads');
    const recentKeys = new Set<string>();
    recent = s.recent.map(i => {
      if (!i || !text(i.deviceId, 256) || !i.deviceId || !text(i.threadId, 256) || !i.threadId ||
          i.key !== `${i.deviceId}:${i.threadId}` || recentKeys.has(i.key) || !text(i.deviceName, 256) ||
          !text(i.workspaceLabel, 512) || !text(i.title, 512)) throw new Error('Invalid recent thread');
      recentKeys.add(i.key);
      return { key: i.key, deviceId: i.deviceId, deviceName: i.deviceName, workspaceLabel: i.workspaceLabel, threadId: i.threadId, title: i.title };
    });
  }
  if (s.syncedDeviceIds !== undefined && (!Array.isArray(s.syncedDeviceIds) || s.syncedDeviceIds.length > 2000 ||
      s.syncedDeviceIds.some(id => !text(id, 256) || !id) || new Set(s.syncedDeviceIds).size !== s.syncedDeviceIds.length)) throw new Error('Invalid synced devices');
  return { version: 1, generatedAt: s.generatedAt, accountId: s.accountId, focusedThreadKey: s.focusedThreadKey, items,
    ...(recent ? { recent } : {}), ...(s.syncedDeviceIds ? { syncedDeviceIds: [...s.syncedDeviceIds] } : {}) };
}
export function alertId(item: ActivityItem): string {
  return `${item.deviceId}:${item.state === 'needsInput' && item.request ? item.request.id : item.turnId || `${item.threadId}:${item.since}`}`;
}
export class ActivityHub implements ActivityHubLike {
  private current: ActivitySnapshot | null = null;
  private snapshots = new Set<(s: ActivitySnapshot) => void>();
  private events = new Set<(e: ActivityEvent) => void>();
  private acknowledgements = new Set<(id: string, source: string) => void>();
  private seen = new Map<string, number>();
  private baselines = new Map<string, number>();
  private firstSeen = new Set<string>();
  private missing = new Map<string, number>();
  private announced = new Set<string>();
  private expiry?: ReturnType<typeof setTimeout>;
  constructor(private seenPath?: string, private now = () => Date.now()) {
    const entries = seenPath ? readJson(seenPath) : null;
    if (Array.isArray(entries)) for (const entry of entries) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number' && entry[0].length < 1200) this.seen.set(entry[0], entry[1]);
    }
    this.prune();
  }
  private prune(): void {
    for (const [id, time] of this.seen) if (time < this.now() - 7 * 86400_000) this.seen.delete(id);
    while (this.seen.size > 500) this.seen.delete(this.seen.keys().next().value!);
  }
  snapshot(): ActivitySnapshot | null { return this.current ? structuredClone(this.current) : null; }
  sync(value: unknown): void {
    const next = validateSnapshot(value);
    if (this.current?.accountId === next.accountId && Date.parse(next.generatedAt) < Date.parse(this.current.generatedAt)) return;
    if (this.current?.accountId !== next.accountId) {
      this.baselines.clear(); this.firstSeen.clear(); this.missing.clear(); this.announced.clear(); clearTimeout(this.expiry);
    }
    const previous = new Map((this.current?.accountId === next.accountId ? this.current.items : []).map(i => [i.key, i]));
    // Explicit metadata includes devices with zero items. Without it, wait for
    // a second snapshot containing that device before establishing its baseline.
    const arrived = new Set(next.items.map(item => item.deviceId));
    const synced = next.syncedDeviceIds ?? [...arrived].filter(device => this.firstSeen.has(device));
    for (const device of synced) {
      if (!this.baselines.has(device)) this.baselines.set(device, Date.parse(next.generatedAt));
    }
    for (const device of arrived) this.firstSeen.add(device);
    const incoming = new Set(next.items.map(item => item.key));
    for (const key of incoming) this.missing.delete(key);
    for (const old of previous.values()) if (!incoming.has(old.key)) {
      const absentSince = this.missing.get(old.key) ?? this.now();
      this.missing.set(old.key, absentSince);
      if (this.now() - absentSince < 60_000) next.items.push(old);
      else this.missing.delete(old.key);
    }
    // Bound transient retained state independently of the 2,000-item input cap.
    while (this.missing.size > 2000) {
      const key = this.missing.keys().next().value!;
      this.missing.delete(key); next.items = next.items.filter(item => item.key !== key);
    }
    this.current = next;
    for (const listener of this.snapshots) listener(this.snapshot()!);
    const nextItems = new Map(next.items.map(item => [item.key, item]));
    for (const old of previous.values()) {
      const item = nextItems.get(old.key);
      if (old.state === 'needsInput' && (item?.state !== 'needsInput' || item.request?.id !== old.request?.id)) this.resolve(old, next.generatedAt);
      if (old.unread && (!item || !item.unread)) this.acknowledge(alertId(old), 'main');
    }
    this.prune();
    for (const item of next.items) {
      const old = previous.get(item.key);
      if (item.state === 'idle') continue;
      const baseline = this.baselines.get(item.deviceId);
      if (baseline === undefined || Date.parse(item.since) < baseline) continue;
      // State and unread can arrive on separate updates. A terminal state first
      // seen as read must still announce once its unread flag catches up.
      const newlyUnread = old && !old.unread && item.unread && ['completed', 'failed', 'interrupted'].includes(item.state);
      if (old?.state === item.state && alertId(old) === alertId(item) && !newlyUnread) continue;
      const type = item.state === 'running' ? 'started' : item.state === 'interrupted' ? 'failed' : item.state;
      const event: ActivityEvent = { type, alertId: alertId(item), item, at: next.generatedAt };
      if (type !== 'started') {
        if ((type === 'completed' || type === 'failed') && !item.unread) continue;
        const key = `${next.accountId}:${event.alertId}`;
        if (this.seen.has(key)) continue;
        this.seen.set(key, this.now());
      }
      if (type === 'needsInput') this.announced.add(event.alertId);
      this.emit(event);
    }
    this.prune();
    if (this.seenPath) writeJson(this.seenPath, [...this.seen]);
    this.scheduleExpiry();
  }
  private resolve(item: ActivityItem, at: string): void {
    const id = alertId(item);
    if (this.announced.delete(id)) this.emit({ type: 'resolved', alertId: id, item, at });
  }
  private scheduleExpiry(): void {
    clearTimeout(this.expiry);
    if (!this.missing.size) return;
    const deadline = Math.min(...this.missing.values()) + 60_000;
    this.expiry = setTimeout(() => {
      if (!this.current) return;
      const expired = this.current.items.filter(item => this.missing.has(item.key) && this.now() - this.missing.get(item.key)! >= 60_000);
      const keys = new Set(expired.map(item => item.key));
      this.current.items = this.current.items.filter(item => !keys.has(item.key));
      for (const key of keys) this.missing.delete(key);
      if (expired.length) {
        for (const listener of this.snapshots) listener(this.snapshot()!);
        for (const item of expired) {
          if (item.state === 'needsInput') this.resolve(item, new Date(this.now()).toISOString());
          if (item.unread) this.acknowledge(alertId(item), 'main');
        }
      }
      this.scheduleExpiry();
    }, Math.max(1, deadline - this.now()));
    this.expiry.unref?.();
  }
  dispose(): void { clearTimeout(this.expiry); this.snapshots.clear(); this.events.clear(); this.acknowledgements.clear(); }
  private emit(event: ActivityEvent): void { for (const listener of this.events) listener(structuredClone(event)); }
  onSnapshot(listener: (s: ActivitySnapshot) => void): () => void { this.snapshots.add(listener); return () => this.snapshots.delete(listener); }
  onEvent(listener: (e: ActivityEvent) => void): () => void { this.events.add(listener); return () => this.events.delete(listener); }
  acknowledge(id: string, source: 'notification' | 'pet' | 'tray' | 'main' | 'quick'): void {
    for (const listener of this.acknowledgements) listener(id, source);
  }
  onAcknowledge(listener: (id: string, source: string) => void): () => void { this.acknowledgements.add(listener); return () => this.acknowledgements.delete(listener); }
}
