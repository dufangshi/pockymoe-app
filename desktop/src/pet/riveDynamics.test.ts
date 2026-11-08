import { describe, it, expect } from 'vitest';
import { RiveDynamics, RiveGazePulse, riveSourceTime } from './riveDynamics';
describe('Rive procedural motion', () => {
  it('reacts to movement and drag, then damps to rest at different frame cadences', () => {
    for (const hz of [30, 60, 120]) {
      const d = new RiveDynamics(() => 0.5);
      d.step(0, { x: 0, y: 0, angle: 0 });
      let peak = 0,
        final = 0;
      for (let i = 0; i < hz * 5; i++) {
        const out = d.step(
          1 / hz,
          { x: 20, y: 0, angle: 0.2 },
          i < hz / 4 ? { x: 800, y: 0 } : undefined,
        );
        peak = Math.max(peak, Math.abs(out.swayHair));
        final = Math.abs(out.swayHair);
        expect(Object.values(out).every(Number.isFinite)).toBe(true);
      }
      expect(peak).toBeGreaterThan(0.2);
      expect(final).toBeLessThan(0.001);
    }
  });
  it('blinks outside idle and has no exact four-second breathing loop', () => {
    const d = new RiveDynamics(() => 0),
      samples = [];
    for (let i = 0; i < 600; i++) samples.push(d.step(1 / 60, { x: 0, y: 0, angle: -1.2 }));
    expect(samples.some((s) => s.blink > 0.99)).toBe(true);
    expect(samples[0].breath).not.toBeCloseTo(samples[240].breath, 2);
    expect(samples.every((s) => s.blink >= 0 && s.blink <= 1)).toBe(true);
  });
  it('keeps continuous inputs and source time distinct on 60 and 120 Hz displays', () => {
    for (const hz of [60, 120]) {
      const dynamics = new RiveDynamics(() => 0.5);
      const values = Array.from({ length: hz }, () =>
        dynamics.step(1 / hz, { x: 0, y: 0, angle: 0 }),
      );
      expect(new Set(values.map((v) => v.breath)).size).toBe(hz);
      expect(new Set(values.map((v) => v.weightShift)).size).toBe(hz);
      expect(new Set(Array.from({ length: hz }, (_, i) => riveSourceTime(i / hz))).size).toBe(hz);
    }
  });
  it('shows gaze only during a nearby movement and fades back to source eyes', () => {
    const gaze = new RiveGazePulse();
    expect(gaze.sample(0)).toEqual({ x: 0, y: 0, opacity: 0 });
    const moving = Array.from({ length: 12 }, (_, i) =>
      gaze.sample(1 + (i * 1000) / 60, { x: 0.5, y: -0.4 }),
    );
    expect(moving[0].x).toBeGreaterThanOrEqual(0);
    expect(moving[0].x).toBeLessThan(0.5);
    expect(new Set(moving.map((value) => value.x)).size).toBe(12);
    expect(moving.at(-1)!.x).toBeGreaterThan(0.48);
    expect(gaze.sample(271, { x: 0.5, y: -0.4 }).opacity).toBe(0.5);
    expect(gaze.sample(361, { x: 0.5, y: -0.4 })).toEqual({
      x: 0,
      y: -0,
      opacity: 0,
    });
    expect(gaze.sample(362, { x: 0.6, y: -0.4 }).opacity).toBe(1);
    expect(gaze.sample(363)).toEqual({ x: 0, y: 0, opacity: 0 });
  });
  it('preserves sub-source-frame time and exact float32 endpoints', () => {
    expect(riveSourceTime(0.02)).toBe(Math.fround(0.02));
    expect(riveSourceTime(1 / 24 + 0.01)).toBe(Math.fround(1 / 24 + 0.01));
    expect(riveSourceTime(8.749999999999922)).toBe(8.75);
  });
});
