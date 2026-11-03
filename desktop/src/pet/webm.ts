/** Bounded EBML validation before Chromium sees a file: one un-laced VP9 alpha track. */
export function inspectWebM(bytes: Buffer): { width: number; height: number; duration: number; fps: number; frames: number } {
  const bad = (): never => { throw new Error('Invalid pet pack: invalid VP9-alpha WebM'); };
  if (bytes.length < 4 || bytes.readUInt32BE(0) !== 0x1a45dfa3) bad();
  let width = 0, height = 0, duration = 0, scale = 1_000_000, defaultNs = 0, codec = '', alpha = 0, type = 0, tracks = 0, frames = 0, doc = '', lastMs = 0;
  function vint(at: number, id = false): { n: number; next: number; unknown: boolean } {
    const first = bytes[at]; if (!first) return bad();
    let length = 1; while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
    if (length > (id ? 4 : 8) || at + length > bytes.length) return bad();
    let n = id ? first : first & ((0x80 >> (length - 1)) - 1), unknown = !id && n === ((0x80 >> (length - 1)) - 1);
    for (let i = 1; i < length; i++) { n = n * 256 + bytes[at + i]; unknown &&= bytes[at + i] === 255; }
    if (!unknown && !Number.isSafeInteger(n)) return bad();
    return { n, next: at + length, unknown };
  }
  const uint = (a: number, z: number): number => { if (z - a > 8) return bad(); let n = 0; for (; a < z; a++) n = n * 256 + bytes[a]; return n; };
  function walk(a: number, z: number, depth: number, cluster = 0): void {
    if (depth > 8) bad();
    while (a < z) {
      const id = vint(a, true), size = vint(id.next), start = size.next, end = size.unknown ? z : start + size.n;
      if (end > z || end <= a) bad();
      switch (id.n) {
        case 0x1a45dfa3: case 0x18538067: case 0x1549a966: case 0x1654ae6b: case 0xae: case 0xe0: case 0x1f43b675: case 0xa0:
          if (id.n === 0xae) tracks++; walk(start, end, depth + 1, cluster); break;
        case 0x4282: doc = bytes.toString('ascii', start, end); break;
        case 0x2ad7b1: scale = uint(start, end); break;
        case 0x4489: if (![4, 8].includes(end - start)) bad(); duration = end - start === 4 ? bytes.readFloatBE(start) : bytes.readDoubleBE(start); break;
        case 0x86: codec = bytes.toString('ascii', start, end); break;
        case 0x83: type = uint(start, end); break;
        case 0x23e383: defaultNs = uint(start, end); break;
        case 0xb0: width = uint(start, end); break;
        case 0xba: height = uint(start, end); break;
        case 0x53c0: alpha = uint(start, end); break;
        case 0xe7: cluster = uint(start, end); break;
        case 0xa3: case 0xa1: {
          const track = vint(start); if (track.n !== 1 || track.next + 3 > end || bytes[track.next + 2] & 6) bad();
          frames++; lastMs = Math.max(lastMs, (cluster + bytes.readInt16BE(track.next)) * scale / 1e6); break;
        }
      }
      a = end;
    }
  }
  walk(0, bytes.length, 0);
  const seconds = duration * scale / 1e9, fps = 1e9 / defaultNs;
  if (doc !== 'webm' || tracks !== 1 || codec !== 'V_VP9' || type !== 1 || alpha !== 1 || !width || !height || width > 1024 || height > 1024 || width * height > 786432 || !Number.isFinite(seconds) || seconds <= 0 || seconds > 12.001 || !Number.isFinite(fps) || fps <= 0 || fps > 30.001 || frames > 360 || Math.abs(frames / fps - seconds) > .075 || Math.abs(lastMs / 1000 + 1 / fps - seconds) > .075) bad();
  return { width, height, duration: seconds, fps, frames };
}
