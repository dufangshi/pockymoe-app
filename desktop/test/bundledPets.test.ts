import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { PetCatalog } from '../src/main/petCatalog';
const { verifyBundledPets } = createRequire(import.meta.url)('../scripts/verify-bundled-pets.cjs') as { verifyBundledPets(resources: string): void };

it('has exactly moe in the bundled catalog', () => {
  expect(new PetCatalog([resolve('assets/pets')]).list().map(pack => pack.id)).toEqual(['moe']);
});
it('asserts the packaged built-in list is exactly moe, rejecting extra and missing packs', () => {
  const resources = mkdtempSync(join(tmpdir(), 'pockymoe-packaged-pets-'));
  try {
    mkdirSync(join(resources, 'pets/moe'), { recursive: true });
    writeFileSync(join(resources, 'pets/moe/pet.json'), JSON.stringify({ id: 'moe' }));
    expect(() => verifyBundledPets(resources)).not.toThrow();
    mkdirSync(join(resources, 'pets/extra'));
    expect(() => verifyBundledPets(resources)).toThrow('exactly moe');
    rmSync(join(resources, 'pets/moe'), { recursive: true });
    expect(() => verifyBundledPets(resources)).toThrow('exactly moe');
    rmSync(join(resources, 'pets/extra'), { recursive: true });
    expect(() => verifyBundledPets(resources)).toThrow('exactly moe');
  } finally { rmSync(resources, { recursive: true, force: true }); }
});
