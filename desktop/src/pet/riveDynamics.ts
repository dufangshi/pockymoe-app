export const RIVE_DYNAMIC_INPUTS = ['blink','breath','weightShift','swayHair','swayGown','swayWings','dragLean'] as const;
export interface RiveProcedural { bodyBone: string; idleFps: 15 | 24 | 30; activeFps: 30 | 60; eyeOpen?: boolean; sourceFps?: 24 | 30 }
export interface BodySample { x: number; y: number; angle: number }
export function riveSourceTime(seconds: number, fps?: number): number {
  return Math.fround(fps ? Math.floor(seconds*fps+1e-5)/fps : seconds);
}
const clamp = (v: number, limit = 1): number => Math.max(-limit, Math.min(limit, v));
/** Inertial springs, integrated at <=1/120 s; no fixed looping secondary keys. */
export class RiveDynamics {
  private time = 0;
  private nextBlink: number;
  private blinkAt = -10;
  private previous?: BodySample;
  private velocity = { x: 0, y: 0, angle: 0 };
  private springs = [0,0,0].map(() => ({ x: 0, v: 0 }));
  /** Ignore subpixel spring noise when deciding whether to wake a source drawing. */
  get moving(): boolean { return this.springs.some(s => Math.abs(s.v) > .5 || Math.abs(s.x) > .1); }
  constructor(private readonly random: () => number = Math.random) { this.nextBlink = 2 + random() * 4; }
  step(seconds: number, body: BodySample, drag: { x: number; y: number } = { x: 0, y: 0 }): Record<typeof RIVE_DYNAMIC_INPUTS[number], number> {
    const dt = Math.max(0, Math.min(.1, seconds)); this.time += dt;
    const vel = this.previous && dt > 0 ? { x: (body.x-this.previous.x)/dt, y: (body.y-this.previous.y)/dt, angle: (body.angle-this.previous.angle)/dt } : this.velocity;
    const force = dt > 0 ? clamp((vel.x-this.velocity.x)/dt*.00012 + (vel.y-this.velocity.y)/dt*.00006 + (vel.angle-this.velocity.angle)/dt*.018, 8) : 0;
    this.previous = { ...body }; this.velocity = vel;
    const target = clamp(-force - drag.x/1500 - drag.y/3000);
    const steps = Math.max(1, Math.ceil(dt*120)), h = dt/steps;
    for (let n=0;n<steps;n++) this.springs.forEach((s,i) => {
      const omega = [12,8,17][i], damping = [.62,.78,.52][i];
      s.v += (omega*omega*(target-s.x)-2*damping*omega*s.v)*h;
      s.x = clamp(s.x+s.v*h);
    });
    if (this.time >= this.nextBlink) { this.blinkAt = this.time; this.nextBlink = this.time + 2.4 + this.random()*4.7; }
    const age = this.time-this.blinkAt;
    const blink = age < .075 ? age/.075 : age < .125 ? 1 : age < .24 ? 1-(age-.125)/.115 : 0;
    return {
      blink: Math.max(0,blink),
      // Author small micro-motion ranges so these steps remain subpixel at the
      // intended size/DPR. Constant visible values can then skip a draw.
      breath: Math.round((.5 + .32*Math.sin(this.time*1.29) + .12*Math.sin(this.time*.731+.8))*10)/10,
      weightShift: Math.round((.65*Math.sin(this.time*.287) + .22*Math.sin(this.time*.419+1.3))*12)/12,
      swayHair: Math.round(this.springs[0].x*1024)/1024, swayGown: Math.round(this.springs[1].x*1024)/1024, swayWings: Math.round(this.springs[2].x*1024)/1024,
      dragLean: clamp(-drag.x/1400),
    };
  }
}
/** Source drawings keep their own cadence; only live motion needs the higher rate. */
export class RiveSourceCadence {
  private gaze?: { x: number; y: number };
  private gazeUntil = 0;
  fps(now: number, source: number, gaze: { x: number; y: number }, live: boolean): number {
    if (this.gaze && (Math.abs(gaze.x-this.gaze.x) > 1/1024 || Math.abs(gaze.y-this.gaze.y) > 1/1024)) this.gazeUntil = now+150;
    this.gaze = { ...gaze };
    return live || now < this.gazeUntil ? 60 : source;
  }
}
/** Retains elapsed animation time while limiting expensive draws, without RAF rounding drift. */
export class RiveFrameGate {
  private last?: number;
  private next = 0;
  take(now: number, fps: number, urgent = false): number | null {
    const period = 1000/fps;
    if (this.last === undefined) { this.last = now; this.next = now+period; return 0; }
    if (!urgent && now+.1 < this.next) return null;
    const dt = Math.max(0,Math.min(.1,(now-this.last)/1000)); this.last = now;
    this.next = urgent ? now+period : this.next+period*Math.max(1,Math.floor((now-this.next+.1)/period)+1);
    return dt;
  }
}
