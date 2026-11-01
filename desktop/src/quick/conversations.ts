import type { ActivityItem } from '../shared/contract';
import { groupActivities, isAgentActivity } from '../shared/activityGroups';

const priority = (item: ActivityItem): number => ({ needsInput: 0, failed: 1, interrupted: 1, completed: 2, running: 3, idle: 4 })[item.state];
/** Filter whole conversations, then choose the most urgent actual thread for
 * replies/opening. A matching member must never create another visible row. */
export function quickConversations(items: ActivityItem[], query = '') {
  return groupActivities(items).filter(group => group.items.some(item =>
    `${group.title} ${item.title} ${item.agentName || ''} ${item.deviceName} ${item.workspaceLabel}`.toLocaleLowerCase().includes(query)
  )).map(group => ({ ...group,
    target: [...group.items].sort((a, b) => priority(a) - priority(b))[0],
    agentCount: new Set(group.items.filter(isAgentActivity).map(item => item.key)).size
  })).sort((a, b) => priority(a.target) - priority(b.target));
}
