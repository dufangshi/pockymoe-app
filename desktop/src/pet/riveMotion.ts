import { ClipSequencer } from './clipSequence';
import type { PetClip } from './packs';
export interface RiveMotion { value: number; durationMs: number; role?: 'intro' | 'outro' }
export type RiveMotions = Partial<Record<string, RiveMotion[]>>;
/** Uses the same intro/outro and 8% / 1–4 minute rest policy as raster packs. */
export class RiveMotionClock {
  private sequence: ClipSequencer;
  private current: PetClip | null = null;
  private elapsed = 0;
  private mood = '';
  private idle?: PetClip[];
  private idleBeats = 0;
  constructor(motions: RiveMotions, private readonly random: () => number = Math.random) {
    const states = Object.fromEntries(Object.entries(motions).map(([name, beats]) => [name, beats!.map(b => ({ path: String(b.value), frames: b.durationMs, role: b.role }))]));
    this.idle = states.idle;
    this.sequence = new ClipSequencer(states, random);
  }
  step(mood: string, seconds: number, now: number, restart = false): { value: number; restart: boolean } | null {
    this.elapsed += seconds * 1000;
    if (mood === this.mood && !restart && this.current && this.elapsed >= this.current.frames && ['waving','jumping','poked','failed','landing'].includes(mood)) return { value: Number(this.current.path), restart: false };
    if (mood !== this.mood || restart || !this.current || this.elapsed >= this.current.frames) {
      this.mood = mood; this.elapsed = 0; this.current = this.sequence.next(mood, now);
      if (mood === 'idle' && this.current && this.idle?.includes(this.current) && this.idleBeats++ % this.idle.length === 0) {
        // Keep neutral intervals in place; choose a new variant order for each cycle.
        const slots = this.idle.map((b, i) => b.path !== this.idle![0].path && !b.role ? i : -1).filter(i => i >= 0);
        for (let n = slots.length - 1; n > 0; n--) { const j = Math.floor(this.random() * (n + 1)), a = slots[n], b = slots[j]; [this.idle[a], this.idle[b]] = [this.idle[b], this.idle[a]]; }
      }
      return this.current ? { value: Number(this.current.path), restart: true } : null;
    }
    return this.current ? { value: Number(this.current.path), restart: false } : null;
  }
}
