import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import type { PetPack } from './packs';
const assets = new Map<string, string>();
/** Capability URLs: no renderer-supplied filesystem paths or pack ids. */
export function petMedia(pack: PetPack): { urls: Record<string, string>; dispose(): void } {
  const urls: Record<string, string> = {}, keys: string[] = [];
  for (const clip of Object.values(pack.manifest.remoteCodex?.clips ?? {}).flat()) {
    if (!clip.path.endsWith('.webm') || urls[clip.path]) continue;
    const key = randomUUID(); keys.push(key); assets.set(key, join(pack.directory, clip.path)); urls[clip.path] = `pockymoe-pet://media/${key}`;
  }
  return { urls, dispose: () => keys.forEach(key => assets.delete(key)) };
}
export async function petMediaResponse(request: Request): Promise<Response | null> {
  const url = new URL(request.url); if (url.hostname !== 'media') return null;
  const path = !url.search && !url.hash && assets.get(url.pathname.slice(1));
  if (!path) return new Response(null, { status: 404 });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024) { await handle.close(); return new Response(null, { status: 404 }); }
    const size = stat.size, range = request.headers.get('range'); let start = 0, end = size - 1;
    const headers: Record<string, string> = { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
    const invalid = async (): Promise<Response> => { await handle!.close(); return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } }); };
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range); if (!m || !m[1] && !m[2]) return invalid();
      start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2])); end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) return invalid();
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    headers['Content-Length'] = String(end - start + 1);
    if (request.method === 'HEAD') { await handle.close(); return new Response(null, { status: range ? 206 : 200, headers }); }
    const stream = handle.createReadStream({ start, end, autoClose: true });
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
  } catch { await handle?.close().catch(() => undefined); return new Response(null, { status: 404 }); }
}
