import type { RivePack } from './rive';
import { RiveHitMask } from './riveHitMask';
import { inspectWebM } from './webm';
import type { PeekArt } from './geometry';
import type { FaceBox } from './geometry';
import { windowsReservedName, windowsUnsafeName } from '../shared/platform';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';

// Drawing variants in a layered character can exceed a single raster clip.
// Keep a finite per-file cap inside the unchanged 256 MiB expanded pack cap.
export const MAX_RIVE_BYTES = 96 * 1024 * 1024;
export const MAX_PACK_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024;
export interface SleepingStrip {
  path: 'sleeping.webp' | 'sleeping.png';
  frames: number;
  durationsMs: number[];
}
export interface PetManifest {
  id: string;
  displayName: string;
  description: string;
  spritesheetPath: 'spritesheet.png' | 'spritesheet.webp';
  spriteVersionNumber?: number;
  author?: string;
  license?: string;
  sourceUrl?: string;
  licenseUrl?: string;
  remoteCodex?: {
    rive?: RivePack;
    sleeping?: SleepingStrip;
    peek?: PeekArt;
    faceBox?: FaceBox;
    talk?: PetClip;
    frameScale?: number;
    /** A slender figure needs more height than a chibi to read at the same size. */ sizeScale?: number;
    clipFormat?: ClipFormat;
    clips?: Partial<Record<ClipState, PetClip[]>>;
  };
}
/** One animation drawn from a sheet of frames in `clipFormat`, for art too rich for the atlas's 8 frames a row. */
export interface PetClip {
  path: string;
  frames: number;
  /** Plays once on entering or leaving its state, outside the cycle. */ role?: 'intro' | 'outro';
}
export interface ClipFormat {
  mediaType?: 'webm-vp9-alpha';
  fps: number;
  columns: number;
  width: number;
  height: number;
}
export const CLIP_STATES = [
  'idle',
  'running',
  'waiting',
  'waving',
  'jumping',
  'poked',
  'failed',
  'review',
  'sleeping',
  'dragging',
  'landing',
  'resting',
] as const;
export type ClipState = (typeof CLIP_STATES)[number];
export const MAX_CLIPS_BYTES = 160 * 1024 * 1024;
export const MAX_MEDIA_CLIP_BYTES = 32 * 1024 * 1024;
export const MAX_MEDIA_PACK_BYTES = 256 * 1024 * 1024;
const MAX_ZIP_BYTES = MAX_MEDIA_PACK_BYTES;
const MAX_ZIP_ENTRIES = 256;
export interface PetPack {
  manifest: PetManifest;
  directory: string;
  image: Buffer;
  sleepingImage?: Buffer;
  peekImage?: Buffer;
}
function fail(message: string): never {
  throw new Error(`Invalid pet pack: ${message}`);
}
export function parseManifest(data: Buffer): PetManifest {
  if (data.length > MAX_MANIFEST_BYTES) fail('pet.json exceeds 16 KB');
  let value: unknown;
  try {
    value = JSON.parse(data.toString('utf8'));
  } catch {
    return fail('pet.json must be valid JSON');
  }
  if (!value || typeof value !== 'object') fail('pet.json must be an object');
  const manifest = value as Record<string, unknown>;
  if (typeof manifest.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(manifest.id))
    fail('id must be 1–64 lowercase letters, digits, hyphens or underscores');
  if (process.platform === 'win32' && windowsReservedName(manifest.id as string))
    fail('id is reserved by Windows');
  if (
    typeof manifest.displayName !== 'string' ||
    !manifest.displayName.trim() ||
    manifest.displayName.length > 100
  )
    fail('displayName must contain 1–100 characters');
  if (typeof manifest.description !== 'string' || manifest.description.length > 500)
    fail('description must be at most 500 characters');
  if (!['spritesheet.png', 'spritesheet.webp'].includes(String(manifest.spritesheetPath)))
    fail('spritesheetPath must be spritesheet.png or spritesheet.webp');
  if (manifest.spriteVersionNumber !== undefined && ![1, 2].includes(manifest.spriteVersionNumber as number))
    fail('spriteVersionNumber must be 1 (8×9) or 2 (8×11)');
  const remoteCodex: PetManifest['remoteCodex'] = {};
  const extensions = manifest.remoteCodex as Record<string, unknown> | undefined;
  if (extensions?.rive !== undefined) {
    const r = extensions.rive as RivePack;
    if (
      !r ||
      r.path !== 'pet.riv' ||
      ![r.artboard, r.stateMachine].every((n) => typeof n === 'string' && n.length > 0 && n.length <= 100) ||
      r.viewModel !== undefined
    )
      fail('invalid remoteCodex.rive (prototype requires state-machine inputs)');
    if (r.motions !== undefined) {
      if (
        !r.motions ||
        typeof r.motions !== 'object' ||
        Array.isArray(r.motions) ||
        Object.entries(r.motions).some(
          ([state, beats]) =>
            ![
              'idle',
              'running',
              'waiting',
              'waving',
              'jumping',
              'poked',
              'failed',
              'review',
              'sleeping',
              'dragging',
              'landing',
              'resting',
            ].includes(state) ||
            !Array.isArray(beats) ||
            !beats.length ||
            beats.length > 32 ||
            beats.some(
              (b) =>
                !b ||
                !Number.isInteger(b.value) ||
                b.value < 0 ||
                b.value > 1023 ||
                !Number.isFinite(b.durationMs) ||
                b.durationMs < 16 ||
                b.durationMs > 60000 ||
                (b.role !== undefined && !['intro', 'outro'].includes(b.role)),
            ),
        )
      )
        fail('invalid Rive motions');
    }
    // Newer mask packs may omit the old cadence fields. Keep the existing
    // player's defaults; this compatibility does not change its motion clock.
    if (r.procedural && typeof r.procedural === 'object') {
      if (r.procedural.idleFps === undefined) r.procedural.idleFps = 24;
      if (r.procedural.activeFps === undefined) r.procedural.activeFps = 60;
    }
    if (r.routing && typeof r.routing === 'object' && r.routing.maxExitMs === undefined)
      r.routing.maxExitMs = 350;
    if (
      r.procedural !== undefined &&
      (!r.procedural ||
        typeof r.procedural.bodyBone !== 'string' ||
        !r.procedural.bodyBone.length ||
        r.procedural.bodyBone.length > 100 ||
        (r.procedural.idleFps !== undefined && ![15, 24, 30].includes(r.procedural.idleFps)) ||
        (r.procedural.activeFps !== undefined && ![30, 60].includes(r.procedural.activeFps)))
    )
      fail('invalid Rive procedural settings');
    if (r.procedural?.eyeOpen !== undefined && typeof r.procedural.eyeOpen !== 'boolean')
      fail('invalid Rive eyeOpen setting');
    if (r.procedural?.response !== undefined && typeof r.procedural.response !== 'boolean')
      fail('invalid Rive response setting');
    if (
      r.procedural?.transientFace !== undefined &&
      (typeof r.procedural.transientFace !== 'boolean' ||
        (r.procedural.transientFace && !r.procedural.eyeOpen))
    )
      fail('invalid Rive transientFace (requires eyeOpen)');
    if (r.procedural?.sourceFps !== undefined && (!r.routing || ![24, 30].includes(r.procedural.sourceFps)))
      fail('invalid Rive sourceFps (requires routed source drawings)');
    if (
      r.backing !== undefined &&
      (!r.backing ||
        ![r.backing.width, r.backing.height].every((n) => Number.isInteger(n) && n > 0 && n <= 4096) ||
        !Number.isFinite(r.backing.scale) ||
        r.backing.scale < 1 ||
        r.backing.scale > 1.25)
    )
      fail('invalid Rive backing');
    if (r.routing !== undefined) {
      const q = r.routing;
      if (
        !q ||
        !r.motions ||
        (q.maxExitMs !== undefined &&
          (!Number.isFinite(q.maxExitMs) || q.maxExitMs < 100 || q.maxExitMs > 400)) ||
        !Array.isArray(q.clips) ||
        !q.clips.length ||
        q.clips.length > 128 ||
        q.clips.some(
          (c) =>
            !c ||
            !Number.isInteger(c.value) ||
            c.value < 0 ||
            c.value > 1023 ||
            typeof c.animation !== 'string' ||
            !c.animation.length ||
            c.animation.length > 100 ||
            !Number.isFinite(c.durationMs) ||
            c.durationMs < 16 ||
            c.durationMs > 60000 ||
            ![c.start, c.end].every((n) => typeof n === 'string' && n.length > 0 && n.length <= 100) ||
            (c.loop !== undefined && typeof c.loop !== 'boolean') ||
            (c.nativeExit !== undefined && typeof c.nativeExit !== 'boolean' && c.nativeExit !== 'nearest'),
        ) ||
        new Set(q.clips.map((c) => c.value)).size !== q.clips.length ||
        !Array.isArray(q.bridges) ||
        q.bridges.length > 128 ||
        q.bridges.some((v) => !q.clips.some((c) => c.value === v))
      )
        fail('invalid Rive routing');
      if (
        q.clips.some(
          (c) =>
            c.exitAnimation !== undefined &&
            (typeof c.exitAnimation !== 'string' || !c.exitAnimation.length || c.exitAnimation.length > 100),
        )
      )
        fail('invalid Rive exit animation');
      if (
        q.clips.some((c) => {
          const e = c.exits;
          return (
            e !== undefined &&
            (!e ||
              !Number.isFinite(e.everyMs) || e.everyMs < 100 || e.everyMs > 1000 ||
              !Number.isFinite(e.durationMs) || e.durationMs < 250 || e.durationMs > 2500 ||
              typeof e.animationPrefix !== 'string' || !e.animationPrefix.length ||
              e.animationPrefix.length > 90 ||
              !q.clips.some((other) => other.start === e.end || other.end === e.end))
          );
        })
      )
        fail('invalid Rive authored exits');
      if (
        q.clips.some(
          (c) =>
            c.exitRestMs !== undefined &&
            (!c.exitRestMs ||
              !['start', 'end'].every((k) => {
                const v = c.exitRestMs![k as 'start' | 'end'];
                return Number.isFinite(v) && v >= 0 && v <= 500 && v < c.durationMs / 2;
              })),
        )
      )
        fail('invalid Rive exit rest corridor');
      if (
        q.reactions !== undefined &&
        (!Array.isArray(q.reactions) ||
          q.reactions.length > 32 ||
          q.reactions.some(
            (a) =>
              !a ||
              ![a.clips, a.targets].every(
                (values) =>
                  Array.isArray(values) &&
                  values.length > 0 &&
                  values.length <= 128 &&
                  values.every((v) => q.clips.some((c) => c.value === v)),
              ) ||
              typeof a.animation !== 'string' ||
              !a.animation.length ||
              a.animation.length > 100 ||
              !Number.isFinite(a.durationMs) ||
              a.durationMs < 100 ||
              a.durationMs > 10000 ||
              !Number.isFinite(a.settleMs) ||
              a.settleMs < 50 ||
              a.settleMs > 400 ||
              a.settleMs > a.durationMs ||
              (a.resumeValue !== undefined &&
                (!q.clips.some((c) => c.value === a.resumeValue) ||
                  !Array.isArray(a.resumeTargets) ||
                  !a.resumeTargets.length ||
                  a.resumeTargets.some((v) => !q.clips.some((c) => c.value === v)))) ||
              (a.resumeValue === undefined && a.resumeTargets !== undefined),
          ))
      )
        fail('invalid Rive pose reaction');
      for (const reaction of q.reactions ?? []) {
        if (reaction.drawings === undefined) continue;
        const duration = Math.min(
          ...reaction.clips.map((value) => q.clips.find((clip) => clip.value === value)!.durationMs),
        );
        if (
          !Array.isArray(reaction.drawings) ||
          !reaction.drawings.length ||
          reaction.drawings.length > 256 ||
          reaction.drawings.some(
            (drawing, index) =>
              !drawing ||
              !Number.isFinite(drawing.atMs) ||
              drawing.atMs < 0 ||
              drawing.atMs > duration ||
              (index > 0 && drawing.atMs <= reaction.drawings![index - 1].atMs) ||
              typeof drawing.animation !== 'string' ||
              !drawing.animation.length ||
              drawing.animation.length > 100,
          )
        )
          fail('invalid Rive reaction drawings');
      }
      if (
        Object.values(r.motions ?? {})
          .flat()
          .some((c) => !q.clips.some((v) => v.value === c?.value))
      )
        fail('Rive routing misses a motion');
      const families = [...new Set(q.clips.flatMap((c) => [c.start, c.end]))];
      for (const start of families) {
        const seen = new Set([start]);
        let size = 0;
        while (size !== seen.size) {
          size = seen.size;
          for (const c of q.clips) if (q.bridges.includes(c.value) && seen.has(c.start)) seen.add(c.end);
        }
        if (families.some((n) => !seen.has(n))) fail('Rive routing has disconnected boundaries');
      }
    }
    if (r.hitMask !== undefined) {
      try {
        new RiveHitMask(r.hitMask);
        if (r.routing?.clips.some((c) => !(c.value in r.hitMask!.clips)))
          fail('Rive hit mask misses a motion');
      } catch {
        fail('invalid Rive hit mask');
      }
    }
    remoteCodex.rive = {
      path: 'pet.riv',
      artboard: r.artboard,
      stateMachine: r.stateMachine,
      ...(r.motions ? { motions: r.motions } : {}),
      ...(r.procedural ? { procedural: r.procedural } : {}),
      ...(r.routing ? { routing: r.routing } : {}),
      ...(r.backing ? { backing: r.backing } : {}),
      ...(r.hitMask ? { hitMask: r.hitMask } : {}),
    };
  }
  const extension = extensions?.sleeping as SleepingStrip | undefined;
  if (extension) {
    if (
      !['sleeping.webp', 'sleeping.png'].includes(extension.path) ||
      !Number.isInteger(extension.frames) ||
      extension.frames < 1 ||
      extension.frames > 8 ||
      !Array.isArray(extension.durationsMs) ||
      extension.durationsMs.length !== extension.frames ||
      !extension.durationsMs.every(
        (duration) => Number.isFinite(duration) && duration >= 100 && duration <= 5000,
      )
    )
      fail('invalid remoteCodex.sleeping strip');
    remoteCodex.sleeping = extension;
  }
  if (extensions?.sizeScale !== undefined) {
    if (
      typeof extensions.sizeScale !== 'number' ||
      !Number.isFinite(extensions.sizeScale) ||
      extensions.sizeScale < 0.5 ||
      extensions.sizeScale > 2
    )
      fail('remoteCodex.sizeScale must be between 0.5 and 2');
    remoteCodex.sizeScale = extensions.sizeScale;
  }
  if (extensions?.frameScale !== undefined) {
    if (
      typeof extensions.frameScale !== 'number' ||
      !Number.isFinite(extensions.frameScale) ||
      extensions.frameScale < 0.25 ||
      extensions.frameScale > 8
    )
      fail('remoteCodex.frameScale must be between 0.25 and 8');
    remoteCodex.frameScale = extensions.frameScale;
  }
  if (extensions?.clips !== undefined || extensions?.clipFormat !== undefined) {
    const format = extensions.clipFormat as ClipFormat | undefined,
      clips = extensions.clips as Record<string, PetClip[]> | undefined;
    const whole = (value: unknown, max: number): boolean =>
      Number.isInteger(value) && (value as number) >= 1 && (value as number) <= max;
    const video = format?.mediaType === 'webm-vp9-alpha';
    if (format?.mediaType !== undefined && !video) fail('unknown clip mediaType');
    if (
      !format ||
      !whole(format.fps, video ? 30 : 60) ||
      !whole(format.columns, 32) ||
      !whole(format.width, video ? 1024 : 512) ||
      !whole(format.height, video ? 1024 : 512) ||
      (video && format.width * format.height > 786432)
    )
      fail('invalid remoteCodex.clipFormat');
    if (!clips || typeof clips !== 'object') fail('invalid remoteCodex.clips');
    for (const [state, list] of Object.entries(clips))
      if (
        !CLIP_STATES.includes(state as ClipState) ||
        !Array.isArray(list) ||
        !list.length ||
        list.length > 16 ||
        list.some(
          (clip) =>
            !(video ? /^clips\/[a-z0-9_-]{1,40}\.webm$/ : /^clips\/[a-z0-9_-]{1,40}\.webp$/).test(
              clip?.path,
            ) ||
            !whole(clip.frames, video ? 360 : 512) ||
            (video && clip.frames / format.fps > 12) ||
            ![undefined, 'intro', 'outro'].includes(clip.role),
        ) ||
        !list.some((clip) => !clip.role) ||
        list.filter((clip) => clip.role === 'intro').length > 1 ||
        list.filter((clip) => clip.role === 'outro').length > 1
      )
        fail('invalid remoteCodex.clips');
    remoteCodex.clipFormat = {
      ...(video ? { mediaType: 'webm-vp9-alpha' as const } : {}),
      fps: format.fps,
      columns: format.columns,
      width: format.width,
      height: format.height,
    };
    remoteCodex.clips = Object.fromEntries(
      Object.entries(clips).map(([state, list]) => [
        state,
        list.map((clip) => ({
          path: clip.path,
          frames: clip.frames,
          ...(clip.role ? { role: clip.role } : {}),
        })),
      ]),
    );
  }
  if (extensions?.faceBox !== undefined) {
    const box = extensions.faceBox;
    if (
      !Array.isArray(box) ||
      box.length !== 4 ||
      !box.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1) ||
      box[0] >= box[2] ||
      box[1] >= box[3]
    )
      fail('invalid remoteCodex.faceBox');
    remoteCodex.faceBox = [...box] as FaceBox;
  }
  if (extensions?.peek !== undefined) {
    const peek = extensions.peek as PeekArt;
    if (
      !peek ||
      !['peek.png', 'peek.webp'].includes(peek.path) ||
      !Number.isInteger(peek.width) ||
      !Number.isInteger(peek.height) ||
      peek.width < 1 ||
      peek.height < 1 ||
      peek.width > 4096 ||
      peek.height > 4096 ||
      peek.width * peek.height > 8388608 ||
      !Array.isArray(peek.anchor) ||
      peek.anchor.length !== 2 ||
      !peek.anchor.every((n) => Number.isFinite(n) && n > 0 && n < 1) ||
      !Number.isFinite(peek.headHeight) ||
      peek.headHeight < 0.1 ||
      peek.headHeight > 1 ||
      !Array.isArray(peek.bounds) ||
      peek.bounds.length !== 4 ||
      !peek.bounds.every((n) => Number.isFinite(n) && n >= 0 && n <= 1) ||
      peek.bounds[0] >= peek.bounds[2] ||
      peek.bounds[1] >= peek.bounds[3]
    )
      fail('invalid remoteCodex.peek');
    if (
      peek.alertAnchor !== undefined &&
      (!Number.isFinite(peek.alertAnchor) ||
        peek.alertAnchor < peek.anchor[0] ||
        peek.alertAnchor >= peek.bounds[2])
    )
      fail('invalid remoteCodex.peek alertAnchor');
    remoteCodex.peek = {
      ...(peek.alertAnchor !== undefined ? { alertAnchor: peek.alertAnchor } : {}),
      path: peek.path,
      width: peek.width,
      height: peek.height,
      anchor: [...peek.anchor],
      headHeight: peek.headHeight,
      bounds: [...peek.bounds],
    } as PeekArt;
  }
  if (extensions?.talk !== undefined) {
    const talk = extensions.talk as PetClip;
    if (
      !remoteCodex.clipFormat ||
      !remoteCodex.faceBox ||
      !talk ||
      !/^clips\/[a-z0-9_-]{1,40}\.webp$/.test(talk.path) ||
      !Number.isInteger(talk.frames) ||
      talk.frames < 3 ||
      talk.frames > 8 ||
      talk.role !== undefined
    )
      fail('invalid remoteCodex.talk');
    remoteCodex.talk = { path: talk.path, frames: talk.frames };
  }
  const metadata: Pick<PetManifest, 'author' | 'license' | 'sourceUrl' | 'licenseUrl'> = {};
  for (const key of ['author', 'license', 'sourceUrl', 'licenseUrl'] as const) {
    const value = manifest[key];
    if (value !== undefined && (typeof value !== 'string' || value.length > 300)) fail(`invalid ${key}`);
    if (typeof value === 'string') {
      if (key.endsWith('Url') && !/^https:\/\//.test(value)) fail(`invalid ${key}`);
      metadata[key] = value;
    }
  }
  return {
    id: manifest.id,
    displayName: manifest.displayName,
    description: manifest.description,
    spritesheetPath: manifest.spritesheetPath as PetManifest['spritesheetPath'],
    spriteVersionNumber: manifest.spriteVersionNumber as number | undefined,
    ...metadata,
    ...(Object.keys(remoteCodex).length ? { remoteCodex } : {}),
  };
}
export function imageDimensions(bytes: Buffer): { width: number; height: number; format: 'png' | 'webp' } {
  if (bytes.length > MAX_PACK_BYTES) fail('spritesheet exceeds 8 MB');
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString('ascii', 12, 16) === 'IHDR'
  )
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), format: 'png' };
  if (
    bytes.length >= 30 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const type = bytes.toString('ascii', 12, 16);
    if (type === 'VP8X')
      return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3), format: 'webp' };
    if (type === 'VP8L' && bytes[20] === 0x2f)
      return {
        width: 1 + (((bytes[22] & 63) << 8) | bytes[21]),
        height: 1 + (((bytes[24] & 15) << 10) | (bytes[23] << 2) | (bytes[22] >> 6)),
        format: 'webp',
      };
    if (type === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a)
      return {
        width: bytes.readUInt16LE(26) & 0x3fff,
        height: bytes.readUInt16LE(28) & 0x3fff,
        format: 'webp',
      };
  }
  return fail('spritesheet must be a PNG or WebP image');
}
export function validateAtlas(bytes: Buffer, manifest: PetManifest): void {
  const dimensions = imageDimensions(bytes);
  if (!manifest.spritesheetPath.endsWith(dimensions.format))
    fail('image format does not match its extension');
  const rows = manifest.spriteVersionNumber === 2 ? 11 : 9;
  if (dimensions.width !== 1536 || dimensions.height !== rows * 208)
    fail(
      `v${manifest.spriteVersionNumber ?? 1} atlas must be 1536×${rows * 208} (8×${rows}), received ${dimensions.width}×${dimensions.height}`,
    );
}
function validateSleeping(bytes: Buffer, manifest: PetManifest): void {
  const size = imageDimensions(bytes),
    strip = manifest.remoteCodex!.sleeping!;
  if (size.width !== 192 * strip.frames || size.height !== 208 || !strip.path.endsWith(size.format))
    fail('invalid sleeping strip dimensions or format');
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
  } finally {
    await handle.close();
  }
}
export async function loadPetPack(directory: string): Promise<PetPack> {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('pack must be a regular directory');
  const manifest = parseManifest(await safeRead(join(directory, 'pet.json'), MAX_MANIFEST_BYTES));
  const image = await safeRead(join(directory, manifest.spritesheetPath), MAX_PACK_BYTES);
  validateAtlas(image, manifest);
  const sleepingImage = manifest.remoteCodex?.sleeping
    ? await safeRead(join(directory, manifest.remoteCodex.sleeping.path), MAX_PACK_BYTES)
    : undefined;
  if (sleepingImage) validateSleeping(sleepingImage, manifest);
  if (image.length + (sleepingImage?.length ?? 0) > MAX_PACK_BYTES) fail('combined spritesheets exceed 8 MB');
  const peekImage = manifest.remoteCodex?.peek
    ? await safeRead(join(directory, manifest.remoteCodex.peek.path), MAX_PACK_BYTES)
    : undefined;
  if (peekImage) validatePeek(peekImage, manifest);
  await checkClips(directory, manifest);
  if (manifest.remoteCodex?.rive) checkRive(await safeRead(join(directory, 'pet.riv'), MAX_RIVE_BYTES));
  if (
    manifest.remoteCodex?.clipFormat?.mediaType &&
    (await lstat(join(directory, 'pet.json'))).size +
      image.length +
      (sleepingImage?.length ?? 0) +
      (peekImage?.length ?? 0) +
      (
        await Promise.all(clipPaths(manifest).map(async (p) => (await lstat(join(directory, p))).size))
      ).reduce((a, b) => a + b, 0) >
      MAX_MEDIA_PACK_BYTES
  )
    fail('pack exceeds 256 MB');
  return { manifest, image, directory, sleepingImage, peekImage };
}
const declaredClips = (manifest: PetManifest): PetClip[] => [
  ...Object.values(manifest.remoteCodex?.clips ?? {}).flat(),
  ...(manifest.remoteCodex?.talk ? [manifest.remoteCodex.talk] : []),
];
const clipPaths = (manifest: PetManifest): string[] => [
  ...new Set(declaredClips(manifest).map((clip) => clip.path)),
];
function validatePeek(bytes: Buffer, manifest: PetManifest): void {
  const size = imageDimensions(bytes),
    peek = manifest.remoteCodex!.peek!;
  if (size.width !== peek.width || size.height !== peek.height || !peek.path.endsWith(size.format))
    fail('peek dimensions or extension mismatch');
}
const clipLimit = (manifest: PetManifest, path: string): number =>
  path.endsWith('.webm') && manifest.remoteCodex?.clipFormat?.mediaType
    ? MAX_MEDIA_CLIP_BYTES
    : MAX_PACK_BYTES;
