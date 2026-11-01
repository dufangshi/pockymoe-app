import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { PetCatalog } from '../src/main/petCatalog';

it('serves only cataloged atlas files and supplies bundled attribution without filesystem paths', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pockymoe-catalog-'));
  try {
    const pack = join(root, 'frost'); mkdirSync(pack);
    writeFileSync(join(pack, 'pet.json'), JSON.stringify({ id: 'frost', displayName: 'Frost', spritesheetPath: 'spritesheet.webp', spriteVersionNumber: 2 }));
    writeFileSync(join(pack, 'spritesheet.webp'), 'fixture-image');
    const catalog = new PetCatalog([root]);
    expect(catalog.list()).toEqual([expect.objectContaining({ author: 'Pockymoe', rows: 11, thumbnail: 'pockymoe-pet://atlas/frost' })]);
    expect(JSON.stringify(catalog.list())).not.toContain(root);
    expect(await catalog.asset('pockymoe-pet://atlas/frost').text()).toBe('fixture-image');
    for (const path of ['pockymoe-pet://atlas/unknown', 'pockymoe-pet://atlas/%2e%2e%2fpet.json', 'pockymoe-pet://other/frost']) expect(catalog.asset(path).status).toBe(404);
    rmSync(join(pack, 'spritesheet.webp')); symlinkSync(join(pack, 'pet.json'), join(pack, 'spritesheet.webp'));
    expect(catalog.asset('pockymoe-pet://atlas/frost').status).toBe(404);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it('ignores unsafe manifests and never replaces bundled catalog assets with an imported duplicate', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pockymoe-catalog-'));
  try {
    for (const [directory, image] of [['bundled', 'bundled-image'], ['imported', 'user-image']]) {
      mkdirSync(join(root, directory, 'moe'), { recursive: true });
      writeFileSync(join(root, directory, 'moe/pet.json'), JSON.stringify({ displayName: 'Moe', spritesheetPath: 'spritesheet.png' }));
      writeFileSync(join(root, directory, 'moe/spritesheet.png'), image);
    }
    mkdirSync(join(root, 'imported/unsafe')); writeFileSync(join(root, 'imported/unsafe/pet.json'), JSON.stringify({ spritesheetPath: '../moe/pet.json' }));
    const catalog = new PetCatalog([join(root, 'bundled'), join(root, 'imported')]);
    expect(catalog.list()).toHaveLength(1);
    expect(await catalog.asset('pockymoe-pet://atlas/moe').text()).toBe('bundled-image');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
