import { describe, expect, it } from 'vitest';
import { RiveDissolveClock, validateDissolves, type RiveDissolves } from './riveDissolve';
import type { RiveRouting } from './riveRouting';

const routing: RiveRouting = {
  bridges: [],
  clips: [0, 1, 2].map((value) => ({
    value, animation: `clip${value}`, durationMs: 4000,
    start: value === 2 ? 'bed' : 'rest', end: value === 2 ? 'bed' : 'rest',
  })),
};
const config: RiveDissolves = {
  stateMs: 450, bedMs: 550,
  clips: [{ value: 0, windows: [
    { atMs: 1000, durationMs: 350, regions: [[0.2, 0.3, 0.8, 0.7]] },
    { atMs: 2000, durationMs: 500, regions: [[0, 0, 1, 1]] },
  ] }],
};

describe('inserted drawing dissolves', () => {
  it('retains all source time on both sides of multiple inserted windows', () => {
    const clock = new RiveDissolveClock(routing, config, 0);
    expect(clock.step(0.9).time).toBeCloseTo(0.9);
    const held = clock.step(0.275);
    expect(held.time).toBeCloseTo(1);
    expect(held.local?.mix).toBeCloseTo(0.5);
    expect(held.local!.from).toBeLessThan(1);
    expect(clock.step(0.675).time).toBeCloseTo(1.5);
    expect(clock.step(0.75).time).toBeCloseTo(2);
    expect(clock.step(1.75).time).toBeCloseTo(3.5);
  });

  it('seeks in source time and never consumes a window on a zero-time draw', () => {
    const clock = new RiveDissolveClock(routing, config, 0);
    clock.seek(0, 2.5);
    expect(clock.step(0).time).toBeCloseTo(2.5);
    clock.seek(0, 0.99);
    clock.step(0.1);
    expect(clock.step(0)).toEqual(clock.step(0));
  });

  it('responds from every source phase immediately, completes within the budget and never reverses', () => {
    for (const phase of [0.25, 0.5, 0.75]) {
      const clock = new RiveDissolveClock(routing, config, 0);
      clock.seek(0, 4 * phase);
      expect(clock.request(1)).toBe(true);
      expect(clock.request(1, true)).toBe(false);
      expect(clock.step(1 / 60).stateMix).toBeGreaterThan(0);
      const done = clock.step(0.45);
      expect(done.leaving).toBe(false);
      expect(done.time).toBeGreaterThan(0.45);
      expect(clock.request(2)).toBe(true);
      expect(clock.step(0.56).stateMix).toBe(1);
    }
  });

  it('replaces a pending state fade immediately instead of queuing a long exit', () => {
    const clock = new RiveDissolveClock(routing, config, 0);
    clock.request(1);
    clock.step(0.2);
    expect(clock.request(2)).toBe(true);
    expect(clock.step(0).value).toBe(2);
    expect(clock.step(0.55).leaving).toBe(false);
  });

  it('hides face paint at unsafe interpolated source times and resumes beyond the guard', () => {
    const guarded = structuredClone(config);
    guarded.clips[0].overlayYieldMs = [[400, 470]];
    const clock = new RiveDissolveClock(routing, guarded, 0);
    expect(clock.step(0.39).overlaysHidden).toBe(false);
    expect(clock.step(0.05).overlaysHidden).toBe(true);
    expect(clock.step(0.05).overlaysHidden).toBe(false);
    expect(clock.step(0.6).overlaysHidden).toBe(true);
    clock.request(1);
    expect(clock.step(0).overlaysHidden).toBe(true);
    guarded.clips[0].overlayYieldMs = [[470, 400]];
    expect(() => validateDissolves(guarded, routing)).toThrow('overlay guard');
  });

  it('rejects invalid regions, unordered windows, missing clips and unbounded delays', () => {
    expect(() => validateDissolves(config, routing)).not.toThrow();
    for (const mutate of [
      (c: RiveDissolves) => { c.stateMs = 5000; },
      (c: RiveDissolves) => { c.clips[0].value = 99; },
      (c: RiveDissolves) => { c.clips[0].windows.reverse(); },
      (c: RiveDissolves) => { c.clips[0].windows[0].regions[0][0] = NaN; },
    ]) {
      const copy = structuredClone(config);
      mutate(copy);
      expect(() => validateDissolves(copy, routing)).toThrow();
    }
  });
});
