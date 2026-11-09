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
  /** Natural-speed exits fitted to successive source poses, including frame zero. */
  exits?: {
    everyMs: number;
    durationMs: number;
    animationPrefix: string;
    /** Reapply the held source pose before the exit's drawing/control tracks. */
    sourcePose?: boolean;
    /** Optional event-specific acting at the same fitted checkpoints. */
    responses?: { targets: number[]; animationPrefix: string }[];
    end: string;
  };
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
  /** Restore neutral properties before applying the next routed animation, without drawing a frame. */
  resetAnimation?: string;
  /** Legacy metadata, retained only for importing older packs. */
  maxExitMs?: number;
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
  sourcePose?: { animation: string; time: number };
}

/** Compact pack metadata names exit animations without listing hundreds of keys. */
export function riveExitAnimations(clip: RoutedClip): string[] {
  if (!clip.exits) return [];
  const count = Math.ceil(clip.durationMs / clip.exits.everyMs) + 1;
  const prefixes = [
    clip.exits.animationPrefix,
    ...(clip.exits.responses?.map((response) => response.animationPrefix) ?? []),
  ];
  return prefixes.flatMap((prefix) => Array.from({ length: count }, (_, i) => `${prefix}${i}`));
}
interface Reaction {
  definition: RivePoseReaction;
  value: number;
  elapsed: number;
  from: number;
  time: number;
  exit?: {
    from: number;
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
  sourcePose?: { animation: string; time: number };
}
const ease = (value: number) => value * value * (3 - 2 * value);

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
  private reaction?: Reaction;
  private afterReaction?: { value: number; restart: boolean };
  private residency?: RivePoseReaction;
  private sourcePose?: RoutedSample['sourcePose'];
  private fittedExit = false;
  private targetAtEnd = false;

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

  reactionAnimationAt(sourceSeconds: number): string | undefined {
    return this.reaction ? reactionAnimation(this.reaction.definition, sourceSeconds * 1000) : undefined;
  }

  seek(value: number, seconds: number): void {
    this.fittedExit = false;
    this.targetAtEnd = false;
    this.sourcePose = undefined;
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
    // Setting motion and firing motionStart in the same frame is one request.
    // A restart before the first sample must not queue a duplicate reaction.
    if (restart && this.reaction?.value === value && this.reaction.elapsed === 0) return;
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
        // Complete the authored gesture at natural speed, even on interruption.
        const to = duration;
        this.reaction.exit = {
          from,
          to,
          elapsed: 0,
          duration: Math.abs(to - from),
          done: false,
        };
      }
      return;
    }
    const definition = this.config.reactions?.find(
      (rule) => rule.clips.includes(this.clip.value) && rule.targets.includes(value),
    );
    if (definition) {
      this.reaction = {
        definition,
        value,
        elapsed: 0,
        from: this.time,
        time: 0,
      };
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
    this.fittedExit = !!this.clip.exits || !!this.sourcePose;
    this.legs = this.exitLegs(target);
    this.elapsed = 0;
    this.target = target;
    this.boundary = false;
  }

  private exitLegs(target: RoutedClip): Leg[] {
    const exit = this.clip.exits;
    const exitIndex = exit ? Math.ceil(this.time / exit.everyMs) : 0;
    const endpoint = exit
      ? Math.min(this.clip.durationMs, exitIndex * exit.everyMs)
      : this.clip.nativeExit === true || this.time > this.clip.durationMs / 2
        ? this.clip.durationMs
        : 0;
    const family = exit ? exit.end : endpoint === 0 ? this.clip.start : this.clip.end;
    // A fitted wake/return already completes an outro ending at this rest.
    // Re-entering that outro's starting family would replay the entire entrance.
    this.targetAtEnd =
      this.fittedExit &&
      this.config.bridges.includes(target.value) &&
      family === target.end &&
      family !== target.start;
    const bridge = this.targetAtEnd ? [] : this.path(family, target.start);
    const responsePrefix = exit?.responses?.find((response) => response.targets.includes(target.value))
      ?.animationPrefix;
    const authoredExit: RoutedClip | undefined = exit
      ? {
          value: this.clip.value,
          animation: `${responsePrefix ?? exit.animationPrefix}${exitIndex}`,
          durationMs: exit.durationMs,
          // The start is a fitted source pose. Future interrupts finish this
          // exit forward; they must never reverse into that unrelated pose.
          start: exit.end,
          end: exit.end,
          nativeExit: true,
        }
      : undefined;
    const pieces = [
      { clip: this.clip, from: this.time, to: endpoint, sourcePose: this.sourcePose },
      ...(authoredExit
        ? [{
            clip: authoredExit,
            from: 0,
            to: authoredExit.durationMs,
            sourcePose: exit?.sourcePose
              ? { animation: this.clip.animation, time: endpoint / 1000 }
              : undefined,
          }]
        : []),
      ...bridge.map((clip) => ({ clip, from: 0, to: clip.durationMs })),
    ].filter((piece) => Math.abs(piece.to - piece.from) > 1e-6);
    return pieces.map((piece) => ({
      ...piece,
      // A reversed loop eases into its return instead of instantly reversing
      // velocity on the event frame. Forward authored exits keep their timing.
      native: (!!piece.clip.nativeExit || !!piece.clip.exits) && piece.to > piece.from,
      // Smoothstep peaks at 1.5x; distance milliseconds therefore bounds speed.
      duration: Math.max(Math.abs(piece.to - piece.from), piece.to < piece.from ? 100 : 0),
    }));
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
      const progress = exit.duration ? Math.min(1, exit.elapsed / exit.duration) : 1;
      reaction.time = exit.from + (exit.to - exit.from) * progress;
      exit.done = progress === 1;
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
      this.sourcePose = undefined;
      dt = 0;
    }
    if (this.target) {
      while (this.legs.length) {
        const leg = this.legs[0];
        const take = Math.min(dt, leg.duration - this.elapsed);
        this.elapsed += take;
        dt -= take;
        const progress = leg.duration ? this.elapsed / leg.duration : 1;
        this.clip = leg.clip;
        this.sourcePose = leg.sourcePose;
        this.time = leg.from + (leg.to - leg.from) * (leg.native ? progress : ease(progress));
        if (this.elapsed < leg.duration - 1e-6) break;
        this.time = leg.to;
        this.legs.shift();
        this.elapsed = 0;
        if (!this.legs.length) {
          if (this.fittedExit) {
            // A bank's endpoint is a pose handoff, not an extra display frame.
            // Apply the destination in this same sample so a terminal rest key
            // cannot flash between the last fitted drawing and its destination.
            this.clip = this.target;
            this.time = this.targetAtEnd ? this.target.durationMs : 0;
            this.target = undefined;
            this.sourcePose = undefined;
            this.fittedExit = false;
          } else this.boundary = true;
          break;
        }
      }
      if (this.target && !this.legs.length && !this.boundary) this.boundary = true;
    } else {
      this.time += dt;
      if (this.clip.loop && this.time > this.clip.durationMs + 1e-6) this.time %= this.clip.durationMs;
      else this.time = Math.min(this.time, this.clip.durationMs);
    }
    const sample = this.time;
    return {
      value: this.clip.value,
      animation: this.clip.animation,
      time: sample / 1000,
      leaving: !!this.target,
      boundary: this.boundary,
      exitMix: 0,
      ...(this.sourcePose ? { sourcePose: this.sourcePose } : {}),
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
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
