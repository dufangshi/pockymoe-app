// Original procedural artwork; no third-party image/font assets. Run with Node 22+.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const width = 1536, height = 1872, pixels = Buffer.alloc(width * height * 4);
const counts = [6, 8, 8, 4, 5, 8, 6, 6, 6];
function ellipse(cx, cy, rx, ry, color, clip) {
  for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
    if (x < clip.x || y < clip.y || x >= clip.x + 192 || y >= clip.y + 208) continue;
    const distance = Math.sqrt(((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2);
    const alpha = Math.min(1, Math.max(0, (1 - distance) * Math.min(rx, ry) + .5));
    if (!alpha) continue;
    const offset = (y * width + x) * 4, oldAlpha = pixels[offset + 3] / 255, outAlpha = alpha + oldAlpha * (1 - alpha);
    for (let c = 0; c < 3; c++) pixels[offset + c] = (color[c] * alpha + pixels[offset + c] * oldAlpha * (1 - alpha)) / outAlpha;
    pixels[offset + 3] = outAlpha * 255;
  }
}
for (let row = 0; row < 9; row++) for (let frame = 0; frame < counts[row]; frame++) {
  const clip = { x: frame * 192, y: row * 208 }, t = frame / counts[row] * Math.PI * 2;
  let cx = clip.x + 96, cy = clip.y + 121, rx = 62, ry = 65;
  if (row === 0) ry += Math.sin(t) * 1.8;
  if (row === 1 || row === 2) { cx += (row === 1 ? 1 : -1) * Math.sin(t) * 7; cy += Math.cos(t * 2) * 5; rx = 59; }
  if (row === 4) { cy -= [0, -6, 36, 14, 0][frame]; ry += [0, -10, 4, -5, 0][frame]; }
  if (row === 5) { ry = 51 + Math.sin(t) * 2; cy += 13; }
  if (row === 6) { cy -= Math.sin(t) * 2; rx = 60; }
  ellipse(cx, cy + 51, rx - 3, 12, [41, 78, 173], clip);
  ellipse(cx, cy, rx, ry, [55, 111, 229], clip);
  ellipse(cx - 15, cy - 20, 36, 31, [66, 124, 239], clip);
  const direction = row === 1 ? 12 : row === 2 ? -12 : row === 8 ? 7 * Math.sin(t / 2) : 0;
  for (const side of [-1, 1]) {
    const ex = cx + side * 20 + direction, ey = cy - (row === 5 ? -3 : 8);
    const blink = row === 0 && frame === 3;
    ellipse(ex, ey, 7, blink ? 1.8 : row === 5 ? 4 : 9, [243, 248, 255], clip);
    if (!blink) ellipse(ex + direction * .15, ey + (row === 5 ? 2 : 1), 3.2, 5, [24, 43, 88], clip);
  }
  ellipse(cx + direction, cy + 17, 5, row === 6 ? 5 : 2.5, [22, 54, 116], clip);
  if (row === 3) ellipse(cx + 60, cy - 26 - Math.sin(frame / 3 * Math.PI) * 25, 14, 23, [55, 111, 229], clip);
  if (row === 7) { ellipse(cx - 10 + Math.sin(t) * 12, cy + 39, 13, 8, [29, 70, 157], clip); ellipse(cx + 23 - Math.sin(t) * 8, cy + 42, 13, 8, [29, 70, 157], clip); }
  if (row === 8) { ellipse(cx + 39, cy + 17, 17, 17, [216, 230, 255], clip); ellipse(cx + 39, cy + 17, 12, 12, [55, 111, 229], clip); }
}
function crc32(bytes) { let c = -1; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = c >>> 1 ^ (0xedb88320 & -(c & 1)); } return (c ^ -1) >>> 0; }
function chunk(type, data) { const name = Buffer.from(type), result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); name.copy(result, 4); data.copy(result, 8); result.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8); return result; }
const raw = Buffer.alloc(height * (width * 4 + 1));
for (let y = 0; y < height; y++) pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
const out = fileURLToPath(new URL('../../../test/fixtures/pets/placeholder/', import.meta.url));
mkdirSync(out, { recursive: true });
writeFileSync(out + 'spritesheet.png', Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
writeFileSync(out + 'pet.json', JSON.stringify({ id: 'placeholder', displayName: '小蓝 · Cobalt', description: 'An original little cobalt companion. Procedural placeholder artwork.', spritesheetPath: 'spritesheet.png', spriteVersionNumber: 1 }, null, 2) + '\n');
console.log('Generated placeholder: 1536×1872, 9 rows, transparent unused cells.');
