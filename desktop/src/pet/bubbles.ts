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
const priority = (bubble: PetBubble): number => bubble.sticky ? 3 : bubble.events[0]?.type === 'failed' ? 2 : 1;

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
    const conversation = conversationKey(event.item);
    const related = event.type !== 'completed' ? this.queue.find((bubble) => bubble.events.every((existing) => existing.type === event.type && conversationKey(existing.item) === conversation)) : undefined;
    const burst = event.type === 'completed'
      ? this.queue.find((bubble) => !bubble.sticky && bubble.events.every((e) => e.type === 'completed') && now - bubble.createdAt <= 1200)
      : undefined;
    if (related) this.queue = this.queue.map((bubble) => bubble === related ? { ...bubble, events: [...bubble.events, event], shownAt: bubble.shownAt !== null && !bubble.sticky ? now : bubble.shownAt } : bubble);
    else if (burst) this.queue = this.queue.map((bubble) => bubble === burst ? { ...bubble, events: [...bubble.events, event] } : bubble);
    else this.queue.push({ id: event.alertId, events: [event], createdAt: now, shownAt: null, sticky: event.type === 'needsInput' });
    const previous = this.current;
    this.queue.sort((a, b) => priority(b) - priority(a) || a.createdAt - b.createdAt);
    if (previous && previous !== this.current) this.queue = this.queue.map((bubble) => bubble === previous ? { ...bubble, shownAt: null } : bubble);
    this.tick(now);
    return true;
  }

  acknowledge(alertId: string, now: number): void {
    this.queue = this.queue.flatMap((bubble) => {
      const events = bubble.events.filter((event) => event.alertId !== alertId);
      return events.length ? [{ ...bubble, events }] : [];
    });
    this.tick(now);
  }

  resolve(threadKey: string, now: number): void {
    this.queue = this.queue.flatMap((bubble) => {
      const events = bubble.sticky ? bubble.events.filter((event) => event.item.key !== threadKey) : bubble.events;
      return events.length ? [{ ...bubble, events }] : [];
    });
    this.tick(now);
  }

  tick(now: number): void {
    while (this.current && !this.current.sticky && this.current.shownAt !== null && now - this.current.shownAt >= 8000) this.queue.shift();
    if (this.current && this.current.shownAt === null) this.queue[0] = { ...this.current, shownAt: now };
  }

  clear(): void { this.queue = []; }
}
