export interface RoutedClip { value: number; animation: string; durationMs: number; start: string; end: string; loop?: boolean }
export interface RiveRouting { maxExitMs: number; clips: RoutedClip[]; bridges: number[] }
interface Leg { clip: RoutedClip; from: number; to: number; duration: number }
/** Only scrubs one material chart at a time. Incompatible charts meet at an exact shared drawing. */
export class RiveRestRouter {
  private clip: RoutedClip;
  private time = 0;
  private legs: Leg[] = [];
  private elapsed = 0;
  private target?: RoutedClip;
  private boundary = false;
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
  seek(value: number, seconds: number): void { this.clip=this.find(value); this.time=Math.max(0,Math.min(this.clip.durationMs,seconds*1000)); this.legs=[]; this.target=undefined; this.boundary=false; }
  request(value: number, restart = false): void {
    const target = this.find(value);
    if (!restart && value === (this.target ?? this.clip).value) return;
    const endpoint = this.time <= this.clip.durationMs / 2 ? 0 : this.clip.durationMs;
    const family = endpoint === 0 ? this.clip.start : this.clip.end;
    const bridge = this.path(family, target.start);
    const pieces = [{ clip: this.clip, from: this.time, to: endpoint }, ...bridge.map(clip => ({ clip, from: 0, to: clip.durationMs }))].filter(p => Math.abs(p.to-p.from)>1e-6);
    const distance = pieces.reduce((s,p)=>s+Math.abs(p.to-p.from),0);
    const budget = Math.min(this.config.maxExitMs, distance);
    this.legs = pieces.map(p=>({...p,duration:budget*Math.abs(p.to-p.from)/distance}));
    this.elapsed = 0; this.target = target; this.boundary = false;
  }
  step(seconds: number): { value: number; animation: string; time: number; leaving: boolean; boundary: boolean } {
    let dt = Math.max(0, seconds*1000);
    // Hold a shared boundary for one sample. It is the same drawing in both clips.
    if (this.boundary) { this.clip = this.target!; this.time = 0; this.target = undefined; this.boundary = false; dt = 0; }
    if (this.target) {
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
    return { value: this.clip.value, animation: this.clip.animation, time: this.time/1000, leaving: !!this.target, boundary: this.boundary };
  }
}
/** Cap only opted-in source drawing packs; other formats retain full DPR. */
export function riveBackingSize(width: number, height: number, dpr: number, native?: { width: number; height: number; scale: number }): { width: number; height: number } {
  const scale = native ? Math.min(dpr,native.width*native.scale/width,native.height*native.scale/height) : dpr;
  return { width: Math.max(1,Math.round(width*scale)), height: Math.max(1,Math.round(height*scale)) };
}
