// One open thread: its detail, live events applied in place, earlier pages, and the
// prompts this app sent that the device has not shown yet. Mounted views share one
// entry; it stays cached for a while after the last view closes for fast back
// navigation. Reconnecting never replays mutations.
import { mergeLatestThreadTurns, prependEarlierThreadTurns } from '@pockymoe/shared';
import { applyThreadEvent } from './threadEvents';
export { applyThreadEvent };
import type { ThreadDetailDto } from '@pockymoe/shared';
import { deviceApi, findDevice } from '../connection/devices';
import { createStore } from './store';
import { onDeviceEvent, retainDevice, setWaiting, upsertThread } from './deviceData';

import type { PromptAttachment } from '../protocol/api';
import { promptMatchKey } from '../features/thread/placeholder';
export interface LocalPrompt { clientRequestId: string; text: string; createdAt: string; state: 'sending' | 'failed'; error?: string;
  /** Kept in memory: a retry sends them again, and the prompt shows them until the server has them. */
  attachments: PromptAttachment[] }
export interface ThreadEntry {
  detail: ThreadDetailDto | null;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  loadingEarlier: boolean;
  hasEarlier: boolean;
  local: LocalPrompt[];
  /** Bumps on every applied event, for views that follow the bottom. */
  revision: number;
}
const blank = (): ThreadEntry => ({ detail: null, status: 'loading', error: null, loadingEarlier: false, hasEarlier: false, local: [], revision: 0 });
export const threadStore = createStore<Record<string, ThreadEntry>>({});
export const threadKey = (deviceKey: string, threadId: string) => `${deviceKey}::${threadId}`;
const BLANK = blank();
export const useThreadEntry = (deviceKey: string, threadId: string) => threadStore.useValue(s => s[threadKey(deviceKey, threadId)] ?? BLANK);

function patch(key: string, update: (entry: ThreadEntry) => Partial<ThreadEntry>) {
  threadStore.set(s => { const current = s[key] ?? blank(); return { [key]: { ...current, ...update(current), revision: current.revision + 1 } }; });
}

interface Session { users: number; unsubscribe: () => void; release: () => void; refresh: ReturnType<typeof setTimeout> | null; dispose: ReturnType<typeof setTimeout> | null }
const sessions = new Map<string, Session>();

/** `replace` drops cached turns (the history was rewound), instead of merging the latest. */
export async function loadThread(deviceKey: string, threadId: string, limit = 6, replace = false) {
  const key = threadKey(deviceKey, threadId);
  const device = findDevice(deviceKey); if (!device) return;
  try {
    const detail = await deviceApi(device).threadDetail(threadId, { limit });
    patch(key, entry => {
      const turns = entry.detail && !replace ? mergeLatestThreadTurns(entry.detail.turns, detail.turns, detail.thread.activeTurnId) : detail.turns;
      // A prompt the device now shows is no longer local.
      const shown = new Set(turns.flatMap(t => t.items.filter(i => i.kind === 'userMessage').map(i => promptMatchKey(i.text))));
      return { detail: { ...detail, turns }, status: 'ready', error: null,
        hasEarlier: (detail.totalTurnCount ?? turns.length) > turns.length,
        local: entry.local.filter(p => p.state === 'failed' || !shown.has(promptMatchKey(p.text))) };
    });
    setWaiting(deviceKey, threadId, detail.pendingRequests.length);
    upsertThread(deviceKey, detail.thread);
  } catch (error) {
    patch(key, entry => ({ status: entry.detail ? 'ready' : 'error', error: String((error as Error)?.message ?? error) }));
  }
}

export async function loadEarlier(deviceKey: string, threadId: string) {
  const key = threadKey(deviceKey, threadId);
  const entry = threadStore.get()[key];
  const first = entry?.detail?.turns[0];
  const device = findDevice(deviceKey);
  if (!entry?.detail || !first || entry.loadingEarlier || !device) return;
  patch(key, () => ({ loadingEarlier: true }));
  try {
    const page = await deviceApi(device).earlierTurns(threadId, first.id);
    patch(key, e => {
      const turns = prependEarlierThreadTurns(e.detail!.turns, page.turns);
      return { loadingEarlier: false, detail: { ...e.detail!, turns }, hasEarlier: page.turns.length > 0 && (page.totalTurnCount ?? 0) > turns.length };
    });
  } catch { patch(key, () => ({ loadingEarlier: false })); }
}

/** Keeps a thread live while a view shows it. */
export function retainThread(deviceKey: string, threadId: string) {
  const key = threadKey(deviceKey, threadId);
  let session = sessions.get(key);
  if (session) { session.users++; if (session.dispose) { clearTimeout(session.dispose); session.dispose = null; } }
  else {
    const release = retainDevice(deviceKey);
    const scheduleRefresh = (delay: number) => {
      const s = sessions.get(key); if (!s) return;
      if (s.refresh) clearTimeout(s.refresh);
      s.refresh = setTimeout(() => { s.refresh = null; void loadThread(deviceKey, threadId); }, delay);
    };
    const unsubscribe = onDeviceEvent(deviceKey, event => {
      if (event.threadId !== threadId) return;
      const entry = threadStore.get()[key];
      if (entry?.detail) patch(key, e => ({ detail: applyThreadEvent(e.detail!, event) }));
      if (event.type === 'thread.request.created' || event.type === 'thread.request.resolved')
        setWaiting(deviceKey, threadId, threadStore.get()[key]?.detail?.pendingRequests.length ?? 0);
      // The device's canonical items (the prompt, compacted tools) arrive with a reload.
      if (event.type === 'thread.turn.started') scheduleRefresh(400);
      if (event.type === 'thread.turn.completed') scheduleRefresh(250);
      // Edit from here removed turns: read the history again instead of merging into it.
      if (event.type === 'thread.updated' && (event.payload as { reason?: string }).reason === 'historyRewound') void loadThread(deviceKey, threadId, 6, true);
    });
    session = { users: 1, unsubscribe, release, refresh: null, dispose: null };
    sessions.set(key, session);
    void loadThread(deviceKey, threadId);
  }
  return () => {
    const s = sessions.get(key); if (!s) return;
    s.users--;
    if (s.users > 0) return;
    s.dispose = setTimeout(() => {
      s.unsubscribe(); s.release(); if (s.refresh) clearTimeout(s.refresh); sessions.delete(key);
    }, 60_000);
  };
}

// ---- sending -----------------------------------------------------------------------------
export function addLocalPrompt(deviceKey: string, threadId: string, prompt: LocalPrompt) {
  patch(threadKey(deviceKey, threadId), e => ({ local: [...e.local.filter(p => p.clientRequestId !== prompt.clientRequestId), prompt] }));
}
export function updateLocalPrompt(deviceKey: string, threadId: string, clientRequestId: string, update: Partial<LocalPrompt> | null) {
  patch(threadKey(deviceKey, threadId), e => ({ local: update === null ? e.local.filter(p => p.clientRequestId !== clientRequestId)
    : e.local.map(p => p.clientRequestId === clientRequestId ? { ...p, ...update } : p) }));
}
export function patchDetail(deviceKey: string, threadId: string, update: (detail: ThreadDetailDto) => ThreadDetailDto) {
  patch(threadKey(deviceKey, threadId), e => e.detail ? { detail: update(e.detail) } : {});
}
