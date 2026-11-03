import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { PNG } from 'pngjs';
import type { ActivityEvent, ActivityItem } from '../shared/contract';
import { ANIMATIONS, frameAt, moodFor } from './animation';
import { scrollGeometry } from './scroll';
import { BUBBLE_MS, BubbleQueue } from './bubbles';
import { DEFAULT_FACE_BOX, dockTilt, HEAD_PEEK, clampRect, CONTROLS_CLEARANCE, defaultPosition, dockPosition, exposedRect, petLayout, restorePosition, surfaceLayout, surfaceSide } from './geometry';
import { importPetPack, loadPetPack, MAX_PACK_BYTES, parseManifest, readClip, unpackPetZip, validateAtlas } from './packs';
const item = (state: ActivityItem['state'], key = 'd:t'): ActivityItem => ({ key, deviceId: 'd', deviceName: 'Mac', workspaceId: 'w', workspaceLabel: 'Project', threadId: key, title: 'Build', state, since: new Date(0).toISOString(), unread: true });
const event = (type: ActivityEvent['type'], key = 'd:t', id = key): ActivityEvent => ({ type, alertId: id, item: item(type === 'started' ? 'running' : type === 'resolved' ? 'idle' : type, key), at: new Date(0).toISOString() });
function crc32(bytes: Buffer): number { let c = -1; for (const byte of bytes) { c ^= byte; for (let i = 0; i < 8; i++) c = c >>> 1 ^ (0xedb88320 & -(c & 1)); } return (c ^ -1) >>> 0; }
function zip(files: { name: string; data: Buffer; mode?: number }[]): Buffer {
  const local: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name), compressed = deflateRawSync(file.data), header = Buffer.alloc(30), record = Buffer.alloc(46), crc = crc32(file.data);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(8, 8); header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(file.data.length, 22); header.writeUInt16LE(name.length, 26);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(0x314, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(8, 10); record.writeUInt32LE(crc, 16); record.writeUInt32LE(compressed.length, 20); record.writeUInt32LE(file.data.length, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(((file.mode ?? 0x81a4) << 16) >>> 0, 38); record.writeUInt32LE(offset, 42);
    local.push(header, name, compressed); central.push(record, name); offset += header.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
describe('state priority and official timings', () => {
  it('uses only waiting, running and idle as sustained activity poses', () => {
    expect(moodFor([item('running')])).toBe('running'); expect(moodFor([item('running')], { completion: 'waving' })).toBe('running');
    expect(moodFor([item('failed')], { completion: 'jumping' })).toBe('idle'); expect(moodFor([item('needsInput'), item('failed')])).toBe('waiting');
    expect(moodFor([item('completed')])).toBe('idle'); expect(moodFor([], { snoozed: true })).toBe('sleeping'); expect(moodFor([item('running')], { reviewing: true })).toBe('running');
  });
  it('uses exact boundaries, final holds, looping and reduced motion', () => {
    expect(frameAt('idle', 279)).toBe(0); expect(frameAt('idle', 280)).toBe(1); expect(frameAt('waving', 699)).toBe(3); expect(frameAt('waving', 700)).toBe(0); expect(frameAt('running-left', 1000, true)).toBe(0); expect(ANIMATIONS['running-right'].durations).toHaveLength(8);
  });
});
describe('bubble delivery', () => {
  it('deduplicates alert ids and limits a thread to once per 30 seconds', () => {
    const q = new BubbleQueue(); expect(q.push(event('completed'), 0)).toBe(true); expect(q.push(event('completed'), 1000)).toBe(false); expect(q.push(event('needsInput', 'd:t', 'request'), 29000)).toBe(false); expect(q.push(event('needsInput', 'd:t', 'request2'), 30000)).toBe(true); expect(q.current?.sticky).toBe(true);
  });
  it('coalesces completion bursts, expires only after display and keeps attention sticky', () => {
    const q = new BubbleQueue(); q.push(event('needsInput', 'a'), 0); q.push(event('completed', 'b'), 200); q.push(event('completed', 'c'), 800);
    expect(q.pending).toHaveLength(2); expect(q.pending[1].events).toHaveLength(2); q.tick(20000); expect(q.pending).toHaveLength(2); q.acknowledge('a', 20000); expect(q.current?.shownAt).toBe(20000); q.tick(49999); expect(q.current).not.toBeNull(); q.tick(50000); expect(q.current).toBeNull();
  });
  it('holds a bubble while the pointer stays near it', () => {
    const q = new BubbleQueue(); q.push(event('completed', 'a'), 0); q.tick(0);
    q.hold(BUBBLE_MS - 1); q.tick(BUBBLE_MS + 1000); expect(q.current).not.toBeNull();
    q.tick(BUBBLE_MS * 2 - 2); expect(q.current).not.toBeNull(); q.tick(BUBBLE_MS * 2 - 1); expect(q.current).toBeNull();
  });
  it('synchronizes acknowledgement and resolved requests', () => {
    const q = new BubbleQueue(); q.push(event('completed', 'a'), 0); q.push(event('completed', 'b'), 10); q.acknowledge('a', 100); expect(q.current?.events.map((e) => e.alertId)).toEqual(['b']); q.push(event('needsInput', 'c'), 200); q.resolve('c', 300); expect(q.current?.sticky).toBe(false);
  });
});
describe('display and dock geometry', () => {
  it('keeps a visible surface on its side when it grows, so hovering cannot flip it away', () => {
    const area = { x: 0, y: 0, width: 1000, height: 800 }, sprite = { x: 400, y: 600, width: 118, height: 128 };
    expect(surfaceSide(sprite, area, 36)).toBe('below');
    expect(surfaceSide(sprite, area, 110)).toBe('above');
    const grown = surfaceLayout(sprite, area, 258, 110, 'below');
    expect(grown.y + grown.height).toBeLessThanOrEqual(800); expect(grown.y).toBeGreaterThan(sprite.y);
  });
  it('keeps the control capsule under the sprite, also on the right and bottom edges', () => {
    const area = { x: 0, y: 0, width: 1000, height: 800 };
    const sprite = { x: 400, y: 300, width: 128, height: 140 };
    expect(surfaceLayout(sprite, area, 132, 36).y).toBe(sprite.y + sprite.height + 6);
    const right = surfaceLayout({ ...sprite, x: 872 }, area, 132, 36);
    expect(right.y).toBeGreaterThanOrEqual(sprite.y + sprite.height); expect(right.x + right.width).toBeLessThanOrEqual(1000);
    expect(surfaceLayout({ ...sprite, y: 700 }, area, 132, 36).y + 36).toBeLessThanOrEqual(700);
    const docked = dockPosition({ x: 500, y: 790, displayId: 1, edge: null }, area, 140);
    if (docked.edge === 'left' || docked.edge === 'right' || !docked.edge) expect(docked.y + 140 + CONTROLS_CLEARANCE).toBeLessThanOrEqual(800);
  });
  const area = { x: -1440, y: 40, width: 1440, height: 860 }, primary = { id: 1, workArea: { x: 0, y: 38, width: 1512, height: 906 } };
  it('hovers a tucked pet only on its exposed strip', () => {
    const w = { x: 100, y: 100, width: 100, height: 100 };
    expect(exposedRect(w, 'left')).toEqual({ x: 100, y: 100, width: 25, height: 100 });
    expect(exposedRect(w, 'right')).toEqual({ x: 175, y: 100, width: 25, height: 100 });
    expect(exposedRect(w, 'top')).toEqual({ x: 100, y: 100, width: 100, height: 25 });
    expect(exposedRect(w, 'bottom')).toEqual({ x: 100, y: 175, width: 100, height: 25 });
  });
  it.each(['left', 'right', 'top', 'bottom'] as const)('docks %s when the drag overshoots the edge', (edge) => {
    const width = 128 * 192 / 208, p = { displayId: 2, x: area.x + 300, y: area.y + 300, edge: null };
    if (edge === 'left') p.x = area.x - 400; if (edge === 'right') p.x = area.x + area.width - width + 400; if (edge === 'top') p.y = area.y - 400; if (edge === 'bottom') p.y = area.y + area.height - 128 + 400;
    const docked = dockPosition(p, area, 128);
    expect(docked.edge).toBe(edge);
    expect(clampRect({ ...docked, width, height: 128 }, area)).toMatchObject({ x: docked.x, y: docked.y });
  });
  it.each(['left', 'right', 'top', 'bottom'] as const)('snaps %s within 24px', (edge) => {
    const p = { displayId: 2, x: -1200, y: 300, edge: null }, width = 128 * 192 / 208;
    if (edge === 'left') p.x = area.x + 23; if (edge === 'right') p.x = area.x + area.width - width - 23; if (edge === 'top') p.y = area.y + 23; if (edge === 'bottom') p.y = area.y + area.height - 128 - 23;
    expect(dockPosition(p, area, 128).edge).toBe(edge);
  });
  it('clamps overlays to work areas including menu/notch/taskbar insets', () => {
    const p = dockPosition({ displayId: 2, x: -1440, y: 50, edge: null }, area, 160), r = petLayout(p, area, 160, { panel: true, bubble: true, chat: true, mini: false, peek: false });
    expect(r.window.x).toBeGreaterThanOrEqual(area.x); expect(r.window.y).toBeGreaterThanOrEqual(area.y); expect(r.window.x + r.window.width).toBeLessThanOrEqual(area.x + area.width); expect(r.window.y + r.window.height).toBeLessThanOrEqual(area.y + area.height); expect(r.pet.x).toBeLessThan(0); expect(r.window.width).toBe(Math.round(160 * 192 / 208));
    expect(clampRect({ x: -5, y: -8, width: 1000, height: 1000 }, { x: 0, y: 38, width: 320, height: 500 })).toEqual({ x: 0, y: 38, width: 320, height: 500 });
  });
  it('restores per display and falls back after hot-unplug', () => {
    const p = { displayId: 2, x: -1300, y: 200, edge: null }; expect(restorePosition(p, [primary, { id: 2, workArea: area }], primary, 128)).toEqual(p); expect(restorePosition(p, [primary], primary, 128)).toEqual(defaultPosition(primary, 128));
  });
});
describe('pack validation and safe import', () => {
  const fixture = fileURLToPath(new URL('../../test/fixtures/pets/placeholder/', import.meta.url));
  it('imports WebM and optional peek from ZIP, replaces atomically, and rejects renamed container bytes', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'pet-media-zip-'));
    try {
      // EBML structure is tested independently; native CI uses a real generated VP9 clip.
      const { structuralVideo } = await import('./mediaFixture');
      const image = await readFile(join(fixture, 'spritesheet.png'));
      const peek = PNG.sync.write(new PNG({ width: 32, height: 32 }));
      const manifest = { id: 'media-zip', displayName: 'Media', description: '', spritesheetPath: 'spritesheet.png', remoteCodex: {
        clipFormat: { mediaType: 'webm-vp9-alpha', fps: 24, columns: 1, width: 648, height: 702 },
        clips: { idle: [{ path: 'clips/a.webm', frames: 48 }] },
        peek: { path: 'peek.png', width: 32, height: 32, anchor: [.9,.6], headHeight: .6, bounds: [0,0,1,1] },
      } };
      const files = (video: Buffer) => [{ name: 'pet.json', data: Buffer.from(JSON.stringify(manifest)) }, { name: 'spritesheet.png', data: image }, { name: 'peek.png', data: peek }, { name: 'clips/a.webm', data: video }];
      const source = join(temp,'pack.zip'); await writeFile(source,zip(files(structuralVideo())));
      const imported = await importPetPack(source,join(temp,'pets'));
      expect(imported.peekImage).toEqual(peek); expect(await readClip(imported,'clips/a.webm')).toEqual(structuralVideo());
      await writeFile(source,zip(files(Buffer.from('a WebP renamed as video'))));
      await expect(importPetPack(source,join(temp,'pets'))).rejects.toThrow('WebM');
      expect(await readFile(join(imported.directory,'clips/a.webm'))).toEqual(structuralVideo());
      await writeFile(source,zip(files(structuralVideo()).filter(f=>f.name!=='peek.png')));
      await expect(importPetPack(source,join(temp,'pets'))).rejects.toThrow('peek');
    } finally { await rm(temp,{recursive:true,force:true}); }
  });
  it('accepts a good v1 and v2 atlases and rejects dimensions, unsupported versions, formats and limits', async () => {
    const p = await loadPetPack(fixture); expect(p.manifest.id).toBe('placeholder'); const wrong = Buffer.from(p.image); wrong.writeUInt32BE(1760, 20); expect(() => validateAtlas(wrong, p.manifest)).toThrow('1536×1872'); expect(() => validateAtlas(Buffer.alloc(MAX_PACK_BYTES + 1), p.manifest)).toThrow('8 MB'); expect(() => validateAtlas(Buffer.from('fake'), p.manifest)).toThrow('PNG or WebP'); expect(parseManifest(Buffer.from(JSON.stringify({ ...p.manifest, spriteVersionNumber: 2 }))).spriteVersionNumber).toBe(2); expect(() => parseManifest(Buffer.from(JSON.stringify({ ...p.manifest, spriteVersionNumber: 3 })))).toThrow('spriteVersionNumber'); expect(() => parseManifest(Buffer.from(JSON.stringify({ ...p.manifest, spritesheetPath: '../outside.png' })))).toThrow('spritesheetPath');
  });
  it.each(['../outside', '/absolute', 'C:/windows', 'folder/../../outside', 'folder\\outside'])('rejects zip traversal %s', (name) => { expect(() => unpackPetZip(zip([{ name, data: Buffer.from('x') }]))).toThrow('unsafe zip path'); });
  it('rejects Windows aliases, drive-relative paths and backslashes before extracting', () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    try {
      for (const name of ['C:pet.json', 'C:/pet.json', 'folder\\pet.json', '//server/share/pet.json', 'CON/pet.json', 'pack./pet.json', 'pack /pet.json', 'clips/aux.webp', 'file:stream'])
        expect(() => unpackPetZip(zip([{ name, data: Buffer.from('x') }]))).toThrow('unsafe zip path');
    } finally { vi.unstubAllGlobals(); }
  });
  it('rejects symlinks, duplicates, corrupt zips and decompression bombs', () => {
    expect(() => unpackPetZip(zip([{ name: 'pet.json', data: Buffer.from('target'), mode: 0xa1ff }]))).toThrow('symlinks'); expect(() => unpackPetZip(zip([{ name: 'x', data: Buffer.alloc(1) }, { name: 'x', data: Buffer.alloc(1) }]))).toThrow('duplicate'); expect(() => unpackPetZip(Buffer.from('bad zip'))).toThrow('end record'); expect(() => unpackPetZip(zip([{ name: 'x', data: Buffer.alloc(MAX_PACK_BYTES + 1) }]))).toThrow('size limit');
  });
  it('imports frost as a user pack while refusing the only built-in id moe', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'pet-import-frost-'));
    try {
      const image = await readFile(join(fixture, 'spritesheet.png'));
      const original = JSON.parse(await readFile(join(fixture, 'pet.json'), 'utf8'));
      const source = join(temp, 'pack.zip'), pets = join(temp, 'pets');
      for (const id of ['frost', 'gpt-dragon', 'unknown-user-pack', 'moe']) {
        await writeFile(source, zip([{ name: 'pet.json', data: Buffer.from(JSON.stringify({ ...original, id })) }, { name: 'spritesheet.png', data: image }]));
        if (id === 'moe') await expect(importPetPack(source, pets, undefined, ['moe'])).rejects.toThrow('built in');
        else {
          expect((await importPetPack(source, pets, undefined, ['moe'])).manifest.id).toBe(id);
          expect((await importPetPack(source, pets, undefined, ['moe'])).manifest.id).toBe(id);
          expect((await loadPetPack(join(pets, id))).manifest.id).toBe(id);
        }
      }
    } finally { await rm(temp, { recursive: true, force: true }); }
  });
  it('imports a nested zip atomically, replaces on a repeat, and refuses symlink folders', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'pet-test-'));
    try { const image = await readFile(join(fixture, 'spritesheet.png')), manifest = await readFile(join(fixture, 'pet.json')), source = join(temp, 'pack.zip'); await writeFile(source, zip([{ name: 'little/pet.json', data: manifest }, { name: 'little/spritesheet.png', data: image }])); const imported = await importPetPack(source, join(temp, 'pets')); expect(await readFile(join(imported.directory, 'spritesheet.png'))).toEqual(image); await expect(importPetPack(source, join(temp, 'pets'))).resolves.toBeTruthy(); await symlink(fixture, join(temp, 'link'), process.platform === 'win32' ? 'junction' : 'dir'); await expect(loadPetPack(join(temp, 'link'))).rejects.toThrow('regular directory'); } finally { await rm(temp, { recursive: true, force: true }); }
  });
});

