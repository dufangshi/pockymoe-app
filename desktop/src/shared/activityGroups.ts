import { t } from './i18n';
import type { ActivityItem } from './contract';

export interface ActivityGroup { key: string; title: string; items: ActivityItem[] }
export const conversationKey = (item: ActivityItem): string => item.rootThreadKey ?? item.key;
export const isAgentActivity = (item: ActivityItem): boolean => conversationKey(item) !== item.key;
export function conversationTitle(item: ActivityItem, allItems: ActivityItem[] = []): string {
  const key = conversationKey(item);
  if (key === item.key) return item.title;
  return allItems.find(root => root.key === key)?.title || item.rootThreadTitle || t('对话 {id}', { id: key.slice(key.indexOf(':') + 1).slice(0, 8) });
}
export function activitySecondary(item: ActivityItem): string {
  return `${isAgentActivity(item) ? `${t('智能体')}${item.agentName ? ` ${item.agentName}` : ''} · ` : ''}${item.deviceName} · ${item.workspaceLabel}`;
}
/** Preserve source order across conversations, with an active root before its agents.
 * A missing/inactive root still gets a conversation header from root metadata. */
export function groupActivities(items: ActivityItem[], allItems: ActivityItem[] = items): ActivityGroup[] {
  const groups = new Map<string, ActivityGroup>();
  for (const item of items) {
    const key = conversationKey(item);
    let group = groups.get(key);
    if (!group) { group = { key, title: conversationTitle(item, allItems), items: [] }; groups.set(key, group); }
    if (item.key === key) { group.title = item.title; group.items.unshift(item); } else group.items.push(item);
  }
  return [...groups.values()];
}
