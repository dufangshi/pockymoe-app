import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { PetCatalog } from '../src/main/petCatalog';

it('serves only cataloged atlas files and supplies bundled attribution without filesystem paths', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pockymoe-catalog-'));
  try {
    const pack = join(root, 'moe'); mkdirSync(pack);
    writeFileSync(join(pack, 'pet.json'), JSON.stringify({ id: 'moe', displayName: 'Moe', spritesheetPath: 'spritesheet.webp', spriteVersionNumber: 2 }));
    writeFileSync(join(pack, 'spritesheet.webp'), 'fixture-image');
    const catalog = new PetCatalog([root]);
    expect(catalog.list()).toEqual([expect.objectContaining({ author: 'Pockymoe', rows: 11, thumbnail: 'pockymoe-pet://atlas/moe' })]);
    expect(JSON.stringify(catalog.list())).not.toContain(root);
    expect(await (await catalog.asset('pockymoe-pet://atlas/moe')).text()).toBe('fixture-image');
    for (const path of ['pockymoe-pet://atlas/unknown', 'pockymoe-pet://atlas/%2e%2e%2fpet.json', 'pockymoe-pet://other/moe']) expect((await catalog.asset(path)).status).toBe(404);
    rmSync(join(pack, 'spritesheet.webp')); symlinkSync(process.platform === 'win32' ? pack : join(pack, 'pet.json'), join(pack, 'spritesheet.webp'), process.platform === 'win32' ? 'junction' : 'file');
    expect((await catalog.asset('pockymoe-pet://atlas/moe')).status).toBe(404);
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
    expect(await (await catalog.asset('pockymoe-pet://atlas/moe')).text()).toBe('bundled-image');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it('removes only a pack from the user directory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pockymoe-catalog-'));
  try {
    for (const [directory, id] of [['bundled', 'moe'], ['user', 'mine']]) {
      mkdirSync(join(root, directory, id), { recursive: true });
      writeFileSync(join(root, directory, id, 'pet.json'), JSON.stringify({ displayName: id, spritesheetPath: 'spritesheet.webp', spriteVersionNumber: 2 }));
      writeFileSync(join(root, directory, id, 'spritesheet.webp'), 'image');
    }
    const catalog = new PetCatalog([join(root, 'bundled'), join(root, 'user')]);
    expect(catalog.list().map(({ id, imported }) => [id, !!imported])).toEqual([['moe', false], ['mine', true]]);
    for (const id of ['moe', 'unknown', '..', '../bundled/moe']) await expect(catalog.remove(id)).rejects.toThrow();
    expect(existsSync(join(root, 'bundled/moe/pet.json'))).toBe(true);
    await catalog.remove('mine');
    expect(existsSync(join(root, 'user/mine'))).toBe(false);
    expect(catalog.list().map(({ id }) => id)).toEqual(['moe']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