describe('interaction regressions', () => {
  it('resumes a completion bubble after sticky attention preempts it', () => {
    const queue = new BubbleQueue(); queue.push(event('completed', 'done'), 0); queue.push(event('needsInput', 'approval'), 500); queue.resolve('approval', 20000); expect(queue.current?.shownAt).toBe(20000); queue.tick(25999); expect(queue.current).not.toBeNull();
  });
  it('uses a stable expansion side and shrinks the tray near the screen center', () => {
    const area = { x: 0, y: 38, width: 1512, height: 906 }, position = { displayId: 1, x: 700, y: 470, edge: null };
    const before = petLayout(position, area, 128, { panel: true, bubble: true, chat: true, mini: false, peek: true });
    const after = petLayout(position, area, 128, { panel: true, bubble: true, chat: true, mini: false, peek: true, measured: { tray: 330, bubble: 84, chat: 88 } });
    expect(before.panelAbove).toBe(after.panelAbove); expect(after.panelHeight).toBeLessThan(330); expect(before.window).toEqual(after.window); expect(after.window.y).toBeGreaterThanOrEqual(area.y);
  });
  it('reanchors docked positions when the work area changes and rejects corrupt saved coordinates', () => {
    const display = { id: 1, workArea: { x: 0, y: 38, width: 1512, height: 906 } };
    expect(restorePosition({ displayId: 1, x: 900, y: 400, edge: 'right' }, [display], display, 128).x).toBe(1512 - 128 * 192 / 208);
    expect(restorePosition({ displayId: 1, x: NaN, y: 400, edge: null }, [display], display, 128)).toEqual(defaultPosition(display, 128));
  });
  it('accepts the final WebP atlas and the optional original sleeping strip', async () => {
    const pack = await loadPetPack(fileURLToPath(new URL('../../assets/pets/moe/', import.meta.url))); expect(pack.manifest.id).toBe('moe'); expect(pack.sleepingImage?.length).toBeGreaterThan(0); expect(pack.manifest.remoteCodex?.sleeping?.frames).toBe(4);
  });
  it('refuses a header-valid image if the pixel decoder rejects it, before installing anything', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'pet-decode-'));
    try { const source = fileURLToPath(new URL('../../test/fixtures/pets/placeholder/', import.meta.url)); await expect(importPetPack(source, join(temp, 'pets'), undefined, ['placeholder'])).rejects.toThrow('built in'); await expect(importPetPack(source, join(temp, 'pets'), () => false)).rejects.toThrow('cannot decode'); await expect(access(join(temp, 'pets', 'placeholder'))).rejects.toThrow(); } finally { await rm(temp, { recursive: true, force: true }); }
  });
});

