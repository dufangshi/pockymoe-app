// Per-device lists (workspaces, threads) and the device's live socket. One socket per
// device feeds both the lists and every open thread (threadDetail.ts). The socket owns
// its retries: capped, jittered backoff that resets after it stays up; foreground and
// network changes probe it instead of opening a second one.
import { AppState } from 'react-native';
import type { ThreadDto, ThreadEventEnvelope, WorkspaceDto } from '@pockymoe/shared';
import { DeviceSocket } from '../protocol/transport';
import { deviceApi, findDevice, setDirectOnline } from '../connection/devices';
import { createStore } from './store';
import { isConnectionError } from '../protocol/api';

export type LiveState = 'connecting' | 'open' | 'retrying' | 'offline' | 'blocked';
export interface DeviceData {
  workspaces: WorkspaceDto[];
  threads: ThreadDto[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  /** The device answered but refused (unlock, protection, permission). */
  blocked: string | null;
  loadedAt: number;
  live: LiveState;
  /** Threads with an open approval or question, from socket events and loaded details. */
  waiting: Record<string, number>;
}
const empty = (): DeviceData => ({ workspaces: [], threads: [], status: 'idle', error: null, blocked: null, loadedAt: 0, live: 'connecting', waiting: {} });
export const deviceDataStore = createStore<Record<string, DeviceData>>({});
export const useDeviceData = (key: string | null) => deviceDataStore.useValue(s => (key ? s[key] : undefined) ?? EMPTY);
const EMPTY = empty();

function patch(key: string, update: Partial<DeviceData> | ((d: DeviceData) => Partial<DeviceData>)) {
  deviceDataStore.set(s => {
    const current = s[key] ?? empty();
    const next = typeof update === 'function' ? update(current) : update;
    return { [key]: { ...current, ...next } };
  });
}

type EventListener = (event: ThreadEventEnvelope) => void;
const eventListeners = new Map<string, Set<EventListener>>();
const globalListeners = new Set<(deviceKey: string, event: ThreadEventEnvelope) => void>();
/** Thread events of every device (notifications). */
export function onAnyDeviceEvent(listener: (deviceKey: string, event: ThreadEventEnvelope) => void) { globalListeners.add(listener); return () => { globalListeners.delete(listener); }; }
/** Thread events of one device, for open thread views. */
export function onDeviceEvent(key: string, listener: EventListener) {
  let set = eventListeners.get(key); if (!set) eventListeners.set(key, set = new Set());
  set.add(listener); return () => { set!.delete(listener); };
}

export async function loadDeviceLists(key: string) {
  const device = findDevice(key);
  if (!device) return;
  const api = deviceApi(device);
  patch(key, d => ({ status: d.loadedAt ? d.status : 'loading', error: null }));
  try {
    const [workspaces, threads] = await Promise.all([api.workspaces(), api.threads(true)]);
    patch(key, { workspaces, threads, status: 'ready', error: null, blocked: null, loadedAt: Date.now() });
    void seedWaiting(key, api, threads);
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    const code = (error as { code?: string }).code;
    const blocked = !isConnectionError(error) && code ? code : null;
    patch(key, d => ({ status: d.loadedAt ? 'ready' : 'error', error: message, blocked }));
  }
}

/**
 * Requests reach the list as socket events, so after a cold start a running thread that
 * already waits for an answer would show as only running. Like the Web's request recovery,
 * read the pending requests of running threads once per revision, a few at a time.
 */
const seededRevision = new Map<string, string>();
async function seedWaiting(key: string, api: ReturnType<typeof deviceApi>, threads: ThreadDto[]) {
  const pending = threads.filter(t => !t.closedAt && (t.status === 'running' || !!t.activeTurnId) && seededRevision.get(`${key}:${t.id}`) !== t.updatedAt);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
    while (cursor < pending.length) {
      const thread = pending[cursor++]!;
      try {
        const detail = await api.threadDetail(thread.id, { limit: 1 });
        setWaiting(key, thread.id, detail.pendingRequests.length);
        seededRevision.set(`${key}:${thread.id}`, thread.updatedAt);
      } catch { /* the socket or the thread view fills it in later */ }
    }
  }));
}

export function upsertThread(key: string, thread: Partial<ThreadDto> & { id: string }) {
  patch(key, d => {
    const index = d.threads.findIndex(t => t.id === thread.id);
    if (index < 0) return 'workspaceId' in thread ? { threads: [thread as ThreadDto, ...d.threads] } : {};
    const threads = d.threads.slice(); threads[index] = { ...threads[index]!, ...thread };
    return { threads };
  });
}
export function removeThread(key: string, threadId: string) { patch(key, d => ({ threads: d.threads.filter(t => t.id !== threadId) })); }
export function setWaiting(key: string, threadId: string, count: number) {
  patch(key, d => (d.waiting[threadId] ?? 0) === count ? {} : { waiting: { ...d.waiting, [threadId]: count } });
}

