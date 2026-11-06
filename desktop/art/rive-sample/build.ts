import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { buildRig, type Rig } from '../tools/rive/writer.ts';
const base = fileURLToPath(new URL('./', import.meta.url));
const output = resolve(process.argv[2] ?? '.scratch/rive/pack'); mkdirSync(output, { recursive: true });
const rig = JSON.parse(readFileSync(resolve(base, 'rig.json'), 'utf8')) as Rig;
writeFileSync(resolve(output, 'pet.riv'), buildRig(rig, base));
const frame = new PNG({ width: 192, height: 208 });
for (const part of [...rig.images].reverse()) {
  if (part.opacity === 0) continue;
  const png = PNG.sync.read(readFileSync(resolve(base, part.path)));
  const left = Math.round(part.x - png.width / 2), top = Math.round(part.y - png.height / 2);
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const dx = x + left, dy = y + top; if (dx < 0 || dx >= 192 || dy < 0 || dy >= 208) continue;
    const s = (y * png.width + x) * 4, d = (dy * 192 + dx) * 4;
    const a = png.data[s + 3] / 255, b = frame.data[d + 3] / 255, out = a + b * (1 - a);
    if (!out) continue;
    for (let c = 0; c < 3; c++) frame.data[d + c] = Math.round((png.data[s + c] * a + frame.data[d + c] * b * (1 - a)) / out);
    frame.data[d + 3] = Math.round(out * 255);
  }
}
const atlas = new PNG({ width: 1536, height: 1872 });
for (let y = 0; y < 9; y++) for (let x = 0; x < 8; x++) PNG.bitblt(frame, atlas, 0, 0, 192, 208, x * 192, y * 208);
writeFileSync(resolve(output, 'spritesheet.png'), PNG.sync.write(atlas));
writeFileSync(resolve(output, 'pet.json'), JSON.stringify({ id: 'mint-courier', displayName: 'Mint courier', description: 'Original Rive prototype; authored without the Rive Editor.', author: 'Pockymoe · original LNZ generated art', license: 'CC0-1.0', spritesheetPath: 'spritesheet.png', remoteCodex: { rive: { path: 'pet.riv', artboard: 'Pet', stateMachine: 'Pet' }, faceBox: [.25,.28,.75,.64] } }, null, 2) + '\n');
console.log(`Pack: ${output}`);
