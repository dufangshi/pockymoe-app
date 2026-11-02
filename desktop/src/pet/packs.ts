import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';

export const MAX_PACK_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024;
export interface SleepingStrip { path: 'sleeping.webp' | 'sleeping.png'; frames: number; durationsMs: number[] }
export interface PetManifest { id: string; displayName: string; description: string; spritesheetPath: 'spritesheet.png' | 'spritesheet.webp'; spriteVersionNumber?: number; author?: string; license?: string; sourceUrl?: string; licenseUrl?: string; remoteCodex?: { sleeping?: SleepingStrip; frameScale?: number ; /** A slender figure needs more height than a chibi to read at the same size. */ sizeScale?: number; clipFormat?: ClipFormat; clips?: Partial<Record<ClipState, PetClip[]>> } }
/** One animation drawn from a sheet of frames in `clipFormat`, for art too rich for the atlas's 8 frames a row. */
export interface PetClip { path: string; frames: number; /** Plays once on entering or leaving its state, outside the cycle. */ role?: 'intro' | 'outro' }
export interface ClipFormat { fps: number; columns: number; width: number; height: number }
export const CLIP_STATES = ['idle', 'running', 'waiting', 'waving', 'jumping', 'poked', 'failed', 'review', 'sleeping', 'dragging', 'landing', 'resting'] as const;
export type ClipState = typeof CLIP_STATES[number];
export const MAX_CLIPS_BYTES = 160 * 1024 * 1024;
const MAX_ZIP_BYTES = MAX_CLIPS_BYTES + 2 * MAX_PACK_BYTES;
const MAX_ZIP_ENTRIES = 256;
export interface PetPack { manifest: PetManifest; directory: string; image: Buffer; sleepingImage?: Buffer }
function fail(message: string): never { throw new Error(`Invalid pet pack: ${message}`); }
export function parseManifest(data: Buffer): PetManifest {
  if (data.length > MAX_MANIFEST_BYTES) fail('pet.json exceeds 16 KB');
  let value: unknown;
  try { value = JSON.parse(data.toString('utf8')); } catch { return fail('pet.json must be valid JSON'); }
  if (!value || typeof value !== 'object') fail('pet.json must be an object');
  const manifest = value as Record<string, unknown>;
  if (typeof manifest.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(manifest.id)) fail('id must be 1–64 lowercase letters, digits, hyphens or underscores');
  if (typeof manifest.displayName !== 'string' || !manifest.displayName.trim() || manifest.displayName.length > 100) fail('displayName must contain 1–100 characters');
  if (typeof manifest.description !== 'string' || manifest.description.length > 500) fail('description must be at most 500 characters');
  if (!['spritesheet.png', 'spritesheet.webp'].includes(String(manifest.spritesheetPath))) fail('spritesheetPath must be spritesheet.png or spritesheet.webp');
  if (manifest.spriteVersionNumber !== undefined && ![1, 2].includes(manifest.spriteVersionNumber as number)) fail('spriteVersionNumber must be 1 (8×9) or 2 (8×11)');
  const remoteCodex: PetManifest['remoteCodex'] = {};
  const extensions = manifest.remoteCodex as Record<string, unknown> | undefined;
  const extension = extensions?.sleeping as SleepingStrip | undefined;
  if (extension) {
    if (!['sleeping.webp', 'sleeping.png'].includes(extension.path) || !Number.isInteger(extension.frames) || extension.frames < 1 || extension.frames > 8 || !Array.isArray(extension.durationsMs) || extension.durationsMs.length !== extension.frames || !extension.durationsMs.every(duration => Number.isFinite(duration) && duration >= 100 && duration <= 5000)) fail('invalid remoteCodex.sleeping strip');
    remoteCodex.sleeping = extension;
  }
  if (extensions?.sizeScale !== undefined) {
    if (typeof extensions.sizeScale !== 'number' || !Number.isFinite(extensions.sizeScale) || extensions.sizeScale < .5 || extensions.sizeScale > 2) fail('remoteCodex.sizeScale must be between 0.5 and 2');
    remoteCodex.sizeScale = extensions.sizeScale;
  }
  if (extensions?.frameScale !== undefined) {
    if (typeof extensions.frameScale !== 'number' || !Number.isFinite(extensions.frameScale) || extensions.frameScale < .25 || extensions.frameScale > 8) fail('remoteCodex.frameScale must be between 0.25 and 8');
    remoteCodex.frameScale = extensions.frameScale;
  }
  if (extensions?.clips !== undefined || extensions?.clipFormat !== undefined) {
    const format = extensions.clipFormat as ClipFormat | undefined, clips = extensions.clips as Record<string, PetClip[]> | undefined;
    const whole = (value: unknown, max: number): boolean => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= max;
    if (!format || !whole(format.fps, 60) || !whole(format.columns, 32) || !whole(format.width, 512) || !whole(format.height, 512)) fail('invalid remoteCodex.clipFormat');
    if (!clips || typeof clips !== 'object') fail('invalid remoteCodex.clips');
    for (const [state, list] of Object.entries(clips))
      if (!CLIP_STATES.includes(state as ClipState) || !Array.isArray(list) || !list.length || list.length > 16 || list.some(clip => !/^clips\/[a-z0-9_-]{1,40}\.webp$/.test(clip?.path) || !whole(clip.frames, 512) || ![undefined, 'intro', 'outro'].includes(clip.role)) || !list.some(clip => !clip.role) || list.filter(clip => clip.role === 'intro').length > 1 || list.filter(clip => clip.role === 'outro').length > 1) fail('invalid remoteCodex.clips');
    remoteCodex.clipFormat = { fps: format.fps, columns: format.columns, width: format.width, height: format.height };
    remoteCodex.clips = Object.fromEntries(Object.entries(clips).map(([state, list]) => [state, list.map(clip => ({ path: clip.path, frames: clip.frames, ...(clip.role ? { role: clip.role } : {}) }))]));
  }
  const metadata: Pick<PetManifest, 'author' | 'license' | 'sourceUrl' | 'licenseUrl'> = {};
  for (const key of ['author', 'license', 'sourceUrl', 'licenseUrl'] as const) {
    const value = manifest[key];
    if (value !== undefined && (typeof value !== 'string' || value.length > 300)) fail(`invalid ${key}`);
    if (typeof value === 'string') { if (key.endsWith('Url') && !/^https:\/\//.test(value)) fail(`invalid ${key}`); metadata[key] = value; }
  }
  return { id: manifest.id, displayName: manifest.displayName, description: manifest.description,
    spritesheetPath: manifest.spritesheetPath as PetManifest['spritesheetPath'], spriteVersionNumber: manifest.spriteVersionNumber as number | undefined, ...metadata, ...(Object.keys(remoteCodex).length ? { remoteCodex } : {}) };
}
export function imageDimensions(bytes: Buffer): { width: number; height: number; format: 'png' | 'webp' } {
  if (bytes.length > MAX_PACK_BYTES) fail('spritesheet exceeds 8 MB');
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR')
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), format: 'png' };
  if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const type = bytes.toString('ascii', 12, 16);
    if (type === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3), format: 'webp' };
    if (type === 'VP8L' && bytes[20] === 0x2f) return { width: 1 + ((bytes[22] & 63) << 8 | bytes[21]), height: 1 + ((bytes[24] & 15) << 10 | bytes[23] << 2 | bytes[22] >> 6), format: 'webp' };
    if (type === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a)
      return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff, format: 'webp' };
  }
  return fail('spritesheet must be a PNG or WebP image');
}
export function validateAtlas(bytes: Buffer, manifest: PetManifest): void {
  const dimensions = imageDimensions(bytes);
  if (!manifest.spritesheetPath.endsWith(dimensions.format)) fail('image format does not match its extension');
  const rows = manifest.spriteVersionNumber === 2 ? 11 : 9;
  if (dimensions.width !== 1536 || dimensions.height !== rows * 208) fail(`v${manifest.spriteVersionNumber ?? 1} atlas must be 1536×${rows * 208} (8×${rows}), received ${dimensions.width}×${dimensions.height}`);
}
function validateSleeping(bytes: Buffer, manifest: PetManifest): void {
  const size = imageDimensions(bytes), strip = manifest.remoteCodex!.sleeping!;
  if (size.width !== 192 * strip.frames || size.height !== 208 || !strip.path.endsWith(size.format)) fail('invalid sleeping strip dimensions or format');
}
async function safeRead(path: string, limit: number): Promise<Buffer> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('symlinks and non-regular files are not allowed');
  if (stat.size > limit) fail(`${basename(path)} exceeds its size limit`);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > limit) fail('file changed during import or exceeds its size limit');
    const data = await handle.readFile();
    if (data.length > limit) fail(`${basename(path)} exceeds its size limit`);
    return data;
  } finally { await handle.close(); }
}
export async function loadPetPack(directory: string): Promise<PetPack> {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('pack must be a regular directory');
  const manifest = parseManifest(await safeRead(join(directory, 'pet.json'), MAX_MANIFEST_BYTES));
  const image = await safeRead(join(directory, manifest.spritesheetPath), MAX_PACK_BYTES);
  validateAtlas(image, manifest);
  const sleepingImage = manifest.remoteCodex?.sleeping ? await safeRead(join(directory, manifest.remoteCodex.sleeping.path), MAX_PACK_BYTES) : undefined;
  if (sleepingImage) validateSleeping(sleepingImage, manifest);
  if (image.length + (sleepingImage?.length ?? 0) > MAX_PACK_BYTES) fail('combined spritesheets exceed 8 MB');
  await checkClips(directory, manifest);
  return { manifest, image, directory, sleepingImage };
}
const clipPaths = (manifest: PetManifest): string[] => [...new Set(Object.values(manifest.remoteCodex?.clips ?? {}).flat().map(clip => clip.path))];
function checkClipHeader(bytes: Buffer, format: ClipFormat, path: string): void {
  const size = imageDimensions(bytes);
  if (size.format !== 'webp' || size.width % format.width || size.height % format.height || size.width > format.columns * format.width) fail(`${path} does not match clipFormat`);
}
/** Only the headers: decoding every sheet at startup would be slow, and the renderer falls back to the atlas if one fails. */
async function checkClips(directory: string, manifest: PetManifest): Promise<void> {
  const format = manifest.remoteCodex?.clipFormat;
  if (!format) return;
  let total = 0;
  for (const path of clipPaths(manifest)) {
    const stat = await lstat(join(directory, path));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PACK_BYTES) fail(`${path} must be a regular file of at most 8 MB`);
    total += stat.size;
    const handle = await open(join(directory, path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(64), 0, 64, 0);
      checkClipHeader(buffer.subarray(0, bytesRead), format, path);
    } finally { await handle.close(); }
  }
  if (total > MAX_CLIPS_BYTES) fail('clips exceed 160 MB');
  const counts = Object.values(manifest.remoteCodex?.clips ?? {}).flat();
  if (counts.some(clip => clip.frames < 1)) fail('invalid clip frame count');
}
/** A clip named by the manifest, read when it is about to play. */
export async function readClip(pack: PetPack, path: string): Promise<Buffer | null> {
  if (!clipPaths(pack.manifest).includes(path)) return null;
  return safeRead(join(pack.directory, path), MAX_PACK_BYTES).catch(() => null);
}
// By table: a pack with clips runs to tens of megabytes, and this runs on the main process.
const CRC_TABLE = Int32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  return value;
});
function crc32(bytes: Buffer): number {
  let crc = -1;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}
