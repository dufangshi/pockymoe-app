// The account Live Activity's snapshot from the app's thread lists (the Web's
// desktop/data/activity.ts buildActivityItems, in the iOS shell's ActivitySnapshot shape).
// Relay devices only: the relay keeps the activity current from the same conversations
// (`deviceId:rootThreadId`) while the app is closed.
import type { ThreadDto, WorkspaceDto } from '@pockymoe/shared';

export interface ActivityItem {
  key: string; deviceId: string; deviceName: string; workspaceLabel: string; threadId: string;
  title: string; state: 'needsInput' | 'failed' | 'interrupted' | 'running' | 'completed'; since: string;
  rootThreadKey?: string; rootThreadTitle?: string;
}
export interface ActivitySnapshot { accountId: string; items: ActivityItem[] }
export interface ActivityDevice { deviceId: string; name: string; threads: ThreadDto[]; workspaces: WorkspaceDto[]; waiting: Record<string, number> }

const DAY = 86_400_000;
const priority = { needsInput: 0, failed: 1, interrupted: 2, completed: 3, running: 4 } as const;
const plain = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

export function buildActivitySnapshot(accountId: string, devices: ActivityDevice[], isUnread: (deviceId: string, thread: ThreadDto) => boolean, now = Date.now()): ActivitySnapshot {
  const items = devices.flatMap(device => {
    const byId = new Map(device.threads.map(t => [t.id, t]));
    const labels = new Map(device.workspaces.map(w => [w.id, w.label]));
    return device.threads.flatMap<ActivityItem>(thread => {
      if (thread.closedAt) return [];
      const recent = (at: string | null | undefined) => !!at && now - Date.parse(at) < DAY;
      const unread = isUnread(device.deviceId, thread);
      const state = (device.waiting[thread.id] ?? 0) > 0 ? 'needsInput'
        : thread.status === 'running' || thread.activeTurnId ? 'running'
        : (thread.status === 'failed' || thread.status === 'system_error') && recent(thread.lastTurnCompletedAt ?? thread.updatedAt) ? 'failed'
        : thread.status === 'interrupted' && unread && recent(thread.lastTurnCompletedAt ?? thread.updatedAt) ? 'interrupted'
        : unread && thread.status !== 'failed' && thread.status !== 'system_error' ? 'completed'
        : null;
      if (!state) return [];
      const root = thread.rootThreadId ? byId.get(thread.rootThreadId) : undefined;
      return [{
        key: `${device.deviceId}:${thread.id}`, deviceId: device.deviceId, deviceName: device.name,
        workspaceLabel: labels.get(thread.workspaceId) ?? '', threadId: thread.id, title: plain(thread.title), state,
        since: (state === 'running' ? thread.lastTurnStartedAt : state === 'needsInput' ? thread.updatedAt : thread.lastTurnCompletedAt) ?? thread.updatedAt,
        ...(thread.rootThreadId ? { rootThreadKey: `${device.deviceId}:${thread.rootThreadId}`, rootThreadTitle: plain(root?.title ?? thread.title) } : {}),
      }];
    });
  });
  items.sort((a, b) => priority[a.state] - priority[b.state] || a.since.localeCompare(b.since) || a.key.localeCompare(b.key));
  return { accountId, items };
}
