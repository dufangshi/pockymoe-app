export interface RoutedClip {
  value: number;
  animation: string;
  durationMs: number;
  start: string;
  end: string;
  loop?: boolean;
  exitAnimation?: string;
  exitRestMs?: { start: number; end: number };
  /** Source-speed exit: forward by default, or toward the nearer shared boundary. */
  nativeExit?: boolean | 'nearest';
}
export interface RivePoseReaction {
  clips: number[];
  targets: number[];
  animation: string;
  durationMs: number;
  settleMs: number;
  /** Non-waking requests return to this pose after the reaction. */
  resumeValue?: number;
  resumeTargets?: number[];
  /** Reaction materials fitted to successive drawings of the held source clip. */
  drawings?: { atMs: number; animation: string }[];
}
export interface RiveRouting {
  maxExitMs: number;
  clips: RoutedClip[];
  bridges: number[];
  reactions?: RivePoseReaction[];
}
interface Leg {
  clip: RoutedClip;
  from: number;
  to: number;
  duration: number;
  native: boolean;
}
interface Reaction {
  definition: RivePoseReaction;
  value: number;
  elapsed: number;
  from: number;
  time: number;
  exit?: {
    from: number;
    brakeTo: number;
    brakeMs: number;
    to: number;
    elapsed: number;
    duration: number;
    done: boolean;
  };
}
export interface RoutedSample {
  value: number;
  animation: string;
  time: number;
  leaving: boolean;
  boundary: boolean;
  exitMix: number;
  reaction?: { animation: string; time: number };
}
const ease = (value: number) => value * value * (3 - 2 * value);
const gentleReturn = (value: number) => value ** 3 * (10 - 15 * value + 6 * value * value);

function reactionAnimation(definition: RivePoseReaction, sourceMs: number): string {
  const drawings = definition.drawings ?? [];
  for (let i = drawings.length - 1; i >= 0; i--) {
    if (Math.fround(drawings[i].atMs / 1000) <= Math.fround(sourceMs / 1000)) {
      return drawings[i].animation;
    }
  }
  return definition.animation;
}

/** Incompatible material charts meet only at an exact shared drawing. */
export class RiveRestRouter {
  private clip: RoutedClip;
  private time = 0;
  private legs: Leg[] = [];
  private elapsed = 0;
  private target?: RoutedClip;
  private boundary = false;
  private exitElapsed = 0;
  private reaction?: Reaction;
  private afterReaction?: { value: number; restart: boolean };
  private residency?: RivePoseReaction;

  constructor(
    private readonly config: RiveRouting,
    initial: number,
  ) {
    this.clip = this.find(initial);
  }

  private find(value: number): RoutedClip {
    const clip = this.config.clips.find((candidate) => candidate.value === value);
    if (!clip) throw new Error(`Missing routed motion ${value}`);
    return clip;
  }

  private path(start: string, end: string): RoutedClip[] {
    const queue = [{ node: start, clips: [] as RoutedClip[] }];
    const seen = new Set<string>();
    while (queue.length) {
      const current = queue.shift()!;
      if (current.node === end) return current.clips;
      if (seen.has(current.node)) continue;
      seen.add(current.node);
      for (const value of this.config.bridges) {
        const clip = this.find(value);
        if (clip.start === current.node) queue.push({ node: clip.end, clips: [...current.clips, clip] });
      }
    }
    throw new Error(`No rest route from ${start} to ${end}`);
  }

  seek(value: number, seconds: number): void {
    this.clip = this.find(value);
    this.time = Math.max(0, Math.min(this.clip.durationMs, seconds * 1000));
    this.legs = [];
    this.target = undefined;
    this.boundary = false;
    this.reaction = undefined;
    this.afterReaction = undefined;
    this.residency = undefined;
  }

  request(value: number, restart = false, displayedSeconds?: number): void {
    this.find(value);
    if (
      !restart &&
      value === (this.afterReaction?.value ?? this.reaction?.value ?? (this.target ?? this.clip).value)
    )
      return;
    if (displayedSeconds !== undefined) {
      this.time = Math.max(0, Math.min(this.clip.durationMs, displayedSeconds * 1000));
    }
    if (this.reaction) {
      this.afterReaction = { value, restart };
      if (!this.reaction.exit) {
        const from = this.reaction.time;
        const duration = this.reaction.definition.durationMs;
        const to = from <= duration / 2 ? 0 : duration;
        // Keep the incoming velocity while braking before a backward exit.
        // Reversing immediately creates a one-frame extremum on large gestures.
        const brakeMs = to === 0 && from > 0 ? Math.min(100, 2 * (duration - from)) : 0;
        const brakeTo = from + brakeMs / 2;
        this.reaction.exit = {
          from,
          brakeTo,
          brakeMs,
          to,
          elapsed: 0,
          duration: Math.min(250, Math.abs(to - brakeTo)),
          done: false,
        };
      }
      return;
    }
    const definition = this.config.reactions?.find(
      (rule) => rule.clips.includes(this.clip.value) && rule.targets.includes(value),
    );
    if (definition) {
      this.reaction = { definition, value, elapsed: 0, from: this.time, time: 0 };
      this.residency = definition.resumeValue === undefined ? undefined : definition;
      this.legs = [];
      this.target = undefined;
      this.boundary = false;
      return;
    }
    this.residency ??= this.config.reactions?.find(
      (rule) => rule.clips.includes(this.clip.value) && rule.resumeTargets?.includes(value),
    );
    if (this.residency?.resumeTargets?.includes(value)) {
      value = this.residency.resumeValue!;
      if (this.clip.value === value) return; // Resume the held source clock, never seek back to frame zero.
    } else {
      this.residency = undefined;
    }
    const target = this.find(value);
    const endpoint =
      this.clip.nativeExit === true || this.time > this.clip.durationMs / 2 ? this.clip.durationMs : 0;
    const family = endpoint === 0 ? this.clip.start : this.clip.end;
    const bridge = this.path(family, target.start);
    const pieces = [
      { clip: this.clip, from: this.time, to: endpoint },
      ...bridge.map((clip) => ({ clip, from: 0, to: clip.durationMs })),
    ].filter((piece) => Math.abs(piece.to - piece.from) > 1e-6);
    const acceleratedDistance = pieces
      .filter((piece) => !piece.clip.nativeExit)
      .reduce((sum, piece) => sum + Math.abs(piece.to - piece.from), 0);
    const budget = Math.min(this.config.maxExitMs, acceleratedDistance);
    this.legs = pieces.map((piece) => ({
      ...piece,
      native: !!piece.clip.nativeExit,
      duration: piece.clip.nativeExit
        ? Math.abs(piece.to - piece.from)
        : (budget * Math.abs(piece.to - piece.from)) / acceleratedDistance,
    }));
    this.elapsed = 0;
    this.target = target;
    this.boundary = false;
    this.exitElapsed = 0;
  }