describe('custom task scrollbar', () => {
  it('hides the thumb and fades for content that fits', () => {
    expect(scrollGeometry(300, 200, 0, 280)).toMatchObject({ overflowing: false, atStart: true, atEnd: true, thumbSize: 280 });
  });
  it('maps scroll offset to proportional thumb travel and visible clipping affordances', () => {
    const middle = scrollGeometry(240, 960, 360, 224); expect(middle).toMatchObject({ maximum: 720, thumbSize: 56, thumbOffset: 84, atStart: false, atEnd: false });
    expect(scrollGeometry(240, 960, 0, 224).atStart).toBe(true); expect(scrollGeometry(240, 960, 720, 224).atEnd).toBe(true);
  });
  it('clamps overscroll and keeps a usable thumb without leaving tiny tracks', () => {
    expect(scrollGeometry(200, 10000, -20, 184)).toMatchObject({ offset: 0, thumbSize: 24, thumbOffset: 0 });
    expect(scrollGeometry(200, 10000, 12000, 184)).toMatchObject({ offset: 9800, thumbOffset: 160 });
    expect(scrollGeometry(1, 100, 20, 12).thumbSize).toBe(12);
  });
  it('does not use unread interruptions as a persistent failure pose', () => {
    expect(moodFor([item('interrupted'), item('running')])).toBe('running'); expect(moodFor([item('interrupted'), item('needsInput')])).toBe('waiting');
  });
});

