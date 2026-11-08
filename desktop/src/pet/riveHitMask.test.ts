import { describe, expect, it } from 'vitest';
import { RiveHitMask, type RiveHitMaskData } from './riveHitMask';
import { parseManifest } from './packs';

const mask = { width: 4, height: 4, clips: { 0: 'YAY=', 1: 'kAk=' } };

describe('baked Rive grab masks', () => {
  it('accepts body cells synchronously on the first lookup and preserves transparent corners', () => {
    const hit = new RiveHitMask(mask);
    for (let i = 0; i < 100; i++) {
      expect(hit.contains(0.3, 0.3, 0)).toBe(true);
      expect(hit.contains(0.01, 0.01, 0)).toBe(false);
      expect(hit.contains(0.99, 0.99, 0)).toBe(false);
    }
    expect(hit.contains(0.01, 0.3, 0)).toBe(false);
    expect(hit.contains(0.01, 0.3, 1)).toBe(true);
    // An exit can display either material; never rely on a stale destination mask.
    expect(hit.contains(0.01, 0.3)).toBe(true);
    expect(hit.contains(-0.01, 0.3)).toBe(false);
    expect(hit.contains(1, 0.3)).toBe(false);
    expect(hit.contains(NaN, 0.3)).toBe(false);
  });

  it('rejects malformed dimensions, clip keys and truncated planes at import', () => {
    const invalidMasks: RiveHitMaskData[] = [
      { ...mask, width: 0 },
      { ...mask, height: 65 },
      { ...mask, clips: {} },
      { ...mask, clips: { '../0': 'YAY=' } },
      { ...mask, clips: { 0: '@@' } },
      { ...mask, clips: { 0: 'YA==' } },
      { ...mask, clips: { 0: 'AAA=' } },
    ];
    for (const invalid of invalidMasks) {
      expect(() => new RiveHitMask(invalid)).toThrow();
      expect(() => parse(invalid)).toThrow('Rive hit mask');
    }
    expect(parse(mask).remoteCodex?.rive?.hitMask).toEqual(mask);
  });

  it('uses reaction extensions only in the union and rounds native regions outward', () => {
    const hit = new RiveHitMask({ ...mask, extra: 'AQA=' });
    expect(hit.contains(0.01, 0.01, 0)).toBe(false);
    expect(hit.contains(0.01, 0.01)).toBe(true);
    const boxes = hit.rectangles({ x: 0, y: 0, width: 101, height: 103 }, 0);
    expect(boxes).toEqual([
      { x: 25, y: 25, width: 51, height: 27 },
      { x: 25, y: 51, width: 51, height: 27 },
    ]);
  });
});

function parse(hitMask: unknown) {
  return parseManifest(
    Buffer.from(
      JSON.stringify({
        id: 'mask-fixture',
        displayName: 'Mask fixture',
        description: '',
        spritesheetPath: 'spritesheet.png',
        remoteCodex: {
          rive: { path: 'pet.riv', artboard: 'Pet', stateMachine: 'Pet', hitMask },
        },
      }),
    ),
  );
}
