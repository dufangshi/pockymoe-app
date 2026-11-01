import { describe, expect, it } from 'vitest';
import { access, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import type { ActivityEvent, ActivityItem } from '../shared/contract';
import { ANIMATIONS, frameAt, moodFor } from './animation';
import { BubbleQueue } from './bubbles';
import { clampRect, defaultPosition, dockPosition, petLayout, restorePosition } from './geometry';
import { importPetPack, loadPetPack, MAX_PACK_BYTES, parseManifest, unpackPetZip, validateAtlas } from './packs';
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
  it('preserves attention > failure > completion > running > idle', () => {
    expect(moodFor([item('running')])).toBe('running'); expect(moodFor([item('running')], { completion: 'waving' })).toBe('waving');
    expect(moodFor([item('failed')], { completion: 'jumping' })).toBe('failed'); expect(moodFor([item('needsInput'), item('failed')])).toBe('waiting');
    expect(moodFor([item('completed')])).toBe('idle'); expect(moodFor([], { snoozed: true })).toBe('sleeping'); expect(moodFor([item('running')], { reviewing: true })).toBe('review');
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
    expect(q.pending).toHaveLength(2); expect(q.pending[1].events).toHaveLength(2); q.tick(20000); expect(q.pending).toHaveLength(2); q.acknowledge('a', 20000); expect(q.current?.shownAt).toBe(20000); q.tick(27999); expect(q.current).not.toBeNull(); q.tick(28000); expect(q.current).toBeNull();
  });
  it('synchronizes acknowledgement and resolved requests', () => {
    const q = new BubbleQueue(); q.push(event('completed', 'a'), 0); q.push(event('completed', 'b'), 10); q.acknowledge('a', 100); expect(q.current?.events.map((e) => e.alertId)).toEqual(['b']); q.push(event('needsInput', 'c'), 200); q.resolve('c', 300); expect(q.current?.sticky).toBe(false);
  });
});
describe('display and dock geometry', () => {
  const area = { x: -1440, y: 40, width: 1440, height: 860 }, primary = { id: 1, workArea: { x: 0, y: 38, width: 1512, height: 906 } };
  it.each(['left', 'right', 'top', 'bottom'] as const)('snaps %s within 24px', (edge) => {
    const p = { displayId: 2, x: -1200, y: 300, edge: null }, width = 128 * 192 / 208;
    if (edge === 'left') p.x = area.x + 23; if (edge === 'right') p.x = area.x + area.width - width - 23; if (edge === 'top') p.y = area.y + 23; if (edge === 'bottom') p.y = area.y + area.height - 128 - 23;
    expect(dockPosition(p, area, 128).edge).toBe(edge);
  });
  it('clamps overlays to work areas including menu/notch/taskbar insets', () => {
    const p = dockPosition({ displayId: 2, x: -1440, y: 50, edge: null }, area, 160), r = petLayout(p, area, 160, { panel: true, bubble: true, chat: true, mini: false, peek: false });
    expect(r.window.x).toBeGreaterThanOrEqual(area.x); expect(r.window.y).toBeGreaterThanOrEqual(area.y); expect(r.window.x + r.window.width).toBeLessThanOrEqual(area.x + area.width); expect(r.window.y + r.window.height).toBeLessThanOrEqual(area.y + area.height); expect(r.pet.x).toBeLessThan(0);
    expect(clampRect({ x: -5, y: -8, width: 1000, height: 1000 }, { x: 0, y: 38, width: 320, height: 500 })).toEqual({ x: 0, y: 38, width: 320, height: 500 });
  });
  it('restores per display and falls back after hot-unplug', () => {
    const p = { displayId: 2, x: -1300, y: 200, edge: null }; expect(restorePosition(p, [primary, { id: 2, workArea: area }], primary, 128)).toEqual(p); expect(restorePosition(p, [primary], primary, 128)).toEqual(defaultPosition(primary, 128));
  });
});
describe('pack validation and safe import', () => {
  const fixture = new URL('../../assets/pets/placeholder/', import.meta.url).pathname;
  it('accepts a good atlas and rejects dimensions, unsupported v2, invalid formats and limits', async () => {
    const p = await loadPetPack(fixture); expect(p.manifest.id).toBe('placeholder'); const wrong = Buffer.from(p.image); wrong.writeUInt32BE(1760, 20); expect(() => validateAtlas(wrong, p.manifest)).toThrow('1536×1872'); expect(() => validateAtlas(Buffer.alloc(MAX_PACK_BYTES + 1), p.manifest)).toThrow('8 MB'); expect(() => validateAtlas(Buffer.from('fake'), p.manifest)).toThrow('PNG or WebP'); expect(() => parseManifest(Buffer.from(JSON.stringify({ ...p.manifest, spriteVersionNumber: 2 })))).toThrow('v2'); expect(() => parseManifest(Buffer.from(JSON.stringify({ ...p.manifest, spritesheetPath: '../outside.png' })))).toThrow('spritesheetPath');
  });
  it.each(['../outside', '/absolute', 'C:/windows', 'folder/../../outside', 'folder\\outside'])('rejects zip traversal %s', (name) => { expect(() => unpackPetZip(zip([{ name, data: Buffer.from('x') }]))).toThrow('unsafe zip path'); });
  it('rejects symlinks, duplicates, corrupt zips and decompression bombs', () => {
    expect(() => unpackPetZip(zip([{ name: 'pet.json', data: Buffer.from('target'), mode: 0xa1ff }]))).toThrow('symlinks'); expect(() => unpackPetZip(zip([{ name: 'x', data: Buffer.alloc(1) }, { name: 'x', data: Buffer.alloc(1) }]))).toThrow('duplicate'); expect(() => unpackPetZip(Buffer.from('bad zip'))).toThrow('end record'); expect(() => unpackPetZip(zip([{ name: 'x', data: Buffer.alloc(MAX_PACK_BYTES + 1) }]))).toThrow('size limit');
  });
  it('imports a nested zip atomically and refuses overwrite and symlink folders', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'pet-test-'));
    try { const image = await readFile(join(fixture, 'spritesheet.png')), manifest = await readFile(join(fixture, 'pet.json')), source = join(temp, 'pack.zip'); await writeFile(source, zip([{ name: 'little/pet.json', data: manifest }, { name: 'little/spritesheet.png', data: image }])); const imported = await importPetPack(source, join(temp, 'pets')); expect(await readFile(join(imported.directory, 'spritesheet.png'))).toEqual(image); await expect(importPetPack(source, join(temp, 'pets'))).rejects.toThrow('already installed'); await symlink(fixture, join(temp, 'link')); await expect(loadPetPack(join(temp, 'link'))).rejects.toThrow('regular directory'); } finally { await rm(temp, { recursive: true, force: true }); }
  });
});

