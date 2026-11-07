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
  constructor(motions: RiveMotions, random: () => number = Math.random) {
    const states = Object.fromEntries(Object.entries(motions).map(([name, beats]) => [name, beats!.map(b => ({ path: String(b.value), frames: b.durationMs, role: b.role }))]));
    // Shuffle the idle variants while preserving the first neutral beat.
    const idle = states.idle;
    if (idle) for (let i = idle.length - 1; i > 1; i--) { const j = 1 + Math.floor(random() * i); [idle[i], idle[j]] = [idle[j], idle[i]]; }
    this.sequence = new ClipSequencer(states, random);
  }
  step(mood: string, seconds: number, now: number, restart = false): { value: number; restart: boolean } | null {
    this.elapsed += seconds * 1000;
    if (mood === this.mood && !restart && this.current && this.elapsed >= this.current.frames && ['waving','jumping','poked','failed','landing'].includes(mood)) return { value: Number(this.current.path), restart: false };
    if (mood !== this.mood || restart || !this.current || this.elapsed >= this.current.frames) {
      this.mood = mood; this.elapsed = 0; this.current = this.sequence.next(mood, now);
      return this.current ? { value: Number(this.current.path), restart: true } : null;
    }
    return this.current ? { value: Number(this.current.path), restart: false } : null;
  }
}