describe('v3 atlas and fixed-window regressions', () => {
  it('validates clip manifests and rejects paths outside the clips folder', () => {
    const base = { id: 'p', displayName: 'P', description: '', spritesheetPath: 'spritesheet.webp' };
    const manifest = (clips: unknown, clipFormat: unknown = { fps: 12, columns: 12, width: 240, height: 260 }): Buffer => Buffer.from(JSON.stringify({ ...base, remoteCodex: { clipFormat, clips } }));
    expect(parseManifest(manifest({ running: [{ path: 'clips/work.webp', frames: 48 }] })).remoteCodex?.clips?.running?.[0]?.frames).toBe(48);
    for (const bad of [{ running: [{ path: '../secret.webp', frames: 4 }] }, { running: [{ path: 'clips/a/b.webp', frames: 4 }] }, { running: [{ path: 'clips/a.png', frames: 4 }] }, { running: [{ path: 'clips/a.webp', frames: 0 }] }, { other: [{ path: 'clips/a.webp', frames: 4 }] }, { running: [] }]) expect(() => parseManifest(manifest(bad)), JSON.stringify(bad)).toThrow();
    expect(() => parseManifest(manifest({ running: [{ path: 'clips/a.webp', frames: 4 }] }, { fps: 0, columns: 12, width: 240, height: 260 }))).toThrow();
    expect(parseManifest(manifest({ resting: [{ path: 'clips/in.webp', frames: 4, role: 'intro' }, { path: 'clips/on.webp', frames: 4 }] })).remoteCodex?.clips?.resting?.[0]?.role).toBe('intro');
    for (const bad of [{ running: [{ path: 'clips/a.webp', frames: 4, role: 'other' }] }, { running: [{ path: 'clips/a.webp', frames: 4, role: 'intro' }] }, { running: [{ path: 'clips/a.webp', frames: 4, role: 'intro' }, { path: 'clips/b.webp', frames: 4, role: 'intro' }, { path: 'clips/c.webp', frames: 4 }] }]) expect(() => parseManifest(manifest(bad))).toThrow();
    const sized = (sizeScale: unknown): Buffer => Buffer.from(JSON.stringify({ ...base, remoteCodex: { sizeScale } }));
    expect(parseManifest(sized(1.4)).remoteCodex?.sizeScale).toBe(1.4);
    for (const bad of [0.2, 3, 'big']) expect(() => parseManifest(sized(bad)), String(bad)).toThrow('sizeScale');
  });
  it('imports one zip with the whole pet, clips included, and replaces it when imported again', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'pet-zip-'));
    try {
      const fixture = fileURLToPath(new URL('../../assets/pets/moe/', import.meta.url));
      const image = await readFile(join(fixture, 'spritesheet.webp')), strip = await readFile(join(fixture, 'sleeping.webp'));
      // A real WebP header: 4 frames of 192×208 in one row.
      const manifest = (description: string): Buffer => Buffer.from(JSON.stringify({ id: 'custom', displayName: 'Custom', description, spritesheetPath: 'spritesheet.webp', remoteCodex: { clipFormat: { fps: 12, columns: 4, width: 192, height: 208 }, faceBox: [.2, .1, .8, .5], talk: { path: 'clips/talk.webp', frames: 4 }, clips: { running: [{ path: 'clips/work.webp', frames: 4 }] } } }));
      const source = join(temp, 'pet.zip'), pets = join(temp, 'pets');
      const files = (description: string) => [{ name: 'pet.json', data: manifest(description) }, { name: 'spritesheet.webp', data: image }, { name: 'clips/work.webp', data: strip }, { name: 'clips/talk.webp', data: strip }];
      await writeFile(source, zip(files('first')));
      const first = await importPetPack(source, pets, undefined, ['moe']);
      expect(first.manifest.remoteCodex?.clips?.running).toHaveLength(1);
      expect(first.manifest.remoteCodex?.talk?.frames).toBe(4);
      expect((await readClip(first, 'clips/talk.webp'))?.equals(strip)).toBe(true);
      expect((await readFile(join(pets, 'custom/clips/work.webp'))).equals(strip)).toBe(true);
      expect((await loadPetPack(join(pets, 'custom'))).manifest.description).toBe('first');
      await writeFile(source, zip(files('second')));
      await importPetPack(source, pets, undefined, ['moe']);
      expect((await loadPetPack(join(pets, 'custom'))).manifest.description).toBe('second');
      await writeFile(source, zip(files('third').slice(0, 2)));
      await expect(importPetPack(source, pets)).rejects.toThrow('missing clips/work.webp');
      await writeFile(source, zip([...files('third'), { name: 'extra.bin', data: Buffer.from('x') }]));
      await expect(importPetPack(source, pets)).rejects.toThrow('only pet.json');
      expect((await loadPetPack(join(pets, 'custom'))).manifest.description).toBe('second');
    } finally { await rm(temp, { recursive: true, force: true }); }
  });
  it('accepts the v2 layout of imported packs without adding look slots to animation loops', async () => {
    const pack = await loadPetPack(fileURLToPath(new URL('../../assets/pets/moe/', import.meta.url)));
    const v2 = PNG.sync.write(new PNG({ width: 1536, height: 2288 })), manifest = { ...pack.manifest, spritesheetPath: 'spritesheet.png' as const, spriteVersionNumber: 2 };
    validateAtlas(v2, manifest);
    expect(ANIMATIONS.idle.durations).toHaveLength(6); expect(ANIMATIONS.review.row).toBe(8);
    expect(() => validateAtlas(v2, { ...manifest, spriteVersionNumber: 1 })).toThrow('8×9');
  });
  it('honours frameScale, caps one-shots on the last frame, and rejects unsafe values', async () => {
    const pack = await loadPetPack(fileURLToPath(new URL('../../assets/pets/moe/', import.meta.url)));
    expect(pack.manifest.remoteCodex?.frameScale).toBe(2.5);
    expect(frameAt('idle', 699, false, 2.5)).toBe(0); expect(frameAt('idle', 700, false, 2.5)).toBe(1);
    expect(frameAt('waving', 10000, false, 2.5, true)).toBe(3);
    for (const frameScale of [0, -1, 100, '2']) expect(() => parseManifest(Buffer.from(JSON.stringify({ ...pack.manifest, remoteCodex: { frameScale } })))).toThrow('frameScale');
  });

  it('validates face boxes and talk clips without changing old packs', () => {
    const base = { id: 'custom', displayName: 'Custom', description: '', spritesheetPath: 'spritesheet.webp' };
    const parse = (remoteCodex: unknown) => parseManifest(Buffer.from(JSON.stringify({ ...base, remoteCodex })));
    const valid = { faceBox: [.4, .2, .6, .36], clipFormat: { fps: 24, columns: 12, width: 384, height: 416 }, clips: {}, talk: { path: 'clips/talk.webp', frames: 4 } };
    expect(parse(valid).remoteCodex?.talk).toEqual(valid.talk);
    expect(parse({}).remoteCodex).toBeUndefined();
    for (const faceBox of [[0, 0, 0, 1], [0, 0, 1, 2], [0, 0, 1], ['0', 0, 1, 1]]) expect(() => parse({ ...valid, faceBox })).toThrow('faceBox');
    for (const talk of [{ path: '../talk.webp', frames: 3 }, { path: 'clips/talk.webp', frames: 2 }, { path: 'clips/talk.webp', frames: 9 }, null]) expect(() => parse({ ...valid, talk })).toThrow('talk');
    expect(() => parse({ ...valid, faceBox: undefined })).toThrow('talk');
    expect(() => parse({ faceBox: valid.faceBox, talk: valid.talk })).toThrow('talk');
  });
  it.each(['left', 'right', 'top', 'bottom'] as const)('keeps %s dock window fixed and bisects the declared face', edge => {
    const area = { x: -1440, y: 40, width: 1440, height: 860 };
    const position = restorePosition({ displayId: 2, x: -800, y: 400, edge }, [{ id: 2, workArea: area }], { id: 2, workArea: area }, 128);
    const tucked = petLayout(position, area, 128, { dockAmount: 1 });
    const open = petLayout(position, area, 128, { panel: true, menu: true, bubble: true, chat: true, peek: true, dockAmount: 0 });
    expect(tucked.window).toEqual(open.window);
    expect(tucked.window.x).toBeGreaterThanOrEqual(area.x); expect(tucked.window.y).toBeGreaterThanOrEqual(area.y);
    for (const faceBox of [DEFAULT_FACE_BOX, [.4, .24, .62, .36] as [number, number, number, number]]) for (const height of [72, 128, 256]) {
      const rest = petLayout(position, area, height, { dockAmount: 1, faceBox });
      const alert = petLayout(position, area, height, { dockAmount: HEAD_PEEK, faceBox });
      const { width, height: h, x, y } = rest.pet, angle = dockTilt(edge, 1) * Math.PI / 180;
      const fx = (faceBox[0] + faceBox[2]) / 2 * width - rest.pivot.x;
      const fy = (faceBox[1] + faceBox[3]) / 2 * h - rest.pivot.y;
      const cx = rest.pivot.x + fx * Math.cos(angle) - fy * Math.sin(angle) + x;
      const cy = rest.pivot.y + fx * Math.sin(angle) + fy * Math.cos(angle) + y;
      if (edge === 'left') expect(cx).toBeCloseTo(0);
      if (edge === 'right') expect(cx).toBeCloseTo(width);
      if (edge === 'top') expect(cy).toBeCloseTo(0);
      if (edge === 'bottom') expect(y + (faceBox[1] + (faceBox[3] - faceBox[1]) * .6) * h).toBeCloseTo(h);
      expect(Math.abs(alert.pet.x) + Math.abs(alert.pet.y)).toBeLessThan(Math.abs(x) + Math.abs(y));
      expect(rest.window).toEqual(alert.window);
      if (rest.clip) {
        expect(cy).toBeCloseTo((faceBox[1] + faceBox[3]) / 2 * h);
        expect(rest.visible.height).toBeLessThan(h * .5);
        expect(rest.visible.width).toBeLessThan(width * .4);
        expect(rest.pivot.y).toBeGreaterThan(faceBox[3] * h);
        expect(open.clip).toBeNull();
      }
    }
  });
});
