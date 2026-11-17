import { afterEach, describe, expect, it, vi } from 'vitest';
import { PetFrameScheduler, petAnimationRuns } from './frameScheduler';
import { nextFrameDelay, frameAt } from './animation';
import { assertPresentationRate } from './presentationBudget';

afterEach(() => vi.useRealTimers());
describe('pet presentation cadence', () => {
  it.each([30, 60, 120])('caps %i Hz invalidations and advances by real elapsed time', hz => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const draws: number[] = [];
    const scheduler = new PetFrameScheduler(now => { draws.push(now); }, () => Date.now());
    scheduler.setRunning(true);
    for (let i = 0; i < hz * 10; i++) {
      scheduler.invalidate();
      vi.advanceTimersByTime(1000 / hz);
    }
    scheduler.setRunning(false);
    expect(draws.length).toBeGreaterThan(200);
    assertPresentationRate(draws.length, 10);
    expect(draws.slice(1).every((now, i) => now - draws[i] >= 1000 / 30 - 0.001)).toBe(true);
    const elapsed = draws.slice(1).reduce((sum, now, i) => sum + (now - draws[i]) / 1000, 0);
    expect(elapsed).toBeCloseTo((draws.at(-1)! - draws[0]) / 1000, 10);
    expect(elapsed).toBeGreaterThan(9.8);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('has no pending loop for glass, hidden, tucked or reduced-motion stills', () => {
    vi.useFakeTimers();
    for (const [visible, surface, tucked, reduced, video] of [
      [true, 'glass', false, false, false], [false, 'sprite', false, false, false],
      [true, 'sprite', true, false, false], [true, 'sprite', false, true, false],
      [true, 'sprite', false, false, true],
    ] as const) {
      const draw = vi.fn(), scheduler = new PetFrameScheduler(draw);
      scheduler.setRunning(petAnimationRuns(visible, surface, tucked, reduced, video));
      vi.advanceTimersByTime(1000);
      expect(draw).not.toHaveBeenCalled(); expect(scheduler.pending).toBe(false);
      scheduler.invalidate(); vi.advanceTimersByTime(100);
      expect(draw).toHaveBeenCalledTimes(1); expect(scheduler.pending).toBe(false);
    }
  });
  it('the benchmark rejects 60/120Hz draws and accepts capped draws', () => {
    for (const fps of [60, 120]) expect(() => assertPresentationRate(fps * 15, 15)).toThrow(/cap/);
    expect(() => assertPresentationRate(451, 15)).not.toThrow();
  });
  it('holds ambient loops during system idle while allowing a bounded reaction or speech', () => {
    expect(petAnimationRuns(true, 'sprite', false, false, false, true, false)).toBe(false);
    expect(petAnimationRuns(true, 'sprite', false, false, false, true, true)).toBe(true);
    expect(petAnimationRuns(false, 'sprite', false, false, false, true, true)).toBe(false);
  });
});

it('sleeps between atlas frame boundaries and across ambient holds', () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const draws: number[] = [], frames: number[] = [];
  const scheduler = new PetFrameScheduler(now => {
    draws.push(now);
    frames.push(frameAt('running', now, false, 2.5));
    return nextFrameDelay('running', now, 2.5);
  }, () => Date.now());
  scheduler.setRunning(true); vi.advanceTimersByTime(10000); scheduler.setRunning(false);
  expect(draws.length).toBeLessThan(35);
  expect(frames.slice(1).every((frame, i) => frame !== frames[i])).toBe(true);
  expect(nextFrameDelay('idle', 3000, 2.5)).toBe(11000);
  expect(nextFrameDelay('idle', 18000, 2.5)).toBe(13000);
  expect(nextFrameDelay('sleeping', 0)).toBe(Infinity);
  expect(nextFrameDelay('waving', 1400, 1, true)).toBe(Infinity);
});