// Inspect the central directory first; never materialize archive paths on disk.
export function unpackPetZip(bytes: Buffer): Map<string, Buffer> {
  if (bytes.length > MAX_ZIP_BYTES) fail('zip exceeds 176 MB');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  if (end < 0) fail('zip end record missing');
  const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12), centralOffset = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count || count > MAX_ZIP_ENTRIES || centralOffset + centralSize !== end) fail('multi-volume, ZIP64 or oversized archives are not supported');
  const entries = new Map<string, Buffer>();
  let offset = centralOffset, total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) fail('invalid central directory');
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10), crc = bytes.readUInt32LE(offset + 16);
    const compressed = bytes.readUInt32LE(offset + 20), size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28), extraLength = bytes.readUInt16LE(offset + 30), commentLength = bytes.readUInt16LE(offset + 32);
    const mode = bytes.readUInt32LE(offset + 38) >>> 16, localOffset = bytes.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > end) fail('truncated directory');
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').some((part) => part === '..' || part === '.')) fail('unsafe zip path');
    const kind = mode & 0xf000;
    if (kind && kind !== 0x8000 && kind !== 0x4000) fail('zip symlinks and special files are not allowed');
    if (flags & 1 || ![0, 8].includes(method)) fail('encrypted or unsupported zip compression');
    if (size > MAX_PACK_BYTES || (total += size) > MAX_ZIP_BYTES) fail('expanded zip exceeds size limit');
    if (localOffset + 30 > centralOffset || bytes.readUInt32LE(localOffset) !== 0x04034b50) fail('invalid local header');
    const localNameLength = bytes.readUInt16LE(localOffset + 26), localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    if (start + compressed > centralOffset || bytes.toString('utf8', localOffset + 30, localOffset + 30 + localNameLength) !== name) fail('inconsistent local path');
    if (entries.has(name)) fail('duplicate archive entry');
    if (!name.endsWith('/')) {
      let data: Buffer;
      try { data = method === 0 ? Buffer.from(bytes.subarray(start, start + compressed)) : inflateRawSync(bytes.subarray(start, start + compressed), { maxOutputLength: Math.max(1, size) }); }
      catch { return fail('invalid or oversized compressed entry'); }
      if (data.length !== size || crc32(data) !== crc) fail('zip size or checksum mismatch');
      entries.set(name, data);
    }
    offset = next;
  }
  if (offset !== end) fail('invalid central directory size');
  return entries;
}
export async function importPetPack(source: string, userPetsDirectory: string, decode?: (bytes: Buffer) => boolean | Promise<boolean>, reservedIds: readonly string[] = []): Promise<PetPack> {
  const stat = await lstat(source);
  if (stat.isSymbolicLink()) fail('symlink sources are not allowed');
  let manifest: PetManifest, image: Buffer, sleepingImage: Buffer | undefined;
  const clips = new Map<string, Buffer>();
  if (stat.isDirectory()) {
    ({ manifest, image, sleepingImage } = await loadPetPack(source));
    for (const path of clipPaths(manifest)) clips.set(path, await safeRead(join(source, path), MAX_PACK_BYTES));
  }
  else {
    if (!source.toLowerCase().endsWith('.zip')) fail('choose a pet folder or .zip');
    const files = unpackPetZip(await safeRead(source, MAX_ZIP_BYTES));
    const manifests = [...files.keys()].filter((name) => /(^|\/)pet\.json$/.test(name));
    if (manifests.length !== 1) fail('zip must contain exactly one pet.json');
    const root = manifests[0].slice(0, -'pet.json'.length);
    manifest = parseManifest(files.get(manifests[0])!);
    const atlas = files.get(root + manifest.spritesheetPath);
    sleepingImage = manifest.remoteCodex?.sleeping ? files.get(root + manifest.remoteCodex.sleeping.path) : undefined;
    for (const path of clipPaths(manifest)) {
      const clip = files.get(root + path);
      if (!clip) fail(`zip is missing ${path}`);
      checkClipHeader(clip, manifest.remoteCodex!.clipFormat!, path);
      clips.set(path, clip);
    }
    if (!atlas || files.size !== (manifest.remoteCodex?.sleeping ? 3 : 2) + clips.size || manifest.remoteCodex?.sleeping && !sleepingImage) fail('zip must contain only pet.json and the files it declares');
    if (sleepingImage) validateSleeping(sleepingImage, manifest);
    image = atlas;
    validateAtlas(image, manifest);
  }
  if (reservedIds.includes(manifest.id)) fail(`pet id ${manifest.id} is built in; give the pack another id`);
  if (image.length + (sleepingImage?.length ?? 0) > MAX_PACK_BYTES) fail('combined spritesheets exceed 8 MB');
  if (decode && (!await decode(image) || sleepingImage && !await decode(sleepingImage))) fail('cannot decode spritesheet pixels');
  await mkdir(userPetsDirectory, { recursive: true });
  const destination = join(userPetsDirectory, manifest.id), staging = join(userPetsDirectory, `.import-${randomUUID()}`);
  await mkdir(staging);
  try {
    await writeFile(join(staging, 'pet.json'), JSON.stringify(manifest, null, 2));
    await writeFile(join(staging, manifest.spritesheetPath), image);
    if (sleepingImage && manifest.remoteCodex?.sleeping) await writeFile(join(staging, manifest.remoteCodex.sleeping.path), sleepingImage);
    if (clips.size) {
      await mkdir(join(staging, 'clips'));
      for (const [path, clip] of clips) await writeFile(join(staging, path), clip);
    }
    // Importing a pack again replaces it, so an updated zip just works. Built-in ids are refused above.
    const previous = join(userPetsDirectory, `.replaced-${randomUUID()}`);
    const replacing = await lstat(destination).then(() => true, () => false);
    if (replacing) await rename(destination, previous);
    try { await rename(staging, destination); }
    catch (error) { if (replacing) await rename(previous, destination); throw error; }
    if (replacing) await rm(previous, { recursive: true, force: true });
    return { manifest, image, directory: destination, sleepingImage };
  } finally { await rm(staging, { recursive: true, force: true }); }
}
export async function listPetPacks(directories: string[]): Promise<PetPack[]> {
  const packs = new Map<string, PetPack>();
  for (const root of directories) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      try { const pack = await loadPetPack(join(root, entry.name)); if (!packs.has(pack.manifest.id)) packs.set(pack.manifest.id, pack); }
      catch { /* A malformed user pack must not prevent the bundled pet from loading. */ }
    }
  }
  return [...packs.values()];
}