  private reactionStep(dt: number): RoutedSample {
    const reaction = this.reaction!;
    reaction.elapsed += dt;
    const progress = Math.min(1, reaction.elapsed / reaction.definition.settleMs);
    this.time = Math.min(
      this.clip.durationMs,
      reaction.from + reaction.definition.settleMs * (progress - progress ** 3 + progress ** 4 / 2),
    );
    if (reaction.exit) {
      const exit = reaction.exit;
      exit.elapsed += dt;
      if (exit.elapsed < exit.brakeMs) {
        const progress = exit.elapsed / exit.brakeMs;
        reaction.time = exit.from + exit.brakeMs * (progress - (progress * progress) / 2);
      } else {
        const progress = exit.duration ? Math.min(1, (exit.elapsed - exit.brakeMs) / exit.duration) : 1;
        const mix = exit.brakeMs ? gentleReturn(progress) : ease(progress);
        reaction.time = exit.brakeTo + (exit.to - exit.brakeTo) * mix;
        exit.done = progress === 1;
      }
    } else {
      reaction.time = Math.min(reaction.elapsed, reaction.definition.durationMs);
    }
    return {
      value: reaction.value,
      animation: this.clip.animation,
      time: this.time / 1000,
      leaving: false,
      boundary: false,
      exitMix: 0,
      reaction: {
        animation: reactionAnimation(reaction.definition, this.time),
        time: reaction.time / 1000,
      },
    };
  }

  step(seconds: number): RoutedSample {
    let dt = Math.max(0, seconds * 1000);
    // Zero-time procedural passes must retain the exact last displayed sample.
    if (this.reaction?.exit?.done && dt > 0) {
      const next = this.afterReaction!;
      this.reaction = undefined;
      this.afterReaction = undefined;
      this.request(next.value, next.restart);
      dt = 0;
    }
    if (this.reaction) return this.reactionStep(dt);
    if (this.boundary && dt > 0) {
      this.clip = this.target!;
      this.time = 0;
      this.target = undefined;
      this.boundary = false;
      dt = 0;
    }
    let nativeLeg = false;
    if (this.target) {
      this.exitElapsed += dt;
      while (this.legs.length) {
        const leg = this.legs[0];
        const take = Math.min(dt, leg.duration - this.elapsed);
        this.elapsed += take;
        dt -= take;
        const progress = leg.duration ? this.elapsed / leg.duration : 1;
        this.clip = leg.clip;
        nativeLeg = leg.native;
        this.time = leg.from + (leg.to - leg.from) * (leg.native ? progress : ease(progress));
        if (this.elapsed < leg.duration - 1e-6) break;
        this.time = leg.to;
        this.legs.shift();
        this.elapsed = 0;
        if (!this.legs.length) {
          this.boundary = true;
          break;
        }
      }
      if (!this.legs.length && !this.boundary) this.boundary = true;
    } else {
      this.time += dt;
      if (this.clip.loop && this.time > this.clip.durationMs + 1e-6) this.time %= this.clip.durationMs;
      else this.time = Math.min(this.time, this.clip.durationMs);
    }
    let sample = this.time;
    if (this.target && !nativeLeg && this.clip.exitRestMs) {
      if (sample <= this.clip.exitRestMs.start) sample = 0;
      else if (sample >= this.clip.durationMs - this.clip.exitRestMs.end) sample = this.clip.durationMs;
    }
    return {
      value: this.clip.value,
      animation: this.clip.animation,
      time: sample / 1000,
      leaving: !!this.target,
      boundary: this.boundary,
      exitMix: this.target && !nativeLeg ? Math.min(1, this.exitElapsed / 80) : 0,
    };
  }
}

/** Cap only opted-in source drawing packs; other formats retain full DPR. */
export function riveBackingSize(
  width: number,
  height: number,
  dpr: number,
  native?: { width: number; height: number; scale: number },
): { width: number; height: number } {
  const scale = native
    ? Math.min(dpr, (native.width * native.scale) / width, (native.height * native.scale) / height)
    : dpr;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