describe('interaction regressions', () => {
  it('resumes a completion bubble after sticky attention preempts it', () => {
    const queue = new BubbleQueue(); queue.push(event('completed', 'done'), 0); queue.push(event('needsInput', 'approval'), 500); queue.resolve('approval', 20000); expect(queue.current?.shownAt).toBe(20000); queue.tick(27999); expect(queue.current).not.toBeNull();
  });
  it('uses a stable expansion side and shrinks the tray near the screen center', () => {
    const area = { x: 0, y: 38, width: 1512, height: 906 }, position = { displayId: 1, x: 700, y: 470, edge: null };
    const before = petLayout(position, area, 128, { panel: true, bubble: true, chat: true, mini: false, peek: true });
    const after = petLayout(position, area, 128, { panel: true, bubble: true, chat: true, mini: false, peek: true, measured: { tray: 330, bubble: 84, chat: 88 } });
    expect(before.panelAbove).toBe(after.panelAbove); expect(after.panelHeight).toBeLessThan(330); expect(after.window.y).toBeGreaterThanOrEqual(area.y);
  });
  it('reanchors docked positions when the work area changes and rejects corrupt saved coordinates', () => {
    const display = { id: 1, workArea: { x: 0, y: 38, width: 1512, height: 906 } };
    expect(restorePosition({ displayId: 1, x: 900, y: 400, edge: 'right' }, [display], display, 128).x).toBe(1512 - 128 * 192 / 208);
    expect(restorePosition({ displayId: 1, x: NaN, y: 400, edge: null }, [display], display, 128)).toEqual(defaultPosition(display, 128));
  });
  it('accepts the final WebP atlas and the optional original sleeping strip', async () => {
    const pack = await loadPetPack(new URL('../../assets/pets/moe/', import.meta.url).pathname); expect(pack.manifest.id).toBe('moe'); expect(pack.sleepingImage?.length).toBeGreaterThan(0); expect(pack.manifest.remoteCodex?.sleeping.frames).toBe(4);
  });
  it('refuses a header-valid image if the pixel decoder rejects it, before installing anything', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'pet-decode-'));
    try { await expect(importPetPack(new URL('../../assets/pets/placeholder/', import.meta.url).pathname, join(temp, 'pets'), () => false)).rejects.toThrow('cannot decode'); await expect(access(join(temp, 'pets', 'placeholder'))).rejects.toThrow(); } finally { await rm(temp, { recursive: true, force: true }); }
  });
});
