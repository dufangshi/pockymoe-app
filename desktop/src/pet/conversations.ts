import type { ActivityItem, ActivityRecent } from '../shared/contract';
import { conversationKey, conversationTitle, groupActivities } from '../shared/activityGroups';

export interface PetConversation {
  key: string;
  title: string;
  root: ActivityItem;
  statusItem: ActivityItem;
  items: ActivityItem[];
  requests: ActivityItem[];
  children: ActivityItem[];
}
export function activityPriority(item: ActivityItem): number {
  if (item.state === 'completed' && !item.unread) return 4;
  return ({ needsInput: 0, failed: 1, interrupted: 1, completed: 2, running: 3, idle: 4 })[item.state];
}
function compareActivity(a: ActivityItem, b: ActivityItem): number {
  return activityPriority(a) - activityPriority(b) || (Date.parse(b.since) || 0) - (Date.parse(a.since) || 0);
}
/** Root routes remain usable when only a child's activity is in the snapshot. */
export function rootTarget(item: ActivityItem, allItems: ActivityItem[] = []): ActivityItem {
  const key = conversationKey(item), root = allItems.find(candidate => candidate.key === key);
  if (root) return root;
  if (key === item.key) return item;
  return { ...item, key, threadId: key.slice(key.indexOf(':') + 1), title: conversationTitle(item, allItems),
    state: 'idle', unread: false, request: null, rootThreadKey: null, rootThreadTitle: null, agentName: null };
}
/** One identity per conversation, never per title or per child. Request identities stay intact. */
export function petConversations(items: ActivityItem[], allItems: ActivityItem[] = items): PetConversation[] {
  const unique = new Map<string, ActivityItem>();
  for (const item of items) {
    const previous = unique.get(item.key);
    if (!previous || (Date.parse(item.since) || 0) >= (Date.parse(previous.since) || 0)) unique.set(item.key, item);
  }
  return groupActivities([...unique.values()], allItems).map(({ key, items: members }) => {
    const sorted = [...members].sort(compareActivity), root = rootTarget(sorted[0], allItems);
    return { key, title: root.title, root, statusItem: sorted[0], items: members,
      requests: sorted.filter(item => item.state === 'needsInput' && item.request), children: members.filter(item => item.key !== key) };
  }).sort((a, b) => compareActivity(a.statusItem, b.statusItem));
}
export function panelConversations(items: ActivityItem[], recent: ActivityRecent[]): PetConversation[] {
  return items.length ? petConversations(items) : petConversations(recent.map(item => ({ ...item, workspaceId: '', state: 'idle', since: '', unread: false }))).slice(0, 5);
}
export function replyTarget(conversation: PetConversation, selectedRequest: string | null): ActivityItem {
  return conversation.requests.find(item => item.key === selectedRequest) ?? conversation.root;
}
export function petMetadata(item: ActivityItem): string { return [item.deviceName, item.workspaceLabel].filter(Boolean).join(' · '); }
