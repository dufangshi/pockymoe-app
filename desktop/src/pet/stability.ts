import type { ActivityEventType, ActivityItem, PetMood } from '../shared/contract';
import { moodFor } from './animation';

export class StableMood {
  private sustained: PetMood = 'idle';
  private entered: number;
  private reaction: { mood: 'failed' | 'waving' | 'jumping' | 'poked' | 'landing'; until: number } | null = null;
  constructor(now: number) { this.entered = now; }
  reset(now: number): void { this.sustained = 'idle'; this.entered = now; this.reaction = null; }
  react(mood: 'failed' | 'waving' | 'jumping' | 'poked' | 'landing', now: number, duration = 2000): void {
    this.reaction = { mood, until: now + duration };
  }
  onEvent(type: ActivityEventType, now: number, delivered: boolean, completion: 'waving' | 'jumping' = 'waving', duration = 2000): void {
    if (!delivered) return;
    if (type === 'needsInput' && this.reaction?.mood !== 'failed') this.reaction = null;
    else if (type === 'failed') this.react('failed', now, duration);
    else if (type === 'completed') this.react(completion, now, duration);
  }
  value(items: ActivityItem[], now: number, snoozed = false): PetMood {
    if (snoozed) return 'sleeping';
    const desired = moodFor(items, { now });
    if (desired !== this.sustained && now - this.entered >= 2000) { this.sustained = desired; this.entered = now; }
    if (this.reaction && now < this.reaction.until) return this.reaction.mood;
    if (this.reaction && now >= this.reaction.until) this.reaction = null;
    return this.sustained;
  }
}

/** A resolved request can race with its newer running snapshot. Remove only that request. */
export function withoutResolvedRequest(items: ActivityItem[], resolved: ActivityItem): ActivityItem[] {
  if (!resolved.request) return items;
  return items.filter(item => item.key !== resolved.key || item.state !== 'needsInput' || item.request?.id !== resolved.request!.id);
}
