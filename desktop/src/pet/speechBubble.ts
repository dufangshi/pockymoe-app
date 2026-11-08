import { conversationKey } from '../shared/activityGroups';
import type { ActivityItem } from '../shared/contract';

/** What the pet is reading out, as the surfaces see it. Timing stays in the tracker. */
export interface PetSpeech {
  id: number;
  item: ActivityItem;
  text: string;
  playing: boolean;
}

/** Long enough to move the pointer onto a one-second announcement. */
export const SPEECH_LINGER_MS = 3000;
/** The renderer reports the end; this only covers one that died mid-sentence. */
export const SPEECH_MAX_MS = 120_000;

/**
 * Follows the audio itself rather than the alert: synthesis takes seconds and only the newest of
 * a backlog is read, so an alert's own bubble can show a different thread from the one being read.
 */
export class SpeechTracker {
  private nextId = 1;
  private pending: { id: number; item: ActivityItem; text: string } | null = null;
  private speech: (PetSpeech & { startedAt: number; endedAt: number }) | null = null;

  get current(): PetSpeech | null {
    if (!this.speech) return null;
    const { id, item, text, playing } = this.speech;
    return { id, item, text, playing };
  }

  /** The renderer cuts off older audio, so only the newest prepared line can still start. */
  prepare(item: ActivityItem, text: string): number {
    const id = this.nextId++;
    this.pending = { id, item, text };
    return id;
  }

  /** @returns whether this line is now the one shown. */
  started(id: number, now: number): boolean {
    if (this.pending?.id !== id) return false;
    this.speech = { ...this.pending, playing: true, startedAt: now, endedAt: 0 };
    this.pending = null;
    return true;
  }

  ended(id: number, now: number): void {
    if (this.pending?.id === id) this.pending = null;
    if (this.speech?.id === id && this.speech.playing) {
      this.speech.playing = false;
      this.speech.endedAt = now;
    }
  }

  /** @param holding the pointer is near, so it stays for as long as it is being read. */
  tick(now: number, holding: boolean): void {
    if (!this.speech) return;
    if (this.speech.playing && now - this.speech.startedAt >= SPEECH_MAX_MS) this.ended(this.speech.id, now);
    if (this.speech.playing) return;
    if (holding) this.speech.endedAt = now;
    else if (now - this.speech.endedAt >= SPEECH_LINGER_MS) this.speech = null;
  }

  /** The thread was opened, so its name no longer needs showing. A queued line for another stays. */
  dismiss(item: Pick<ActivityItem, 'key'>): void {
    if (this.speech && (this.speech.item.key === item.key || conversationKey(this.speech.item) === item.key))
      this.speech = null;
  }

  clear(): void {
    this.pending = null;
    this.speech = null;
  }
}

/**
 * How the line being read sits with the alert bubble:
 * - `line`: its own bubble, above whatever else is there;
 * - `replace`: it is that alert's thread, so it stands in for the pill and the pill returns after;
 * - `mark`: a request's bubble already names the thread, and its buttons must not move.
 */
export function speechPresentation(
  speech: Pick<PetSpeech, 'item'> | null,
  bubble: { sticky: boolean; events: { item: ActivityItem }[] } | null,
): 'none' | 'line' | 'replace' | 'mark' {
  if (!speech) return 'none';
  if (!bubble) return 'line';
  const key = conversationKey(speech.item);
  if (!bubble.events.every((event) => conversationKey(event.item) === key)) return 'line';
  return bubble.sticky ? 'mark' : 'replace';
}
