import { describe, expect, it } from 'vitest';
import { RiveRestRouter, riveBackingSize, riveExitAnimations, type RiveRouting } from './riveRouting';
const config: RiveRouting = {
  maxExitMs: 350,
  bridges: [2, 3],
  clips: [
    {
      value: 0,
      animation: 'idle',
      durationMs: 1000,
      start: 'rest',
      end: 'rest',
      loop: true,
    },
    {
      value: 1,
      animation: 'work',
      durationMs: 2000,
      start: 'rest',
      end: 'rest',
    },
    {
      value: 2,
      animation: 'bed-in',
      durationMs: 1000,
      start: 'rest',
      end: 'bed',
    },
    {
      value: 3,
      animation: 'bed-out',
      durationMs: 1000,
      start: 'bed',
      end: 'rest',
    },
    {
      value: 4,
      animation: 'bed',
      durationMs: 2000,
      start: 'bed',
      end: 'bed',
      loop: true,
    },
  ],
};
describe('material-safe routing', () => {
  it('holds a shared source pose through checkpoint exits and interruptions', () => {
    const fixture = structuredClone(config);
    fixture.clips[1].exits = {
      everyMs: 500,
      durationMs: 650,
      animationPrefix: 'unused-',
      sourcePose: true,
      responses: [{
        targets: [2],
        animationPrefix: 'unused-response-',
      }],
      end: 'rest',
    };
    for (const target of [0, 2]) {
      for (const seconds of [0.2, 0.7]) {
        const router = new RiveRestRouter(fixture, 1);
        router.seek(1, seconds);
        router.request(target);
        const sample = router.step(0.31);
        expect(sample.animation).toBe(`${target === 2 ? 'unused-response-' : 'unused-'}${seconds < 0.5 ? 1 : 2}`);
        expect(sample.time).toBeCloseTo(0.01);
        expect(sample.sourcePose).toEqual({ animation: 'work', time: seconds < 0.5 ? 0.5 : 1 });
        router.request(4);
        expect(router.step(0.01).sourcePose).toEqual(sample.sourcePose);
        router.step(4);
        expect(router.step(0).sourcePose).toBeUndefined();
        router.seek(1, 0.5);
        expect(router.step(0).sourcePose).toBeUndefined();
      }
    }
  });

  it('selects event-specific acting without changing exit timing or reversing the source', () => {
    const fixture = structuredClone(config);
    fixture.clips[1].exits = {
      everyMs: 100,
      durationMs: 800,
      animationPrefix: 'lower-',
      responses: [{ targets: [2], animationPrefix: 'startle-' }],
      end: 'rest',
    };
    const names = riveExitAnimations(fixture.clips[1]);
    expect(names).toHaveLength(42);
    expect(names).toContain('startle-20');
    for (const phase of [0.25, 0.5, 0.75]) {
      for (const target of [0, 2]) {
        const router = new RiveRestRouter(fixture, 1);
        router.seek(1, phase * 2 + 0.01);
        router.request(target);
        expect(router.step(0.1).animation).toBe(`${target === 2 ? 'startle' : 'lower'}-${phase * 20 + 1}`);
        expect(router.step(0.1).time).toBeCloseTo(0.11);
        const boundary = router.step(0.7);
        expect(boundary.boundary).toBe(true);
        expect(router.step(1 / 60).animation).toBe(target === 0 ? 'idle' : 'bed-in');
      }
    }
  });

  it('takes fitted forward exits at every loop phase instead of reversing long gestures', () => {
    const fixture = structuredClone(config);
    const work = fixture.clips[1];
    work.durationMs = 11500;
    work.loop = true;
    work.exits = { everyMs: 500, durationMs: 1250, animationPrefix: 'work-exit-', end: 'rest' };
    expect(riveExitAnimations(work)).toHaveLength(24);
    for (const phase of [0.25, 0.5, 0.75]) {
      const router = new RiveRestRouter(fixture, 1);
      router.seek(1, work.durationMs * phase / 1000);
      router.request(0);
      let previous = router.step(0), elapsed = 0, entered = false;
      for (let i = 0; i < 240; i++) {
        const next = router.step(1 / 120);
        elapsed += 1 / 120;
        if (next.animation === previous.animation)
          expect(next.time).toBeGreaterThanOrEqual(previous.time - 1e-6);
        if (next.animation.startsWith('work-exit-')) entered = true;
        if (!next.leaving) break;
        previous = next;
      }
      expect(entered).toBe(true);
      expect(elapsed).toBeLessThan(1.8);
      expect(router.step(0).value).toBe(0);
    }
  });

  it('finishes an authored exit forward when a second event interrupts it', () => {
    const fixture = structuredClone(config);
    fixture.clips[1].exits = {
      everyMs: 500, durationMs: 1250, animationPrefix: 'work-exit-', end: 'rest',
    };
    const router = new RiveRestRouter(fixture, 1);
    router.seek(1, 0.5);
    router.request(0);
    const before = router.step(0.2);
    expect(before.animation).toBe('work-exit-1');
    router.request(2);
    const after = router.step(0.1);
    expect(after.animation).toBe(before.animation);
    expect(after.time).toBeCloseTo(0.3);
    router.step(1);
    expect(router.step(0.1).animation).toBe('bed-in');
  });
  it('routes every pair through shared boundaries without exceeding 1.5x natural speed', () => {
    for (const from of config.clips)
      for (const target of config.clips)
        for (const phase of [0.25, 0.75]) {
          const router = new RiveRestRouter(config, from.value);
          router.seek(from.value, (from.durationMs * phase) / 1000);
          router.request(target.value, true);
          let previous = router.step(0);
          let reached = false;
          for (let i = 0; i < 1000; i++) {
            const sample = router.step(1 / 120);
            if (sample.animation === previous.animation && !previous.boundary)
              expect(Math.abs(sample.time - previous.time)).toBeLessThanOrEqual(1.5 / 120 + 1e-6);
            else if (sample.animation !== previous.animation)
              expect(
                Math.min(
                  previous.time,
                  Math.abs(
                    previous.time -
                      config.clips.find((c) => c.animation === previous.animation)!.durationMs /
                        1000,
                  ),
                ),
              ).toBeLessThanOrEqual(1.5 / 120 + 1e-6);
            if (!sample.leaving) {
              expect(sample.value).toBe(target.value);
              reached = true;
              break;
            }
            previous = sample;
          }
          expect(reached).toBe(true);
        }
  });
  it('keeps procedural zero-time passes inert without snapping a rest corridor', () => {
    const fixture = structuredClone(config);
    fixture.clips[1].exitRestMs = { start: 250, end: 250 };
    const router = new RiveRestRouter(fixture, 1);
    router.seek(1, 0.2);
    router.request(0);
    expect(router.step(0).time).toBe(0.2);
    expect(router.step(0.01).time).toBeGreaterThan(0.19);
    const before = router.step(0);
    router.request(2);
    expect(router.step(0).time).toBe(before.time);
  });
  it('gives a just-entered clip time to ease back when another event immediately arrives', () => {
    const router = new RiveRestRouter(config, 1);
    router.seek(1, 1 / 120);
    router.request(0);
    const first = router.step(1 / 60);
    expect(first).toMatchObject({ animation: 'work', leaving: true });
    expect(first.time).toBeGreaterThan(0.007);
    expect(first.time).toBeLessThan(1 / 120);
    for (let i = 0; i < 5; i++) router.step(1 / 60);
    expect(router.step(0)).toMatchObject({ animation: 'work', time: 0, boundary: true });
    expect(router.step(1 / 60)).toMatchObject({ animation: 'idle', time: 0, leaving: false });
  });
  it('decelerates a distant material locally for an authored reaction without selecting an unrelated frame', () => {
    const fixture = structuredClone(config);
    fixture.reactions = [
      {
        clips: [4],
        targets: [1],
        animation: 'bed-startle',
        durationMs: 800,
        settleMs: 100,
      },
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
    expect(r.step(0).reaction!.time).toBeCloseTo(0.77);
    const before = r.step(0.02);
    r.request(0, false, before.time);
    expect(r.step(0).time).toBe(before.time);
    for (let i = 0; i < 100; i++) r.step(0.01);
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
    expect(router.step(0.1)).toMatchObject({
      value: 4,
      animation: 'bed',
      time: 0.7,
      leaving: false,
    });
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
    expect(router.step(0.01)).toMatchObject({
      value: 4,
      animation: 'bed',
      leaving: false,
    });
  });
  it('eases a reversed loop toward its nearer boundary without an event-frame reversal', () => {
    const fixture = structuredClone(config);
    fixture.clips[0].nativeExit = 'nearest';
    const router = new RiveRestRouter(fixture, 0);
    router.step(0.3);
    router.request(1);
    for (let i = 1; i <= 5; i++) {
      const sample = router.step(0.05);
      const progress = i / 6;
      expect(sample.time).toBeCloseTo(0.3 * (1 - progress ** 2 * (3 - 2 * progress)));
      expect(sample).toMatchObject({
        animation: fixture.clips[0].animation,
        exitMix: 0,
      });
    }
    expect(router.step(0.05)).toMatchObject({ time: 0, boundary: true });
    expect(router.step(0.05)).toMatchObject({
      value: 1,
      time: 0,
      leaving: false,
    });

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
    expect(first.time).toBeCloseTo(0.16);
    r.request(0, false, first.time);
    expect(r.step(0).time).toBe(first.time);
    expect(r.step(0.1)).toMatchObject({
      animation: 'bed-out',
      time: first.time + 0.1,
      exitMix: 0,
    });
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
    for (let i = 0; i < 100; i++) values.push(r.step(0.01));
    expect(values.some((s) => s.reaction?.time === 0.8)).toBe(true);
    expect(values.at(-1)!.value).toBe(2);
    r.request(0);
    for (let i = 0; i < 100; i++) r.step(0.01);
    const resumed = r.step(0.01);
    expect(resumed).toMatchObject({ value: 4, leaving: false });
    expect(resumed.reaction).toBeUndefined();
    expect(resumed.time).toBeGreaterThan(0.5);
  });
  it('does not queue a second reaction when motionStart follows a new motion in the same frame', () => {
    const fixture = structuredClone(config);
    fixture.reactions = [
      {
        clips: [4],
        targets: [1],
        animation: 'gesture',
        durationMs: 1000,
        settleMs: 100,
      },
    ];
    const router = new RiveRestRouter(fixture, 4);
    router.request(1);
    router.request(1, true);
    expect(router.step(0.5).reaction?.time).toBeCloseTo(0.5);
    expect(router.step(0.5).reaction?.time).toBeCloseTo(1);
    expect(router.step(0.1).reaction?.time).toBeCloseTo(1);
  });
  it('finishes an interrupted gesture forward at natural speed before the next request', () => {
    const fixture = structuredClone(config);
    fixture.reactions = [
      {
        clips: [4],
        targets: [1],
        animation: 'gesture',
        durationMs: 1000,
        settleMs: 100,
      },
    ];
    const router = new RiveRestRouter(fixture, 4);
    router.request(1);
    router.step(0.4);
    router.request(2);
    expect(router.step(0.1).reaction?.time).toBeCloseTo(0.5);
    expect(router.step(0.5).reaction?.time).toBeCloseTo(1);
    expect(router.step(0.01).reaction).toBeUndefined();
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