function applyToList(key: string, event: ThreadEventEnvelope) {
  const now = event.timestamp;
  switch (event.type) {
    case 'thread.turn.started': upsertThread(key, { id: event.threadId, status: 'running', activeTurnId: event.payload.turnId, lastTurnStartedAt: now, updatedAt: now }); break;
    case 'thread.turn.completed': {
      const status = event.payload.status === 'failed' ? 'failed' : event.payload.status === 'interrupted' ? 'interrupted' : 'idle';
      upsertThread(key, { id: event.threadId, status, activeTurnId: null, lastTurnCompletedAt: now, updatedAt: now, lastError: event.payload.error });
      break;
    }
    case 'thread.turn.failed': if (!event.payload.willRetry) upsertThread(key, { id: event.threadId, status: 'failed', lastError: event.payload.error }); break;
    case 'thread.updated': {
      const p = event.payload;
      upsertThread(key, { id: event.threadId, ...(p.title ? { title: p.title } : {}), ...(p.status ? { status: p.status as ThreadDto['status'] } : {}),
        ...(p.model !== undefined ? { model: p.model } : {}), ...(p.reasoningEffort !== undefined ? { reasoningEffort: p.reasoningEffort } : {}), updatedAt: now });
      break;
    }
    case 'thread.request.created': patch(key, d => ({ waiting: { ...d.waiting, [event.threadId]: (d.waiting[event.threadId] ?? 0) + 1 } })); break;
    case 'thread.request.resolved': patch(key, d => ({ waiting: { ...d.waiting, [event.threadId]: Math.max(0, (d.waiting[event.threadId] ?? 1) - 1) } })); break;
    case 'thread.context.updated': upsertThread(key, { id: event.threadId, contextUsage: event.payload.contextUsage }); break;
    default: break;
  }
}

// ---- sockets --------------------------------------------------------------------------
interface Live { socket: DeviceSocket | null; attempt: number; timer: ReturnType<typeof setTimeout> | null; users: number; openedAt: number; listRefresh: ReturnType<typeof setTimeout> | null }
const lives = new Map<string, Live>();

function connect(key: string) {
  const live = lives.get(key); const device = findDevice(key);
  if (!live || !device || live.users <= 0) return;
  live.socket?.close();
  patch(key, { live: live.attempt ? 'retrying' : 'connecting' });
  const socket = new DeviceSocket(device.target);
  live.socket = socket;
  socket.on('open', () => {
    live.openedAt = Date.now();
    patch(key, { live: 'open' });
    if (key.startsWith('direct:')) setDirectOnline(key, true);
    // Events missed while away: refresh the lists once.
    if (live.attempt) void loadDeviceLists(key);
  });
  socket.on('message', ({ data }) => {
    if (!data) return;
    let event: ThreadEventEnvelope;
    try { event = JSON.parse(data) as ThreadEventEnvelope; } catch { return; }
    if (!event?.type?.startsWith('thread.')) return;
    // There is no "thread created" event: a thread started on the Web, the CLI or by a
    // delegate first shows up as events for an id the list lacks. Read the lists once then.
    if (event.threadId && !deviceDataStore.get()[key]?.threads.some(t => t.id === event.threadId) && !live.listRefresh) {
      live.listRefresh = setTimeout(() => { live.listRefresh = null; void loadDeviceLists(key); }, 800);
    }
    applyToList(key, event);
    eventListeners.get(key)?.forEach(listener => listener(event));
    globalListeners.forEach(listener => listener(key, event));
  });
  socket.on('close', ({ code }) => {
    if (live.socket !== socket) return;
    live.socket = null;
    if (live.users <= 0) return;
    // A connection that stayed up resets the backoff.
    if (Date.now() - live.openedAt > 30_000) live.attempt = 0;
    live.attempt++;
    const blocked = code === 4401;
    patch(key, { live: blocked ? 'blocked' : live.attempt > 3 ? 'offline' : 'retrying' });
    if (key.startsWith('direct:') && !blocked && live.attempt > 3) setDirectOnline(key, false);
    const delay = Math.min(30_000, 800 * 2 ** Math.min(live.attempt - 1, 6)) * (0.75 + Math.random() * 0.5);
    live.timer = setTimeout(() => { live.timer = null; connect(key); }, delay);
  });
}

/** Keeps the device's socket open while at least one screen uses it. */
export function retainDevice(key: string) {
  let live = lives.get(key);
  if (!live) lives.set(key, live = { socket: null, attempt: 0, timer: null, users: 0, openedAt: 0, listRefresh: null });
  live.users++;
  if (live.users === 1) { connect(key); if (!deviceDataStore.get()[key]?.loadedAt) void loadDeviceLists(key); }
  return () => {
    live!.users--;
    if (live!.users > 0) return;
    // Short grace period: back navigation and remounts keep the socket.
    setTimeout(() => {
      if (live!.users > 0) return;
      if (live!.timer) clearTimeout(live!.timer);
      if (live!.listRefresh) clearTimeout(live!.listRefresh);
      live!.socket?.close(); live!.socket = null; lives.delete(key);
    }, 15_000);
  };
}
/** Reconnect now (pull to refresh, Retry, foreground). */
export function wakeDevice(key: string) {
  const live = lives.get(key);
  void loadDeviceLists(key);
  if (!live) return;
  if (live.socket && live.socket.readyState === DeviceSocket.OPEN) return;
  if (live.timer) { clearTimeout(live.timer); live.timer = null; }
  live.attempt = 0; connect(key);
}
export function sendToDevice(key: string, message: Parameters<DeviceSocket['send']>[0]) { lives.get(key)?.socket?.send(message); }

AppState.addEventListener('change', state => {
  if (state !== 'active') return;
  for (const key of lives.keys()) wakeDevice(key);
});
