import type { RiveRouting, RoutedClip, RoutedSample } from './riveRouting';

export type DissolveRect = [number, number, number, number];
export interface RiveDissolves {
  stateMs: number;
  bedMs: number;
  clips: {
    value: number;
    windows: { atMs: number; durationMs: number; regions: DissolveRect[] }[];
    /** Unsafe source-time spans, including interpolated samples beside a chart exchange. */
    overlayYieldMs?: [number, number][];
  }[];
}
export interface DissolveSample extends RoutedSample {
  wallTime: number;
  local?: { from: number; mix: number; regions: DissolveRect[] };
  stateMix: number;
  overlaysHidden: boolean;
}
const ease = (x: number) => x * x * (3 - 2 * x);

/** Inserts holds for chart exchanges; source performances are never trimmed or reversed. */
export class RiveDissolveClock {
  private clip: RoutedClip;
  private wallMs = 0;
  private stateAge = Infinity;
  private stateDuration = 0;

  constructor(
    private readonly routing: RiveRouting,
    readonly config: RiveDissolves,
    initial: number,
  ) {
    this.clip = this.find(initial);
  }

  private find(value: number): RoutedClip {
    const clip = this.routing.clips.find((c) => c.value === value);
    if (!clip) throw new Error(`Missing dissolve motion ${value}`);
    return clip;
  }

  private windows() {
    return this.config.clips.find((c) => c.value === this.clip.value)?.windows ?? [];
  }

  seek(value: number, seconds: number): void {
    this.clip = this.find(value);
    const sourceMs = Math.max(0, Math.min(this.clip.durationMs, seconds * 1000));
    this.wallMs = sourceMs + this.windows()
      .filter((w) => w.atMs <= sourceMs).reduce((sum, w) => sum + w.durationMs, 0);
    this.stateAge = Infinity;
  }

  /** Returns true once for a new event, so the drawer can retain the visible composite. */
  request(value: number, restart = false): boolean {
    if (value === this.clip.value && (!restart || this.wallMs === 0)) return false;
    const destination = this.find(value);
    const bed = this.clip.start !== 'rest' || this.clip.end !== 'rest' ||
      destination.start !== 'rest' || destination.end !== 'rest';
    this.stateDuration = bed ? this.config.bedMs : this.config.stateMs;
    this.clip = destination;
    this.wallMs = 0;
    this.stateAge = 0;
    return true;
  }

  step(seconds: number): DissolveSample {
    const ms = Math.max(0, seconds * 1000);
    this.wallMs += ms;
    this.stateAge += ms;
    const windows = this.windows();
    const duration = this.clip.durationMs + windows.reduce((sum, w) => sum + w.durationMs, 0);
    if (this.clip.loop && this.wallMs > duration) this.wallMs %= duration;
    else this.wallMs = Math.min(this.wallMs, duration);
    let sourceMs = this.wallMs;
    let local: DissolveSample['local'];
    for (const w of windows) {
      if (sourceMs < w.atMs) break;
      if (sourceMs < w.atMs + w.durationMs) {
        local = {
          // Stay on the coherent old material chart, not interpolated incompatible UVs.
          from: Math.max(0, w.atMs / 1000 - 1 / 24000),
          mix: ease((sourceMs - w.atMs) / w.durationMs),
          regions: w.regions,
        };
        sourceMs = w.atMs;
        break;
      }
      sourceMs -= w.durationMs;
    }
    const stateMix = this.stateAge < this.stateDuration
      ? ease(this.stateAge / this.stateDuration) : 1;
    const guards = this.config.clips.find((c) => c.value === this.clip.value)?.overlayYieldMs ?? [];
    return {
      value: this.clip.value,
      animation: this.clip.animation,
      time: Math.fround(sourceMs / 1000),
      wallTime: this.wallMs / 1000,
      leaving: stateMix < 1,
      boundary: false,
      exitMix: 0,
      local,
      stateMix,
      overlaysHidden: !!local || stateMix < 1 || guards.some(([a, b]) => sourceMs >= a && sourceMs <= b),
    };
  }
}

export function validateDissolves(config: RiveDissolves, routing: RiveRouting): void {
  if (!config || !Number.isFinite(config.stateMs) || config.stateMs < 300 || config.stateMs > 500 ||
      !Number.isFinite(config.bedMs) || config.bedMs < 400 || config.bedMs > 600 ||
      !Array.isArray(config.clips) || config.clips.length > 128) {
    throw new Error('Invalid Rive dissolve timing');
  }
  const seen = new Set<number>();
  for (const entry of config.clips) {
    const clip = routing.clips.find((c) => c.value === entry?.value);
    if (!clip || seen.has(entry.value) || !Array.isArray(entry.windows) || entry.windows.length > 512)
      throw new Error('Invalid Rive dissolve clip');
    seen.add(entry.value);
    let previousEnd = -1;
    const guards = entry.overlayYieldMs ?? [];
    if (!Array.isArray(guards) || guards.length > 512) throw new Error('Invalid Rive overlay guards');
    for (const span of guards) {
      if (!Array.isArray(span) || span.length !== 2 ||
          !span.every((v) => Number.isFinite(v) && v >= 0 && v <= clip.durationMs) ||
          span[0] >= span[1] || span[0] <= previousEnd) {
        throw new Error('Invalid Rive overlay guard span');
      }
      previousEnd = span[1];
    }
    let previous = -1;
    for (const w of entry.windows) {
      if (!w || !Number.isFinite(w.atMs) || w.atMs <= previous || w.atMs <= 0 ||
          w.atMs > clip.durationMs || !Number.isFinite(w.durationMs) || w.durationMs < 250 ||
          w.durationMs > 2000 || !Array.isArray(w.regions) || !w.regions.length ||
          w.regions.length > 64 || w.regions.some((r) =>
            !Array.isArray(r) || r.length !== 4 || !r.every((v) => Number.isFinite(v) && v >= 0 && v <= 1) ||
            r[0] >= r[2] || r[1] >= r[3])) {
        throw new Error('Invalid Rive dissolve window');
      }
      previous = w.atMs;
    }
  }
}
