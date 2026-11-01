import type { ActivityEvent, ActivityHubLike, ActivityItem, ActivitySnapshot } from '../shared/contract';
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
  return { version: 1, generatedAt: s.generatedAt, accountId: s.accountId, focusedThreadKey: s.focusedThreadKey, items };
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
    const previous = new Map((this.current?.accountId === next.accountId ? this.current.items : []).map(i => [i.key, i]));
    this.current = next;
    for (const listener of this.snapshots) listener(this.snapshot()!);
    for (const old of previous.values()) {
      const item = next.items.find(i => i.key === old.key);
      if (old.state === 'needsInput' && (item?.state !== 'needsInput' || item.request?.id !== old.request?.id)) this.emit({ type: 'resolved', alertId: alertId(old), item: old, at: next.generatedAt });
      if (old.unread && (!item || !item.unread)) this.acknowledge(alertId(old), 'main');
    }
    this.prune();
    for (const item of next.items) {
      const old = previous.get(item.key);
      if (item.state === 'idle') continue;
      if (old?.state === item.state && alertId(old) === alertId(item)) continue;
      const type = item.state === 'running' ? 'started' : item.state === 'interrupted' ? 'failed' : item.state;
      const event: ActivityEvent = { type, alertId: alertId(item), item, at: next.generatedAt };
      if (type !== 'started') {
        if ((type === 'completed' || type === 'failed') && !item.unread) continue;
        const key = `${next.accountId}:${event.alertId}`;
        if (this.seen.has(key)) continue;
        this.seen.set(key, this.now());
      }
      this.emit(event);
    }
    this.prune();
    if (this.seenPath) writeJson(this.seenPath, [...this.seen]);
  }
  private emit(event: ActivityEvent): void { for (const listener of this.events) listener(structuredClone(event)); }
  onSnapshot(listener: (s: ActivitySnapshot) => void): () => void { this.snapshots.add(listener); return () => this.snapshots.delete(listener); }
  onEvent(listener: (e: ActivityEvent) => void): () => void { this.events.add(listener); return () => this.events.delete(listener); }
  acknowledge(id: string, source: 'notification' | 'pet' | 'tray' | 'main' | 'quick'): void {
    for (const listener of this.acknowledgements) listener(id, source);
  }
  onAcknowledge(listener: (id: string, source: string) => void): () => void { this.acknowledgements.add(listener); return () => this.acknowledgements.delete(listener); }
}