function checkClipHeader(bytes: Buffer, format: ClipFormat, path: string, frames = 1): void {
  if (format.mediaType && path.endsWith('.webm')) {
    if (bytes.length > MAX_MEDIA_CLIP_BYTES) fail('clip exceeds 32 MB');
    const media = inspectWebM(bytes);
    if (
      media.width !== format.width ||
      media.height !== format.height ||
      Math.abs(media.fps - format.fps) > 0.01 ||
      media.frames !== frames
    )
      fail('WebM does not match clipFormat');
    return;
  }
  const size = imageDimensions(bytes);
  if (
    size.format !== 'webp' ||
    size.width % format.width ||
    size.height % format.height ||
    size.width > format.columns * format.width ||
    (size.height > format.height && size.width !== format.columns * format.width) ||
    (size.width / format.width) * (size.height / format.height) < frames
  )
    fail(`${path} does not match clipFormat`);
}
/** Only the headers: decoding every sheet at startup would be slow, and the renderer falls back to the atlas if one fails. */
async function checkClips(directory: string, manifest: PetManifest): Promise<void> {
  const format = manifest.remoteCodex?.clipFormat;
  if (!format) return;
  const paths = clipPaths(manifest);
  if (paths.length) {
    const folder = await lstat(join(directory, 'clips'));
    if (!folder.isDirectory() || folder.isSymbolicLink()) fail('clips must be a regular directory');
  }
  let total = 0;
  for (const path of paths) {
    const stat = await lstat(join(directory, path));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > clipLimit(manifest, path))
      fail(`${path} exceeds its size limit`);
    total += stat.size;
    const handle = await open(join(directory, path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const { buffer, bytesRead } = path.endsWith('.webm')
        ? { buffer: await handle.readFile(), bytesRead: stat.size }
        : await handle.read(Buffer.alloc(64), 0, 64, 0);
      checkClipHeader(
        buffer.subarray(0, bytesRead),
        format,
        path,
        Math.max(
          ...declaredClips(manifest)
            .filter((c) => c.path === path)
            .map((c) => c.frames),
        ),
      );
    } finally {
      await handle.close();
    }
  }
  if (total > (format.mediaType ? MAX_MEDIA_PACK_BYTES : MAX_CLIPS_BYTES)) fail('clips exceed pack limit');
  const counts = Object.values(manifest.remoteCodex?.clips ?? {}).flat();
  if (counts.some((clip) => clip.frames < 1)) fail('invalid clip frame count');
}
/** A clip named by the manifest, read when it is about to play. */
export async function readClip(pack: PetPack, path: string): Promise<Buffer | null> {
  if (!clipPaths(pack.manifest).includes(path)) return null;
  return safeRead(join(pack.directory, path), clipLimit(pack.manifest, path)).catch(() => null);
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
  if (bytes.length > MAX_ZIP_BYTES) fail('zip exceeds size limit');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) {
      end = i;
      break;
    }
  if (end < 0) fail('zip end record missing');
  const count = bytes.readUInt16LE(end + 10),
    centralSize = bytes.readUInt32LE(end + 12),
    centralOffset = bytes.readUInt32LE(end + 16);
  if (
    bytes.readUInt16LE(end + 4) ||
    bytes.readUInt16LE(end + 6) ||
    bytes.readUInt16LE(end + 8) !== count ||
    count > MAX_ZIP_ENTRIES ||
    centralOffset + centralSize !== end
  )
    fail('multi-volume, ZIP64 or oversized archives are not supported');
  const entries = new Map<string, Buffer>();
  let offset = centralOffset,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) fail('invalid central directory');
    const flags = bytes.readUInt16LE(offset + 8),
      method = bytes.readUInt16LE(offset + 10),
      crc = bytes.readUInt32LE(offset + 16);
    const compressed = bytes.readUInt32LE(offset + 20),
      size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28),
      extraLength = bytes.readUInt16LE(offset + 30),
      commentLength = bytes.readUInt16LE(offset + 32);
    const mode = bytes.readUInt32LE(offset + 38) >>> 16,
      localOffset = bytes.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > end) fail('truncated directory');
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (
      !name ||
      name.includes('\\') ||
      name.includes('\0') ||
      name.startsWith('/') ||
      /^[a-z]:/i.test(name) ||
      name
        .split('/')
        .some(
          (part) =>
            part === '..' || part === '.' || (process.platform === 'win32' && windowsUnsafeName(part)),
        )
    )
      fail('unsafe zip path');
    const kind = mode & 0xf000;
    if (kind && kind !== 0x8000 && kind !== 0x4000) fail('zip symlinks and special files are not allowed');
    if (flags & 1 || ![0, 8].includes(method)) fail('encrypted or unsupported zip compression');
    if (
      size >
        (/\.webm$/.test(name)
          ? MAX_MEDIA_CLIP_BYTES
          : /(^|\/)pet\.riv$/.test(name)
            ? MAX_RIVE_BYTES
            : MAX_PACK_BYTES) ||
      (total += size) > MAX_ZIP_BYTES
    )
      fail('expanded zip exceeds size limit');
    if (localOffset + 30 > centralOffset || bytes.readUInt32LE(localOffset) !== 0x04034b50)
      fail('invalid local header');
    const localNameLength = bytes.readUInt16LE(localOffset + 26),
      localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    if (
      start + compressed > centralOffset ||
      bytes.toString('utf8', localOffset + 30, localOffset + 30 + localNameLength) !== name
    )
      fail('inconsistent local path');
    if (entries.has(name)) fail('duplicate archive entry');
    if (!name.endsWith('/')) {
      let data: Buffer;
      try {
        data =
          method === 0
            ? Buffer.from(bytes.subarray(start, start + compressed))
            : inflateRawSync(bytes.subarray(start, start + compressed), {
                maxOutputLength: Math.max(1, size),
              });
      } catch {
        return fail('invalid or oversized compressed entry');
      }
      if (data.length !== size || crc32(data) !== crc) fail('zip size or checksum mismatch');
      entries.set(name, data);
    }
    offset = next;
  }
  if (offset !== end) fail('invalid central directory size');
  return entries;
}
function checkRive(bytes: Buffer): void {
  if (bytes.length < 8 || bytes.length > MAX_RIVE_BYTES || bytes.toString('ascii', 0, 4) !== 'RIVE')
    fail('Rive file must have RIVE header and be at most 96 MiB');
}
export async function readRive(pack: PetPack): Promise<Buffer | null> {
  if (!pack.manifest.remoteCodex?.rive) return null;
  const bytes = await safeRead(join(pack.directory, 'pet.riv'), MAX_RIVE_BYTES);
  checkRive(bytes);
  return bytes;
}
export async function importPetPack(
  source: string,
  userPetsDirectory: string,
  decode?: (bytes: Buffer) => boolean | Promise<boolean>,
  reservedIds: readonly string[] = [],
  verifyRive?: (bytes: Buffer, config: RivePack) => Promise<void>,
): Promise<PetPack> {
  const stat = await lstat(source);
  if (stat.isSymbolicLink()) fail('symlink sources are not allowed');
  let manifest: PetManifest, image: Buffer, sleepingImage: Buffer | undefined, peekImage: Buffer | undefined;
  const clips = new Map<string, Buffer>();
  let rive: Buffer | undefined;
  if (stat.isDirectory()) {
    ({ manifest, image, sleepingImage, peekImage } = await loadPetPack(source));
    if (manifest.remoteCodex?.rive) {
      rive = await safeRead(join(source, 'pet.riv'), MAX_RIVE_BYTES);
      const allowed = new Set([
        'pet.json',
        manifest.spritesheetPath,
        'pet.riv',
        ...clipPaths(manifest),
        ...(manifest.remoteCodex.sleeping ? [manifest.remoteCodex.sleeping.path] : []),
        ...(manifest.remoteCodex.peek ? [manifest.remoteCodex.peek.path] : []),
      ]);
      for (const entry of await readdir(source, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name === 'clips' && clipPaths(manifest).length) {
          for (const file of await readdir(join(source, 'clips'), { withFileTypes: true }))
            if (!file.isFile() || !allowed.has(`clips/${file.name}`))
              fail('folder must contain only pet.json and the files it declares');
        } else if (!entry.isFile() || !allowed.has(entry.name))
          fail('folder must contain only pet.json and the files it declares');
      }
    }
    for (const path of clipPaths(manifest))
      clips.set(path, await safeRead(join(source, path), clipLimit(manifest, path)));
  } else {
    if (!source.toLowerCase().endsWith('.zip')) fail('choose a pet folder or .zip');
    const files = unpackPetZip(await safeRead(source, MAX_ZIP_BYTES));
    const manifests = [...files.keys()].filter((name) => /(^|\/)pet\.json$/.test(name));
    if (manifests.length !== 1) fail('zip must contain exactly one pet.json');
    const root = manifests[0].slice(0, -'pet.json'.length);
    manifest = parseManifest(files.get(manifests[0])!);
    if (
      !manifest.remoteCodex?.clipFormat?.mediaType &&
      (stat.size > MAX_CLIPS_BYTES + 2 * MAX_PACK_BYTES ||
        [...files.values()].reduce((a, b) => a + b.length, 0) > MAX_CLIPS_BYTES + 2 * MAX_PACK_BYTES)
    )
      fail('legacy zip exceeds 176 MB');
    if (manifest.remoteCodex?.rive) {
      rive = files.get(root + 'pet.riv');
      if (!rive) fail('zip is missing pet.riv');
      checkRive(rive);
    }
    peekImage = manifest.remoteCodex?.peek ? files.get(root + manifest.remoteCodex.peek.path) : undefined;
    if (manifest.remoteCodex?.peek && !peekImage) fail('zip is missing peek art');
    if (peekImage) validatePeek(peekImage, manifest);
    const atlas = files.get(root + manifest.spritesheetPath);
    sleepingImage = manifest.remoteCodex?.sleeping
      ? files.get(root + manifest.remoteCodex.sleeping.path)
      : undefined;
    for (const path of clipPaths(manifest)) {
      const clip = files.get(root + path);
      if (!clip) fail(`zip is missing ${path}`);
      checkClipHeader(
        clip,
        manifest.remoteCodex!.clipFormat!,
        path,
        Math.max(
          ...declaredClips(manifest)
            .filter((c) => c.path === path)
            .map((c) => c.frames),
        ),
      );
      clips.set(path, clip);
    }
    if (
      !atlas ||
      files.size !==
        (manifest.remoteCodex?.sleeping ? 3 : 2) + (peekImage ? 1 : 0) + (rive ? 1 : 0) + clips.size ||
      (manifest.remoteCodex?.sleeping && !sleepingImage)
    )
      fail('zip must contain only pet.json and the files it declares');
    if (sleepingImage) validateSleeping(sleepingImage, manifest);
    image = atlas;
    validateAtlas(image, manifest);
  }
  if (
    [...clips.values()].reduce((total, bytes) => total + bytes.length, 0) +
      (manifest.remoteCodex?.clipFormat?.mediaType
        ? image.length + (sleepingImage?.length ?? 0) + (peekImage?.length ?? 0)
        : 0) >
    (manifest.remoteCodex?.clipFormat?.mediaType ? MAX_MEDIA_PACK_BYTES : MAX_CLIPS_BYTES)
  )
    fail('pack byte limits exceeded');
  if (reservedIds.includes(manifest.id)) fail(`pet id ${manifest.id} is built in; give the pack another id`);
  if (image.length + (sleepingImage?.length ?? 0) > MAX_PACK_BYTES) fail('combined spritesheets exceed 8 MB');
  if (
    decode &&
    (!(await decode(image)) ||
      (peekImage && !(await decode(peekImage))) ||
      (sleepingImage && !(await decode(sleepingImage))))
  )
    fail('cannot decode spritesheet pixels');
  if (rive && manifest.remoteCodex?.rive) {
    checkRive(rive);
    if (
      rive.length +
        image.length +
        (sleepingImage?.length ?? 0) +
        (peekImage?.length ?? 0) +
        [...clips.values()].reduce((n, b) => n + b.length, 0) +
        Buffer.byteLength(JSON.stringify(manifest)) >
      MAX_MEDIA_PACK_BYTES
    )
      fail('pack exceeds 256 MB');
    if (!verifyRive) fail('Rive import requires isolated runtime verification');
    await verifyRive(rive, manifest.remoteCodex.rive);
  }
  const manifestJSON = JSON.stringify(manifest);
  if (Buffer.byteLength(manifestJSON) > MAX_MANIFEST_BYTES) fail('normalized pet.json exceeds 16 KB');
  await mkdir(userPetsDirectory, { recursive: true });
  const destination = join(userPetsDirectory, manifest.id),
    staging = join(userPetsDirectory, `.import-${randomUUID()}`);
  await mkdir(staging);
  try {
    // The installed representation must obey the same limit as the input.
    // Pretty printing large routing tables can otherwise make a valid import
    // disappear from the catalog at the next load.
    await writeFile(join(staging, 'pet.json'), manifestJSON);
    await writeFile(join(staging, manifest.spritesheetPath), image);
    if (rive) await writeFile(join(staging, 'pet.riv'), rive);
    if (sleepingImage && manifest.remoteCodex?.sleeping)
      await writeFile(join(staging, manifest.remoteCodex.sleeping.path), sleepingImage);
    if (peekImage && manifest.remoteCodex?.peek)
      await writeFile(join(staging, manifest.remoteCodex.peek.path), peekImage);
    if (clips.size) {
      await mkdir(join(staging, 'clips'));
      for (const [path, clip] of clips) await writeFile(join(staging, path), clip);
    }
    // Importing a pack again replaces it, so an updated zip just works. Built-in ids are refused above.
    const previous = join(userPetsDirectory, `.replaced-${randomUUID()}`);
    const replacing = await lstat(destination).then(
      () => true,
      () => false,
    );
    if (replacing) await rename(destination, previous);
    try {
      await rename(staging, destination);
    } catch (error) {
      if (replacing) await rename(previous, destination);
      throw error;
    }
    if (replacing) await rm(previous, { recursive: true, force: true });
    return { manifest, image, directory: destination, sleepingImage, peekImage };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
export async function listPetPacks(directories: string[]): Promise<PetPack[]> {
  const packs = new Map<string, PetPack>();
  for (const root of directories) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      try {
        const pack = await loadPetPack(join(root, entry.name));
        if (!packs.has(pack.manifest.id)) packs.set(pack.manifest.id, pack);
      } catch {
        /* A malformed user pack must not prevent the bundled pet from loading. */
      }
    }
  }
  return [...packs.values()];
}
