import { conversationKey } from './activityGroups';
import type { ActivityItem } from './contract';

/** Something a person does not want finished work announced for. The id matches ActivityItem's own keys. */
export interface MuteRule { kind: 'device' | 'workspace' | 'thread'; id: string; label: string }
export const MAX_MUTE_RULES = 500;
export function isMuted(item: Pick<ActivityItem, 'key' | 'deviceId' | 'workspaceId' | 'rootThreadKey'>, rules: readonly MuteRule[]): boolean {
  // An agent's thread goes with its conversation.
  const conversation = conversationKey(item as ActivityItem);
  return rules.some(rule => rule.kind === 'device' ? rule.id === item.deviceId
    : rule.kind === 'workspace' ? rule.id === `${item.deviceId}:${item.workspaceId}`
    : rule.id === conversation || rule.id === item.key);
}
