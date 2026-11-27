// Starred and recent threads and what was read, as the Web keeps them: the relay
// account's workbench (relay/account/workbench) for relay devices, local storage for
// direct Supervisors.
import type { ThreadDto } from '@pockymoe/shared';
import { relayApi, type ThreadReference } from '../../protocol/api';
import { prefs } from '../../platform/prefs';
import { createStore } from '../../state/store';
import { accountStore } from '../../connection/account';

const LOCAL_KEY = 'pockymoe-native.local-workbench';
export const referencesStore = createStore<{ relay: ThreadReference[]; local: ThreadReference[] }>({ relay: [], local: prefs.getJson<ThreadReference[]>(LOCAL_KEY) ?? [] });

const deviceIdOf = (deviceKey: string) => deviceKey.startsWith('relay:') ? deviceKey.slice(6) : deviceKey;
export function referenceFor(deviceKey: string, threadId: string) {
  const s = referencesStore.get();
  const list = deviceKey.startsWith('relay:') ? s.relay : s.local;
  return list.find(r => r.threadId === threadId && r.deviceId === deviceIdOf(deviceKey)) ?? null;
}
export const useStarred = (deviceKey: string, threadId: string) => referencesStore.useValue(() => !!referenceFor(deviceKey, threadId)?.favorite);

export async function refreshReferences() {
  if (accountStore.get().phase !== 'ready') return;
  try { referencesStore.set({ relay: (await relayApi.workbench()).threads }); } catch { /* keep the last snapshot */ }
}

async function record(deviceKey: string, thread: ThreadDto, workspaceLabel: string, patch: { favorite?: boolean; readCompletedAt?: string }) {
  const reference = { deviceId: deviceIdOf(deviceKey), threadId: thread.id, title: thread.title, workspaceLabel, workspaceId: thread.workspaceId, ...patch };
  if (deviceKey.startsWith('relay:')) {
    // Optimistic, then the relay's answer.
    referencesStore.set(s => ({ relay: upsert(s.relay, reference) }));
    try { referencesStore.set({ relay: (await relayApi.visit(reference)).threads }); } catch { /* the next refresh corrects it */ }
  } else {
    referencesStore.set(s => { const local = upsert(s.local, reference).slice(0, 100); prefs.setJson(LOCAL_KEY, local); return { local }; });
  }
}
function upsert(list: ThreadReference[], ref: Omit<ThreadReference, 'favorite' | 'visitedAt'> & { favorite?: boolean; readCompletedAt?: string }) {
  const previous = list.find(r => r.threadId === ref.threadId && r.deviceId === ref.deviceId);
  const next: ThreadReference = { ...previous, ...ref, favorite: ref.favorite ?? previous?.favorite ?? false, visitedAt: new Date().toISOString() } as ThreadReference;
  return [next, ...list.filter(r => r !== previous)];
}

export function toggleStar(deviceKey: string, thread: ThreadDto, workspaceLabel: string) {
  return record(deviceKey, thread, workspaceLabel, { favorite: !referenceFor(deviceKey, thread.id)?.favorite });
}
export function markRead(deviceKey: string, thread: ThreadDto, workspaceLabel: string) {
  if (!thread.lastTurnCompletedAt) return;
  const current = referenceFor(deviceKey, thread.id);
  if (current?.readCompletedAt && current.readCompletedAt >= thread.lastTurnCompletedAt) return;
  return record(deviceKey, thread, workspaceLabel, { readCompletedAt: thread.lastTurnCompletedAt });
}
/** Unread: a turn finished after the reader last saw the thread. */
export function isUnread(deviceKey: string, thread: ThreadDto) {
  if (!thread.lastTurnCompletedAt) return false;
  const ref = referenceFor(deviceKey, thread.id);
  if (!ref) return false; // never opened on this account: not "unread" noise
  return !ref.readCompletedAt || ref.readCompletedAt < thread.lastTurnCompletedAt;
}
