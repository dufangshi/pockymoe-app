import { conversationKey } from '../shared/activityGroups';
import type { ActivityEvent } from '../shared/contract';

export interface PetBubble {
  id: string;
  events: ActivityEvent[];
  createdAt: number;
  shownAt: number | null;
  sticky: boolean;
}
export function bubbleConversationCount(bubble: Pick<PetBubble, 'events'>): number {
  return new Set(bubble.events.map((event) => conversationKey(event.item))).size;
}
const priority = (bubble: PetBubble): number => bubble.sticky ? 3 : bubble.events.some(event => event.type === 'failed') ? 2 : 1;
function withEvents(bubble: PetBubble, events: ActivityEvent[]): PetBubble {
  const sticky = events.some(event => event.type === 'needsInput');
  return { ...bubble, events, sticky, shownAt: bubble.sticky && !sticky ? null : bubble.shownAt };
}

export class BubbleQueue {
  private queue: PetBubble[] = [];
  private seen = new Map<string, number>();
  private threadSpoke = new Map<string, number>();
  get current(): PetBubble | null { return this.queue[0] ?? null; }
  get pending(): readonly PetBubble[] { return this.queue; }

  push(event: ActivityEvent, now: number): boolean {
    if (!['needsInput', 'completed', 'failed'].includes(event.type)) return false;
    // Stable ids prevent replays; bounded retention also avoids a long-lived process leak.
    for (const [id, at] of this.seen) if (now - at > 86400000) this.seen.delete(id);
    for (const [key, at] of this.threadSpoke) if (now - at >= 30000) this.threadSpoke.delete(key);
    if (this.seen.has(event.alertId)) return false;
    this.seen.set(event.alertId, now);
    if (this.threadSpoke.has(event.item.key)) return false;
    this.threadSpoke.set(event.item.key, now);
    const conversation = conversationKey(event.item), previousId = this.current?.id;
    const related = this.queue.find(bubble => bubble.events.some(existing => conversationKey(existing.item) === conversation));
    const burst = event.type === 'completed' ? this.queue.find(bubble => !bubble.sticky && bubble.events.every(existing => existing.type === 'completed') && now - bubble.createdAt <= 1200) : undefined;
    if (related && related.events.some(existing => conversationKey(existing.item) !== conversation) && event.type !== 'completed') {
      // Pull this conversation out of a multi-conversation completion burst before attention preempts it.
      const own = related.events.filter(existing => conversationKey(existing.item) === conversation);
      this.queue = this.queue.map(bubble => bubble === related ? withEvents(bubble, bubble.events.filter(existing => conversationKey(existing.item) !== conversation)) : bubble).filter(bubble => bubble.events.length);
      this.queue.push(withEvents({ id: event.alertId, events: [], createdAt: now, shownAt: null, sticky: false }, [...own, event]));
    } else if (related) this.queue = this.queue.map(bubble => bubble === related ? withEvents({ ...bubble, shownAt: bubble.shownAt !== null && !bubble.sticky ? now : bubble.shownAt }, [...bubble.events, event]) : bubble);
    else if (burst) this.queue = this.queue.map(bubble => bubble === burst ? withEvents(bubble, [...bubble.events, event]) : bubble);
    else this.queue.push({ id: event.alertId, events: [event], createdAt: now, shownAt: null, sticky: event.type === 'needsInput' });
    this.queue.sort((a, b) => priority(b) - priority(a) || a.createdAt - b.createdAt);
    if (previousId && previousId !== this.current?.id) this.queue = this.queue.map(bubble => bubble.id === previousId ? { ...bubble, shownAt: null } : bubble);
    this.tick(now);
    return true;
  }

  acknowledge(alertId: string, now: number): void {
    this.queue = this.queue.flatMap((bubble) => {
      const events = bubble.events.filter((event) => event.alertId !== alertId);
      return events.length ? [withEvents(bubble, events)] : [];
    });
    this.tick(now);
  }

  resolve(threadKey: string, now: number): void {
    this.queue = this.queue.flatMap((bubble) => {
      const events = bubble.sticky ? bubble.events.filter((event) => event.item.key !== threadKey) : bubble.events;
      return events.length ? [withEvents(bubble, events)] : [];
    });
    this.tick(now);
  }

  tick(now: number): void {
    while (this.current && !this.current.sticky && this.current.shownAt !== null && now - this.current.shownAt >= 6000) this.queue.shift();
    if (this.current && this.current.shownAt === null) this.queue[0] = { ...this.current, shownAt: now };
  }

  clear(): void { this.queue = []; this.seen.clear(); this.threadSpoke.clear(); }
}
