import { describe, it, expect } from 'vitest';
import { parseManifest, importPetPack, loadPetPack, MAX_RIVE_BYTES } from './packs';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const manifest = {
  id: 'rive-fixture',
  displayName: 'Rive',
  description: '',
  spritesheetPath: 'spritesheet.png',
  remoteCodex: { rive: { path: 'pet.riv', artboard: 'Pet', stateMachine: 'Pet' } },
};
describe('Rive pack import', () => {
  it('validates event-specific exit banks against routed destinations', () => {
    const exits = {
      everyMs: 100,
      durationMs: 800,
      animationPrefix: 'lower-',
      end: 'rest',
      responses: [{ targets: [0], animationPrefix: 'startle-' }],
    };
    const parse = (value: unknown) => parseManifest(Buffer.from(JSON.stringify({
      ...manifest,
      remoteCodex: { rive: {
        ...manifest.remoteCodex.rive,
        motions: { idle: [{ value: 0, durationMs: 1000 }] },
        routing: {
          bridges: [],
          clips: [{ value: 0, animation: 'idle', durationMs: 1000, start: 'rest', end: 'rest', exits: value }],
        },
      } },
    })));
    expect(parse(exits).remoteCodex?.rive?.routing?.clips[0].exits).toEqual(exits);
    expect(parse({ ...exits, everyMs: 50 }).remoteCodex?.rive?.routing?.clips[0].exits?.everyMs)
      .toBe(50);
    for (const everyMs of [0, 25, 49, 1001, null]) {
      expect(() => parse({ ...exits, everyMs })).toThrow('authored exits');
    }
    expect(parse({ ...exits, sourcePose: true }).remoteCodex?.rive?.routing?.clips[0].exits?.sourcePose)
      .toBe(true);
    expect(() => parse({ ...exits, sourcePose: 1 })).toThrow('authored exits');
    for (const responses of [
      {},
      [null],
      [{ targets: [], animationPrefix: 'startle-' }],
      [{ targets: [99], animationPrefix: 'startle-' }],
      [{ targets: [0], animationPrefix: '' }],
    ]) expect(() => parse({ ...exits, responses })).toThrow('authored exits');
  });

  it('keeps validated drawing dissolves and rejects invalid or unrouted windows', () => {
    const routing = {
      bridges: [],
      clips: [{ value: 0, animation: 'idle', durationMs: 1000, start: 'rest', end: 'rest' }],
    };
    const dissolves = {
      stateMs: 450,
      bedMs: 550,
      clips: [{ value: 0, windows: [{ atMs: 500, durationMs: 350, regions: [[0, 0, 1, 1]] }] }],
    };
    const parse = (route: unknown, fades: unknown) =>
      parseManifest(Buffer.from(JSON.stringify({
        ...manifest,
        remoteCodex: { rive: {
          ...manifest.remoteCodex.rive,
          motions: { idle: [{ value: 0, durationMs: 1000 }] },
          routing: route,
          dissolves: fades,
        } },
      })));
    expect(parse(routing, dissolves).remoteCodex?.rive?.dissolves).toEqual(dissolves);
    expect(() => parse(undefined, dissolves)).toThrow('dissolves');
    expect(() => parse(routing, { ...dissolves, stateMs: 5000 })).toThrow('dissolves');
    expect(() => parse(routing, {
      ...dissolves,
      clips: [{ value: 99, windows: [] }],
    })).toThrow('dissolves');
  });
  it('does not require obsolete frame-rate or exit-speed settings', () => {
    const rive = {
      ...manifest.remoteCodex.rive,
      procedural: { bodyBone: 'body' },
      motions: { idle: [{ value: 0, durationMs: 1000 }] },
      routing: {
        bridges: [],
        clips: [{ value: 0, animation: 'idle', durationMs: 1000, start: 'rest', end: 'rest' }],
      },
    };
    const parse = (config: unknown) =>
      parseManifest(Buffer.from(JSON.stringify({ ...manifest, remoteCodex: { rive: config } })));
    expect(parse(rive).remoteCodex?.rive).toEqual(rive);
    expect(() => parse({ ...rive, procedural: { bodyBone: 'body', idleFps: 0 } })).toThrow();
    expect(() => parse({ ...rive, routing: { ...rive.routing, maxExitMs: 0 } })).toThrow();
  });
  it('rejects unsafe paths, missing selectors and unsupported ViewModel declarations', () => {
    for (const rive of [
      { ...manifest.remoteCodex.rive, path: '../pet.riv' },
      { ...manifest.remoteCodex.rive, artboard: '' },
      { ...manifest.remoteCodex.rive, viewModel: 'Pet' },
    ])
      expect(() =>
        parseManifest(Buffer.from(JSON.stringify({ ...manifest, remoteCodex: { rive } }))),
      ).toThrow('remoteCodex.rive');
    expect(parseManifest(Buffer.from(JSON.stringify(manifest))).remoteCodex?.rive).toEqual(
      manifest.remoteCodex.rive,
    );
  });
  it('requires runtime verification before creating or replacing the installed pack', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rive-import-')),
      source = join(root, 'source'),
      dest = join(root, 'pets');
    try {
      await mkdir(source);
      await writeFile(join(source, 'pet.json'), JSON.stringify(manifest));
      await writeFile(
        join(source, 'spritesheet.png'),
        await readFile('test/fixtures/pets/placeholder/spritesheet.png'),
      );
      await writeFile(join(source, 'pet.riv'), Buffer.from('RIVE\x07\x00\x00\x00'));
      await expect(importPetPack(source, dest)).rejects.toThrow('isolated runtime');
      await expect(
        importPetPack(source, dest, undefined, [], async () => {
          throw new Error('Missing state machine: Pet');
        }),
      ).rejects.toThrow('Missing state machine');
      await expect(access(join(dest, manifest.id))).rejects.toThrow();
      await truncate(join(source, 'pet.riv'), MAX_RIVE_BYTES + 1);
      await expect(importPetPack(source, dest, undefined, [], async () => undefined)).rejects.toThrow(
        'size limit',
      );
      await writeFile(join(source, 'pet.riv'), Buffer.from('RIVE\x07\x00\x00\x00'));
      await writeFile(join(source, 'extra.txt'), 'unexpected');
      await expect(importPetPack(source, dest, undefined, [], async () => undefined)).rejects.toThrow(
        'only pet.json',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('reloads a routing manifest whose pretty-printed form exceeds the input cap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rive-large-manifest-'));
    const source = join(root, 'source');
    const destination = join(root, 'pets');
    const clips = Array.from({ length: 100 }, (_, value) => ({
      value,
      animation: `motion-${value}`,
      durationMs: 1000,
      start: 'rest',
      end: 'rest',
    }));
    const large = {
      ...manifest,
      remoteCodex: {
        rive: {
          ...manifest.remoteCodex.rive,
          motions: { idle: [{ value: 0, durationMs: 1000 }] },
          routing: { maxExitMs: 350, bridges: [], clips },
        },
      },
    };
    const compact = JSON.stringify(large);
    expect(Buffer.byteLength(compact)).toBeLessThan(16 * 1024);
    expect(Buffer.byteLength(JSON.stringify(large, null, 2))).toBeGreaterThan(16 * 1024);
    try {
      await mkdir(source);
      await writeFile(join(source, 'pet.json'), compact);
      await writeFile(join(source, 'pet.riv'), Buffer.from('RIVE\x07\x00\x00\x00'));
      await writeFile(
        join(source, 'spritesheet.png'),
        await readFile('test/fixtures/pets/placeholder/spritesheet.png'),
      );
      const installed = await importPetPack(source, destination, undefined, [], async () => {});
      const reloaded = await loadPetPack(installed.directory);
      expect(reloaded.manifest.remoteCodex?.rive?.routing?.clips).toHaveLength(100);
      expect((await readFile(join(installed.directory, 'pet.json'))).length).toBeLessThan(16 * 1024);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('validates source resolution caps and connected rest routes', () => {
    const route = {
      maxExitMs: 350,
      bridges: [1, 2],
      clips: [
        { value: 0, animation: 'idle', durationMs: 1000, start: 'rest', end: 'rest' },
        { value: 1, animation: 'in', durationMs: 1000, start: 'rest', end: 'bed' },
        { value: 2, animation: 'out', durationMs: 1000, start: 'bed', end: 'rest' },
      ],
    };
    const parse = (routing: unknown, backing: unknown = { width: 648, height: 702, scale: 1 }) =>
      parseManifest(
        Buffer.from(
          JSON.stringify({
            ...manifest,
            remoteCodex: {
              rive: {
                ...manifest.remoteCodex.rive,
                motions: { idle: [{ value: 0, durationMs: 1000 }] },
                routing,
                backing,
              },
            },
          }),
        ),
      );
    expect(parse(route).remoteCodex?.rive?.routing).toEqual(route);
    const reaction = { clips: [2], targets: [0], animation: 'local-startle', durationMs: 800, settleMs: 100 };
    expect(parse({ ...route, reactions: [reaction] }).remoteCodex?.rive?.routing?.reactions).toEqual([
      reaction,
    ]);
    const resident = { ...reaction, resumeValue: 2, resumeTargets: [0, 2] };
    const drawings = [
      { atMs: 0, animation: 'first' },
      { atMs: 500, animation: 'second' },
    ];
    expect(
      parse({ ...route, reactions: [{ ...reaction, drawings }] }).remoteCodex?.rive?.routing?.reactions?.[0]
        .drawings,
    ).toEqual(drawings);
    for (const bad of [
      [],
      [{ atMs: -1, animation: 'x' }],
      [{ atMs: 0, animation: '' }],
      [drawings[0], drawings[0]],
      [{ atMs: 999999, animation: 'x' }],
    ]) {
      expect(() => parse({ ...route, reactions: [{ ...reaction, drawings: bad }] })).toThrow(
        'reaction drawings',
      );
    }
    expect(parse({ ...route, reactions: [resident] }).remoteCodex?.rive?.routing?.reactions).toEqual([
      resident,
    ]);
    for (const bad of [
      { ...resident, resumeValue: 99 },
      { ...resident, resumeTargets: [] },
      { ...resident, resumeTargets: [99] },
      { ...reaction, resumeTargets: [0] },
    ]) {
      expect(() => parse({ ...route, reactions: [bad] })).toThrow('pose reaction');
    }
    expect(
      parse({
        ...route,
        clips: route.clips.map((c) => ({ ...c, nativeExit: true })),
      }).remoteCodex?.rive?.routing?.clips.every((c) => c.nativeExit),
    ).toBe(true);
    expect(
      parse({
        ...route,
        clips: route.clips.map((c) => ({ ...c, nativeExit: 'nearest' })),
      }).remoteCodex?.rive?.routing?.clips.every((c) => c.nativeExit === 'nearest'),
    ).toBe(true);
    expect(() => parse({ ...route, clips: route.clips.map((c) => ({ ...c, nativeExit: 'yes' })) })).toThrow(
      'routing',
    );
    for (const bad of [
      { ...reaction, clips: [99] },
      { ...reaction, targets: [] },
      { ...reaction, settleMs: 0 },
      { ...reaction, durationMs: Infinity },
      { ...reaction, animation: '' },
    ])
      expect(() => parse({ ...route, reactions: [bad] })).toThrow('pose reaction');
    for (const q of [
      { ...route, maxExitMs: 800 },
      { ...route, bridges: [99] },
      { ...route, bridges: [1] },
      { ...route, clips: [...route.clips, route.clips[0]] },
    ])
      expect(() => parse(q)).toThrow('routing');
    expect(() => parse(route, { width: 648, height: 702, scale: 2 })).toThrow('backing');
    for (const exitRestMs of [
      { start: 501, end: 0 },
      { start: -1, end: 0 },
      { start: 0, end: null },
    ])
      expect(() => parse({ ...route, clips: route.clips.map((c) => ({ ...c, exitRestMs })) })).toThrow(
        'exit rest',
      );
    expect(() => parse({ ...route, clips: route.clips.map((c) => ({ ...c, exitAnimation: '' })) })).toThrow(
      'exit animation',
    );
  });
  it('validates and preserves optional procedural settings', () => {
    const parse = (procedural: unknown) =>
      parseManifest(
        Buffer.from(
          JSON.stringify({
            ...manifest,
            remoteCodex: { rive: { ...manifest.remoteCodex.rive, procedural } },
          }),
        ),
      );
    const valid = { bodyBone: 'body', idleFps: 24, activeFps: 60, eyeOpen: true, transientFace: true };
    expect(parse(valid).remoteCodex?.rive?.procedural).toEqual(valid);
    for (const invalid of [
      null,
      {},
      { ...valid, bodyBone: '' },
      { ...valid, idleFps: 60 },
      { ...valid, activeFps: 24 },
    ])
      expect(() => parse(invalid)).toThrow('procedural');
    expect(() => parse({ ...valid, eyeOpen: 'yes' })).toThrow('eyeOpen');
    expect(() => parse({ ...valid, sourceFps: 24 })).toThrow('sourceFps');
    expect(() => parse({ ...valid, transientFace: 'yes' })).toThrow('transientFace');
    expect(() => parse({ ...valid, eyeOpen: false })).toThrow('transientFace');
    expect(
      parse({ ...valid, eyeOpen: false, transientFace: false }).remoteCodex?.rive?.procedural?.transientFace,
    ).toBe(false);
  });
  it('permits source cadence only for connected routed drawings', () => {
    const rive = {
      ...manifest.remoteCodex.rive,
      procedural: { bodyBone: 'body', idleFps: 24, activeFps: 60, sourceFps: 24 },
      motions: { idle: [{ value: 0, durationMs: 1000 }] },
      routing: {
        maxExitMs: 350,
        bridges: [],
        clips: [{ value: 0, animation: 'idle', durationMs: 1000, start: 'rest', end: 'rest' }],
      },
    };
    const parse = (sourceFps: unknown) =>
      parseManifest(
        Buffer.from(
          JSON.stringify({
            ...manifest,
            remoteCodex: { rive: { ...rive, procedural: { ...rive.procedural, sourceFps } } },
          }),
        ),
      );
    expect(parse(24).remoteCodex?.rive?.procedural?.sourceFps).toBe(24);
    expect(parse(30).remoteCodex?.rive?.procedural?.sourceFps).toBe(30);
    for (const v of [0, 60, '24', null]) expect(() => parse(v)).toThrow('sourceFps');
  });
});
