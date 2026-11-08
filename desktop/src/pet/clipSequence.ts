import type { PetClip } from './packs';

/** The chance, each time an idle clip ends, that she goes to rest. */
export const REST_CHANCE = .08;
const REST_MS = [60_000, 240_000] as const;

/**
 * Which clip plays next. A state's clips cycle, except that one with the role `intro` plays once on
 * entering the state and one with `outro` once on leaving it, so a pose held throughout a state can
 * be reached and left by real motion. `resting` is not a state of its own: with nothing running she
 * sometimes drifts into it from `idle`, and comes back when its time is up or anything happens.
 */
export class ClipSequencer {
  private mood: string | null = null;
  private entering = false;
  private restUntil = 0;
  private played = 0;
  private readonly cursor = new Map<string, number>();

  constructor(private readonly states: Partial<Record<string, PetClip[]>>, private readonly random: () => number = Math.random) {}

  next(mood: string, now: number, interrupt = false): PetClip | null {
    if (this.restUntil) {
      if (mood === 'idle' && now < this.restUntil) return this.cycle('resting');
      this.restUntil = 0;
      const outro = this.role('resting', 'outro');
      if (outro && !interrupt) return outro;
    }
    if (mood !== this.mood) {
      const previous = this.mood;
      this.mood = mood; this.entering = true; this.played = 0;
      const outro = previous === null ? undefined : this.role(previous, 'outro');
      if (outro && !interrupt) return outro;
    }
    if (this.entering) {
      this.entering = false;
      const intro = this.role(mood, 'intro');
      if (intro) return intro;
    }
    // Only after a clip has played here, so she doesn't lie down the moment work ends.
    if (mood === 'idle' && this.played > 0 && this.states.resting && this.random() < REST_CHANCE) {
      this.restUntil = now + REST_MS[0] + this.random() * (REST_MS[1] - REST_MS[0]);
      return this.role('resting', 'intro') ?? this.cycle('resting');
    }
    this.played++;
    return this.cycle(mood);
  }

  /** The clip a reduced-motion pet holds still on. */
  still(mood: string): PetClip | null { return this.loops(mood)[0] ?? null; }

  /** What will probably follow, so it can be decoded ahead of time. */
  upcoming(mood: string): PetClip | null {
    const list = this.loops(mood);
    return list.length ? list[(this.cursor.get(mood) ?? 0) % list.length]! : null;
  }

  private role(mood: string, role: NonNullable<PetClip['role']>): PetClip | undefined { return this.states[mood]?.find(clip => clip.role === role); }
  private loops(mood: string): PetClip[] { return this.states[mood]?.filter(clip => !clip.role) ?? []; }
  private cycle(mood: string): PetClip | null {
    const list = this.loops(mood);
    if (!list.length) return null;
    const index = this.cursor.get(mood) ?? 0;
    this.cursor.set(mood, index + 1);
    return list[index % list.length]!;
  }
}
