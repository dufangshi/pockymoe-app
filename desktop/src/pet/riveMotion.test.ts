import { describe, it, expect } from 'vitest';
import { RiveMotionClock } from './riveMotion';
import { parseManifest } from './packs';
describe('Rive motion choreography', () => {
  it('plays intro, loop and interrupted outro in order', () => {
    const c = new RiveMotionClock(
      {
        idle: [{ value: 0, durationMs: 100 }],
        dragging: [
          { value: 1, durationMs: 50, role: 'intro' },
          { value: 2, durationMs: 100, role: 'outro' },
          { value: 3, durationMs: 100 },
        ],
      },
      () => 0.9,
    );
    expect(c.step('idle', 0, 0)?.value).toBe(0);
    expect(c.step('dragging', 0, 1)?.value).toBe(1);
    expect(c.step('dragging', 0.06, 61)?.value).toBe(3);
    expect(c.step('idle', 0, 62)?.value).toBe(2);
    expect(c.step('idle', 0.11, 172)?.value).toBe(0);
  });
  it('enters rest only after idle, and wakes through its outro', () => {
    const c = new RiveMotionClock(
      {
        idle: [{ value: 0, durationMs: 100 }],
        resting: [
          { value: 4, durationMs: 50, role: 'intro' },
          { value: 5, durationMs: 100 },
          { value: 6, durationMs: 50, role: 'outro' },
        ],
        running: [{ value: 7, durationMs: 100 }],
      },
      () => 0,
    );
    expect(c.step('idle', 0, 0)?.value).toBe(0);
    expect(c.step('idle', 0.11, 110)?.value).toBe(4);
    expect(c.step('idle', 0.06, 170)?.value).toBe(5);
    expect(c.step('running', 0, 171)?.value).toBe(6);
    expect(c.step('running', 0.06, 231)?.value).toBe(7);
  });
  it('keeps neutral intervals and reshuffles variants on each idle cycle', () => {
    const c = new RiveMotionClock(
      {
        idle: [
          { value: 0, durationMs: 100 },
          { value: 1, durationMs: 100 },
          { value: 0, durationMs: 100 },
          { value: 2, durationMs: 100 },
        ],
      },
      () => 0,
    );
    const values = Array.from({ length: 8 }, (_, i) => c.step('idle', i ? 0.11 : 0, i * 110)?.value);
    expect(values).toEqual([0, 2, 0, 1, 0, 1, 0, 2]);
  });
  it('holds one-shot endings and advances variants only on the next reaction', () => {
    const c = new RiveMotionClock({
      poked: [
        { value: 1, durationMs: 100 },
        { value: 2, durationMs: 100 },
      ],
    });
    expect(c.step('poked', 0, 0)).toEqual({ value: 1, restart: true });
    expect(c.step('poked', 0.2, 200)).toEqual({ value: 1, restart: false });
    expect(c.step('poked', 0, 201, true)).toEqual({ value: 2, restart: true });
  });
  it('rejects malformed motion plans in imported manifests', () => {
    const base = {
      id: 'fixture',
      displayName: 'Fixture',
      description: '',
      spritesheetPath: 'spritesheet.png',
      remoteCodex: {
        rive: {
          path: 'pet.riv',
          artboard: 'Pet',
          stateMachine: 'Pet',
          motions: { idle: [{ value: 0, durationMs: 100 }] },
        },
      },
    };
    expect(parseManifest(Buffer.from(JSON.stringify(base))).remoteCodex?.rive?.motions?.idle).toHaveLength(1);
    base.remoteCodex.rive.motions.idle[0].durationMs = 0;
    expect(() => parseManifest(Buffer.from(JSON.stringify(base)))).toThrow('motions');
  });
  it('interrupts a procedural rig immediately while retaining reaction variant cursors', () => {
    const c = new RiveMotionClock(
      {
        idle: [{ value: 0, durationMs: 100 }],
        resting: [
          { value: 1, durationMs: 100, role: 'intro' },
          { value: 2, durationMs: 100 },
          { value: 3, durationMs: 9000, role: 'outro' },
        ],
        poked: [
          { value: 4, durationMs: 100 },
          { value: 5, durationMs: 100 },
        ],
      },
      () => 0,
      true,
    );
    c.step('idle', 0, 0);
    expect(c.step('idle', 0.11, 110)?.value).toBe(1);
    expect(c.step('poked', 0, 111)?.value).toBe(4);
    expect(c.step('poked', 0, 112, true)?.value).toBe(5);
  });
});
