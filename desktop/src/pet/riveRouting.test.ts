import { describe, expect, it } from 'vitest';
import { RiveRestRouter, riveBackingSize, type RiveRouting } from './riveRouting';
const config: RiveRouting = {
  maxExitMs: 350,
  bridges: [2, 3],
  clips: [
    { value: 0, animation: 'idle', durationMs: 1000, start: 'rest', end: 'rest', loop: true },
    { value: 1, animation: 'work', durationMs: 2000, start: 'rest', end: 'rest' },
    { value: 2, animation: 'bed-in', durationMs: 1000, start: 'rest', end: 'bed' },
    { value: 3, animation: 'bed-out', durationMs: 1000, start: 'bed', end: 'rest' },
    { value: 4, animation: 'bed', durationMs: 2000, start: 'bed', end: 'bed', loop: true },
  ],
};
describe('material-safe routing', () => {
  it('reverses to the nearer start and enters only at shared rest', () => {
    const r = new RiveRestRouter(config, 1);
    r.step(0.4);
    r.request(0);
    const mid = r.step(0.175);
    expect(mid.value).toBe(1);
    expect(mid.time).toBeCloseTo(0.2);
    const boundary = r.step(0.175);
    expect(boundary.time).toBe(0);
    expect(boundary.boundary).toBe(true);
    expect(r.step(0)).toMatchObject({ value: 1, time: 0, boundary: true });
    expect(r.step(0.001)).toMatchObject({ value: 0, time: 0, leaving: false });
  });
  it('finishes forward at the nearer end', () => {
    const r = new RiveRestRouter(config, 1);
    r.step(1.8);
    r.request(0);
    expect(r.step(0.2)).toMatchObject({ value: 1, time: 2, boundary: true });
    expect(r.step(0.001).value).toBe(0);
  });
  it('exits a bed family through the authored bed-out within the total budget', () => {
    const r = new RiveRestRouter(config, 4);
    r.step(0.4);
    r.request(1);
    const seen = new Set<number>();
    for (let i = 0; i < 35; i++) seen.add(r.step(0.01).value);
    expect(seen.has(3)).toBe(true);
    expect(r.step(0.001)).toMatchObject({ value: 1, time: 0 });
  });
  it('replans a second interrupt without changing the current material or position', () => {
    const r = new RiveRestRouter(config, 1);
    r.step(0.5);
    r.request(0);
    const before = r.step(0.1);
    r.request(2);
    expect(r.step(0)).toMatchObject({ value: before.value, time: before.time });
  });
  it('reaches every fixture target from both halves within the combined budget', () => {
    for (const from of config.clips)
      for (const target of config.clips)
        for (const phase of [0.25, 0.75]) {
          const r = new RiveRestRouter(config, from.value);
          r.step((from.durationMs / 1000) * phase);
          r.request(target.value, true);
          for (let i = 0; i < 35; i++) r.step(0.01);
          const landed = r.step(0.001);
          expect(landed).toMatchObject({ value: target.value, leaving: false });
          expect(landed.time).toBeLessThanOrEqual(0.35);
        }
  });
  it('keeps zero-time procedural passes inert and replans from the displayed source sample', () => {
    const r = new RiveRestRouter(config, 1);
    r.step(0.419);
    r.request(0, false, 0.375);
    expect(r.step(0).time).toBe(0.375);
    for (let i = 0; i < 7; i++) r.step(0.05);
    const end = r.step(0);
    expect(end).toMatchObject({ value: 1, time: 0, boundary: true });
    expect(r.step(0)).toEqual(end);
    expect(r.step(0.01)).toMatchObject({ value: 0, time: 0, leaving: false });
  });
  it('uses verified rest corridors only during an exit, retaining neutral source motion', () => {
    const fixture = structuredClone(config);
    fixture.clips[1].exitRestMs = { start: 250, end: 250 };
    const r = new RiveRestRouter(fixture, 1);
    expect(r.step(0.2).time).toBe(0.2);
    r.request(0);
    expect(r.step(0.01).time).toBe(0);
    expect(r.step(0).value).toBe(1);
    r.seek(1, 1.8);
    expect(r.step(0).time).toBe(1.8);
    r.request(0);
    expect(r.step(0.01).time).toBe(2);
  });
  it('decelerates a distant material locally for an authored reaction without selecting an unrelated frame', () => {
    const fixture = structuredClone(config);
    fixture.reactions = [
      { clips: [4], targets: [1], animation: 'bed-startle', durationMs: 800, settleMs: 100 },
    ];
    const r = new RiveRestRouter(fixture, 4);
    r.step(0.419);
    r.request(1, false, 0.375);
    expect(r.step(0)).toMatchObject({
      value: 1,
      animation: 'bed',
      time: 0.375,
      reaction: { animation: 'bed-startle', time: 0 },
    });
    const samples = Array.from({ length: 50 }, () => r.step(0.01));
    expect(samples.every((s) => s.animation === 'bed' && !s.leaving)).toBe(true);
    expect(samples.at(-1)!.time).toBeCloseTo(0.425);
    r.request(1);
    expect(r.step(0).reaction!.time).toBeCloseTo(0.5);
    r.request(1, true);
    expect(r.step(0).reaction!.time).toBeCloseTo(0.5);
    for (let i = 0; i < 27; i++) r.step(0.01);
    expect(r.step(0).reaction!.time).toBeLessThan(0.03);
    const before = r.step(0.02);
    r.request(0, false, before.time);
    expect(r.step(0).time).toBe(before.time);
    for (let i = 0; i < 27; i++) r.step(0.01);
    expect(r.step(0).reaction).toBeUndefined();
  });
  it('uses the displayed body clock when the input clock has entered the next material', () => {
    const r = new RiveRestRouter(
      {
        ...config,
        reactions: [
          {
            clips: [4],
            targets: [0],
            animation: 'early',
            durationMs: 1000,
            settleMs: 100,
            drawings: [
              { atMs: 0, animation: 'early' },
              { atMs: 999, animation: 'late' },
            ],
          },
        ],
      },
      4,
    );
    r.seek(4, 0.98);
    r.request(0);
    expect(r.step(0.05).reaction?.animation).toBe('late');
    expect(r.reactionAnimationAt(23 / 24)).toBe('early');
    expect(r.reactionAnimationAt(1)).toBe('late');
    expect(r.reactionAnimationAt(23 / 24)).toBe('early');
  });
  it('selects reaction material from the held source time, including float32 key boundaries', () => {
    const fixture = structuredClone(config);
    fixture.reactions = [
      {
        clips: [4],
        targets: [1],
        animation: 'base',
        durationMs: 800,
        settleMs: 100,
        drawings: [
          { atMs: 0, animation: 'first' },
          { atMs: 500, animation: 'second' },
        ],
      },
    ];
    const router = new RiveRestRouter(fixture, 4);
    router.seek(4, 0.5 - 1e-12);
    router.request(1);
    expect(router.step(0).reaction?.animation).toBe('second');
    router.seek(4, 0.4);
    router.request(1);
    expect(router.step(0).reaction?.animation).toBe('first');
    expect(router.step(0.1).reaction?.animation).toBe('first');
    expect(router.step(0.2).time).toBeCloseTo(0.45);
    expect(router.step(0).reaction?.animation).toBe('first');
  });
  it('keeps non-waking requests in bed even before the first local reaction', () => {
    const fixture = structuredClone(config);
    fixture.reactions = [
      {
        clips: [4],
        targets: [1],
        animation: 'bed-poke',
        durationMs: 800,
        settleMs: 100,
        resumeValue: 4,
        resumeTargets: [0],
      },
    ];
    const router = new RiveRestRouter(fixture, 4);
    router.step(0.6);
    router.request(0);
    expect(router.step(0.1)).toMatchObject({ value: 4, animation: 'bed', time: 0.7, leaving: false });
  });
  it('finishes bed entry into the lying pose for a non-waking request', () => {
    const fixture = structuredClone(config);
    fixture.clips[2].nativeExit = true;
    fixture.reactions = [
      {
        clips: [2],
        targets: [1],
        animation: 'bed-entry-poke',
        durationMs: 800,
        settleMs: 100,
        resumeValue: 4,
        resumeTargets: [0],
      },
    ];
    const router = new RiveRestRouter(fixture, 2);
    router.step(0.6);
    router.request(0);
    for (let i = 0; i < 9; i++) {
      const sample = router.step(0.05);
      expect(sample.animation).not.toBe('bed-out');
      expect(sample.exitMix).toBe(0);
    }
    expect(router.step(0.01)).toMatchObject({ value: 4, animation: 'bed', leaving: false });
  });
  it('returns a protected loop to its nearer boundary at source speed', () => {
    const fixture = structuredClone(config);
    fixture.clips[0].nativeExit = 'nearest';
    const router = new RiveRestRouter(fixture, 0);
    router.step(0.3);
    router.request(1);
    for (let i = 1; i <= 5; i++) {
      const sample = router.step(0.05);
      expect(sample.time).toBeCloseTo(0.3 - i * 0.05);
      expect(sample).toMatchObject({ animation: fixture.clips[0].animation, exitMix: 0 });
    }
    expect(router.step(0.05)).toMatchObject({ time: 0, boundary: true });
    expect(router.step(0.05)).toMatchObject({ value: 1, time: 0, leaving: false });

    router.seek(0, fixture.clips[0].durationMs / 1000 - 0.2);
    const before = router.step(0).time;
    router.request(1);
    expect(router.step(0.05).time).toBeCloseTo(before + 0.05);
  });
  it('plays protected bed-out forward at source speed and replans a later event without rewinding', () => {
    const fixture = structuredClone(config);
    fixture.clips[3].nativeExit = true;
    const r = new RiveRestRouter(fixture, 4);
    r.step(0.4);
    r.request(1);
    for (let i = 0; i < 36; i++) r.step(0.01);
    const first = r.step(0.2);
    expect(first.animation).toBe('bed-out');
    expect(first.time).toBeCloseTo(0.21);
    r.request(0, false, first.time);
    expect(r.step(0).time).toBe(first.time);
    expect(r.step(0.1)).toMatchObject({ animation: 'bed-out', time: first.time + 0.1, exitMix: 0 });
    for (let i = 0; i < 80; i++) r.step(0.01);
    expect(r.step(0.01)).toMatchObject({ value: 0, leaving: false });
  });
  it('returns an interrupted reaction to neutral before another one, then resumes the held bed clock', () => {
    const fixture = structuredClone(config);
    fixture.reactions = [
      {
        clips: [4],
        targets: [1, 2],
        animation: 'bed-reaction',
        durationMs: 1000,
        settleMs: 100,
        resumeValue: 4,
        resumeTargets: [0],
      },
    ];
    const r = new RiveRestRouter(fixture, 4);
    r.step(0.5);
    r.request(1);
    const peak = r.step(0.4);
    r.request(2);
    expect(r.step(0).reaction!.time).toBe(peak.reaction!.time);
    const values = [];
    for (let i = 0; i < 40; i++) values.push(r.step(0.01));
    expect(values.some((s) => s.reaction?.time === 0)).toBe(true);
    expect(values.at(-1)!.value).toBe(2);
    r.request(0);
    for (let i = 0; i < 30; i++) r.step(0.01);
    const resumed = r.step(0.01);
    expect(resumed).toMatchObject({ value: 4, leaving: false });
    expect(resumed.reaction).toBeUndefined();
    expect(resumed.time).toBeGreaterThan(0.5);
  });
  it('brakes forward before reversing an interrupted gesture and reaches neutral within 350 ms', () => {
    const fixture = structuredClone(config);
    fixture.reactions = [
      { clips: [4], targets: [1, 2], animation: 'gesture', durationMs: 1000, settleMs: 100 },
    ];
    const router = new RiveRestRouter(fixture, 4);
    router.request(1);
    router.step(0.4);
    router.request(2);
    const first = router.step(0.001).reaction!.time;
    expect(first).toBeCloseTo(0.400995, 6);
    const stopped = router.step(0.099).reaction!.time;
    expect(stopped).toBeCloseTo(0.45);
    const returning = router.step(0.001).reaction!.time;
    expect(returning).toBeLessThan(stopped);
    expect(stopped - returning).toBeLessThan(0.00003);
    expect(router.step(0.249).reaction!.time).toBeCloseTo(0);
    expect(router.step(0).reaction!.time).toBeCloseTo(0);
    expect(router.step(0.001).value).toBe(2);
  });
  it('caps source backing resolution and preserves the aspect ratio and legacy DPR', () => {
    expect(riveBackingSize(1037, 1123, 2, { width: 648, height: 702, scale: 1 })).toEqual({
      width: 648,
      height: 702,
    });
    expect(riveBackingSize(648, 702, 2, { width: 648, height: 702, scale: 1.25 })).toEqual({
      width: 810,
      height: 878,
    });
    expect(riveBackingSize(200, 220, 2)).toEqual({ width: 400, height: 440 });
  });
});
