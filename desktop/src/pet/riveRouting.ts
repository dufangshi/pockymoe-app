export interface RoutedClip { value: number; animation: string; durationMs: number; start: string; end: string; loop?: boolean; exitAnimation?: string; exitRestMs?: { start: number; end: number } }
export interface RivePoseReaction { clips: number[]; targets: number[]; animation: string; durationMs: number; settleMs: number }
export interface RiveRouting { maxExitMs: number; clips: RoutedClip[]; bridges: number[]; reactions?: RivePoseReaction[] }
interface Leg { clip: RoutedClip; from: number; to: number; duration: number }
/** Only scrubs one material chart at a time. Incompatible charts meet at an exact shared drawing. */
export class RiveRestRouter {
  private clip: RoutedClip;
  private time = 0;
  private legs: Leg[] = [];
  private elapsed = 0;
  private target?: RoutedClip;
  private boundary = false;
  private exitElapsed = 0;
  private reaction?: { definition: RivePoseReaction; value: number; elapsed: number; from: number };
  constructor(private readonly config: RiveRouting, initial: number) { this.clip = this.find(initial); }
  private find(value: number): RoutedClip { const clip = this.config.clips.find(c => c.value === value); if (!clip) throw new Error(`Missing routed motion ${value}`); return clip; }
  private path(start: string, end: string): RoutedClip[] {
    const queue: { node: string; clips: RoutedClip[] }[] = [{ node: start, clips: [] }], seen = new Set<string>();
    while (queue.length) {
      const p = queue.shift()!; if (p.node === end) return p.clips;
      if (seen.has(p.node)) continue; seen.add(p.node);
      for (const value of this.config.bridges) { const c = this.find(value); if (c.start === p.node) queue.push({ node: c.end, clips: [...p.clips, c] }); }
    }
    throw new Error(`No rest route from ${start} to ${end}`);
  }
  seek(value: number, seconds: number): void { this.clip=this.find(value); this.time=Math.max(0,Math.min(this.clip.durationMs,seconds*1000)); this.legs=[]; this.target=undefined; this.boundary=false; this.reaction=undefined; }
  request(value: number, restart = false, displayedSeconds?: number): void {
    const target = this.find(value);
    if (!restart && value === (this.reaction?.value ?? (this.target ?? this.clip).value)) return;
    if (displayedSeconds !== undefined) this.time = Math.max(0,Math.min(this.clip.durationMs,displayedSeconds*1000));
    const definition = this.config.reactions?.find(r => r.clips.includes(this.clip.value) && r.targets.includes(value));
    if (definition) {
      // React on the displayed chart. Decelerate its clock locally instead of
      // compressing a long bed/landing bridge through unrelated body drawings.
      this.reaction = { definition, value, elapsed: 0, from: this.time };
      this.legs = []; this.target = undefined; this.boundary = false; return;
    }
    this.reaction = undefined;
    const endpoint = this.time <= this.clip.durationMs / 2 ? 0 : this.clip.durationMs;
    const family = endpoint === 0 ? this.clip.start : this.clip.end;
    const bridge = this.path(family, target.start);
    const pieces = [{ clip: this.clip, from: this.time, to: endpoint }, ...bridge.map(clip => ({ clip, from: 0, to: clip.durationMs }))].filter(p => Math.abs(p.to-p.from)>1e-6);
    const distance = pieces.reduce((s,p)=>s+Math.abs(p.to-p.from),0);
    const budget = Math.min(this.config.maxExitMs, distance);
    this.legs = pieces.map(p=>({...p,duration:budget*Math.abs(p.to-p.from)/distance}));
    this.elapsed = 0; this.target = target; this.boundary = false; this.exitElapsed = 0;
  }
  step(seconds: number): { value: number; animation: string; time: number; leaving: boolean; boundary: boolean; exitMix: number; reaction?: { animation: string; time: number } } {
    let dt = Math.max(0, seconds*1000);
    if (this.reaction) {
      const r = this.reaction; r.elapsed += dt;
      const p = Math.min(1,r.elapsed/r.definition.settleMs);
      // Integral of smoothstep's complement: speed starts at 1 and reaches 0
      // with zero acceleration at both ends. Maximum source travel is settle/2.
      this.time = Math.min(this.clip.durationMs,r.from+r.definition.settleMs*(p-p**3+p**4/2));
      return { value:r.value,animation:this.clip.animation,time:this.time/1000,leaving:false,boundary:false,exitMix:0,reaction:{animation:r.definition.animation,time:Math.min(r.elapsed,r.definition.durationMs)/1000} };
    }
    // Hold a shared boundary for one sample. It is the same drawing in both clips.
    if (this.boundary && dt > 0) { this.clip = this.target!; this.time = 0; this.target = undefined; this.boundary = false; dt = 0; }
    if (this.target) {
      this.exitElapsed += dt;
      while (this.legs.length) {
        const leg = this.legs[0], take = Math.min(dt,leg.duration-this.elapsed); this.elapsed += take; dt -= take;
        const p = leg.duration ? this.elapsed/leg.duration : 1, ease = p*p*(3-2*p);
        this.clip = leg.clip; this.time = leg.from+(leg.to-leg.from)*ease;
        if (this.elapsed < leg.duration-1e-6) break;
        this.time = leg.to; this.legs.shift(); this.elapsed = 0;
        if (!this.legs.length) { this.boundary = true; break; }
      }
      if (!this.legs.length && !this.boundary) this.boundary = true;
    } else {
      this.time += dt;
      if (this.clip.loop && this.time > this.clip.durationMs+1e-6) this.time %= this.clip.durationMs;
      else this.time = Math.min(this.time,this.clip.durationMs);
    }
    // A source-verified rest corridor avoids re-playing a tiny excursion when
    // a long source clip is hurried into its endpoint. Normal playback is exact.
    let sample = this.time;
    if (this.target && this.clip.exitRestMs) {
      if (sample <= this.clip.exitRestMs.start) sample = 0;
      else if (sample >= this.clip.durationMs-this.clip.exitRestMs.end) sample = this.clip.durationMs;
    }
    return { value: this.clip.value, animation: this.clip.animation, time: sample/1000, leaving: !!this.target, boundary: this.boundary, exitMix: this.target ? Math.min(1,this.exitElapsed/80) : 0 };
  }
}
/** Cap only opted-in source drawing packs; other formats retain full DPR. */
export function riveBackingSize(width: number, height: number, dpr: number, native?: { width: number; height: number; scale: number }): { width: number; height: number } {
  const scale = native ? Math.min(dpr,native.width*native.scale/width,native.height*native.scale/height) : dpr;
  return { width: Math.max(1,Math.round(width*scale)), height: Math.max(1,Math.round(height*scale)) };
}
