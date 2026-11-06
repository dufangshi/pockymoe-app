import { describe, it, expect } from 'vitest';
import { parseManifest, importPetPack } from './packs';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const manifest = { id: 'rive-fixture', displayName: 'Rive', description: '', spritesheetPath: 'spritesheet.png', remoteCodex: { rive: { path: 'pet.riv', artboard: 'Pet', stateMachine: 'Pet' } } };
describe('Rive pack import', () => {
  it('rejects unsafe paths, missing selectors and unsupported ViewModel declarations', () => {
    for (const rive of [{...manifest.remoteCodex.rive,path:'../pet.riv'}, {...manifest.remoteCodex.rive,artboard:''}, {...manifest.remoteCodex.rive,viewModel:'Pet'}]) expect(() => parseManifest(Buffer.from(JSON.stringify({...manifest,remoteCodex:{rive}})))).toThrow('remoteCodex.rive');
    expect(parseManifest(Buffer.from(JSON.stringify(manifest))).remoteCodex?.rive).toEqual(manifest.remoteCodex.rive);
  });
  it('requires runtime verification before creating or replacing the installed pack', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rive-import-')), source = join(root, 'source'), dest = join(root, 'pets');
    try {
      await mkdir(source);
      await writeFile(join(source, 'pet.json'),JSON.stringify(manifest));
      await writeFile(join(source, 'spritesheet.png'),await readFile('test/fixtures/pets/placeholder/spritesheet.png'));
      await writeFile(join(source, 'pet.riv'),Buffer.from('RIVE\x07\x00\x00\x00'));
      await expect(importPetPack(source,dest)).rejects.toThrow('isolated runtime');
      await expect(importPetPack(source,dest,undefined,[],async () => { throw new Error('Missing state machine: Pet'); })).rejects.toThrow('Missing state machine');
      await expect(access(join(dest,manifest.id))).rejects.toThrow();
      await writeFile(join(source, 'extra.txt'),'unexpected');
      await expect(importPetPack(source,dest,undefined,[],async () => undefined)).rejects.toThrow('only pet.json');
    } finally { await rm(root,{recursive:true,force:true}); }
  });
});
