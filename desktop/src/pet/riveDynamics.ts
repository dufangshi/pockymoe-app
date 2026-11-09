export const RIVE_DYNAMIC_INPUTS = [
  'blink',
  'breath',
  'weightShift',
  'swayHair',
  'swayGown',
  'swayWings',
  'dragLean',
] as const;
export interface RiveProcedural {
  bodyBone: string;
  /** Legacy pack metadata; animation now follows the display's requestAnimationFrame. */
  idleFps?: 15 | 24 | 30;
  activeFps?: 30 | 60;
  eyeOpen?: boolean;
  /** Legacy source sampling metadata, never a runtime clock quantizer. */
  sourceFps?: 24 | 30;
  transientFace?: boolean;
  /** An authored acknowledgment on the displayed pose, independent of routing. */
  response?: boolean;
}

/** An event cue, separate from source playback and never time-warping its clock. */
export class RiveResponse {
  private age = Infinity;
  reset(): void {
    this.age = Infinity;
  }
  request(): void {
    // Repeated pointer/IPC acknowledgements must not reset an active lift.
    if (this.age >= 0.48) this.age = 0;
  }
  step(seconds: number): number {
    this.age += Math.max(0, seconds);
    return this.age < 0.48 ? Math.sin(Math.PI * this.age / 0.48) : 0;
  }
}
export interface BodySample {
  x: number;
  y: number;
  angle: number;
}
export function riveSourceTime(seconds: number): number {
  return Math.fround(seconds);
}
const clamp = (v: number, limit = 1): number => Math.max(-limit, Math.min(limit, v));
/** Inertial springs, integrated at <=1/120 s; no fixed looping secondary keys. */
export class RiveDynamics {
  private time = 0;
  private nextBlink: number;
  private blinkAt = -10;
  private previous?: BodySample;
  private velocity = { x: 0, y: 0, angle: 0 };
  private springs = [0, 0, 0].map(() => ({ x: 0, v: 0 }));
  constructor(private readonly random: () => number = Math.random) {
    this.nextBlink = 2 + random() * 4;
  }
  step(
    seconds: number,
    body: BodySample,
    drag: { x: number; y: number } = { x: 0, y: 0 },
  ): Record<(typeof RIVE_DYNAMIC_INPUTS)[number], number> {
    const dt = Math.max(0, Math.min(0.1, seconds));
    this.time += dt;
    const vel =
      this.previous && dt > 0
        ? {
            x: (body.x - this.previous.x) / dt,
            y: (body.y - this.previous.y) / dt,
            angle: (body.angle - this.previous.angle) / dt,
          }
        : this.velocity;
    const force =
      dt > 0
        ? clamp(
            ((vel.x - this.velocity.x) / dt) * 0.00012 +
              ((vel.y - this.velocity.y) / dt) * 0.00006 +
              ((vel.angle - this.velocity.angle) / dt) * 0.018,
            8,
          )
        : 0;
    this.previous = { ...body };
    this.velocity = vel;
    const target = clamp(-force - drag.x / 1500 - drag.y / 3000);
    const steps = Math.max(1, Math.ceil(dt * 120)),
      h = dt / steps;
    for (let n = 0; n < steps; n++)
      this.springs.forEach((s, i) => {
        const omega = [12, 8, 17][i],
          damping = [0.62, 0.78, 0.52][i];
        s.v += (omega * omega * (target - s.x) - 2 * damping * omega * s.v) * h;
        s.x = clamp(s.x + s.v * h);
      });
    if (this.time >= this.nextBlink) {
      this.blinkAt = this.time;
      this.nextBlink = this.time + 2.4 + this.random() * 4.7;
    }
    const age = this.time - this.blinkAt;
    const blink = age < 0.075 ? age / 0.075 : age < 0.125 ? 1 : age < 0.24 ? 1 - (age - 0.125) / 0.115 : 0;
    return {
      blink: Math.max(0, blink),
      breath: 0.5 + 0.32 * Math.sin(this.time * 1.29) + 0.12 * Math.sin(this.time * 0.731 + 0.8),
      weightShift: 0.65 * Math.sin(this.time * 0.287) + 0.22 * Math.sin(this.time * 0.419 + 1.3),
      swayHair: this.springs[0].x,
      swayGown: this.springs[1].x,
      swayWings: this.springs[2].x,
      dragLean: clamp(-drag.x / 1400),
    };
  }
}
/** Transient gaze exposes source eye paint again after movement ends. */
export class RiveGazePulse {
  private point?: { x: number; y: number };
  private current = { x: 0, y: 0 };
  private at?: number;
  private movedAt = -Infinity;
  sample(now: number, point?: { x: number; y: number }): { x: number; y: number; opacity: number } {
    const elapsed = this.at === undefined ? 0 : Math.max(0, Math.min(100, now - this.at));
    this.at = now;
    if (!point) {
      this.point = undefined;
      this.current = { x: 0, y: 0 };
      this.movedAt = -Infinity;
      return { x: 0, y: 0, opacity: 0 };
    }
    if (!this.point || Math.hypot(point.x - this.point.x, point.y - this.point.y) > 0.005) this.movedAt = now;
    this.point = point;
    // Cursor IPC arrives at 10 Hz; interpolate its target on every display frame.
    const mix = 1 - Math.exp(-elapsed / 45);
    this.current.x += (point.x - this.current.x) * mix;
    this.current.y += (point.y - this.current.y) * mix;
    const opacity = Math.max(0, Math.min(1, (360 - (now - this.movedAt)) / 180));
    return { x: this.current.x * opacity, y: this.current.y * opacity, opacity };
  }
}
