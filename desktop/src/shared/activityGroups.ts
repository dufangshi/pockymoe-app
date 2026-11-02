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
/** Alert labels retain the agent identity without changing conversation grouping or destinations. */
export function agentActivityName(item: ActivityItem): string { return item.agentName || t('智能体').toLowerCase(); }
export function alertTitle(items: ActivityItem[], allItems: ActivityItem[] = [], compact = false): string {
  const item = items[0], conversation = conversationTitle(item, allItems);
  const agents = new Set(items.filter(isAgentActivity).map(item => item.key)).size;
  const suffix = agents > 1 ? ` · ${t('{count} 个子线程', { count: agents })}` : isAgentActivity(item) ? `.${agentActivityName(item)}` : '';
  // Only the conversation is shortened; the agent name remains intact on narrow surfaces.
  const chars = Array.from(conversation), limit = 32;
  const name = compact && chars.length > limit ? `${chars.slice(0, 16).join('')}…${chars.slice(-15).join('')}` : conversation;
  return name + suffix;
}
export function spokenActivityTitle(item: ActivityItem, allItems: ActivityItem[] = []): string {
  const title = conversationTitle(item, allItems);
  return isAgentActivity(item) ? t('{title} 的子线程 {agent}', { title, agent: agentActivityName(item) }) : title;
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
