import { describe, it, expect } from 'vitest';
import { parseManifest, importPetPack, MAX_RIVE_BYTES } from './packs';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, truncate } from 'node:fs/promises';
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
      await truncate(join(source, 'pet.riv'),MAX_RIVE_BYTES+1);
      await expect(importPetPack(source,dest,undefined,[],async () => undefined)).rejects.toThrow('size limit');
      await writeFile(join(source, 'pet.riv'),Buffer.from('RIVE\x07\x00\x00\x00'));
      await writeFile(join(source, 'extra.txt'),'unexpected');
      await expect(importPetPack(source,dest,undefined,[],async () => undefined)).rejects.toThrow('only pet.json');
    } finally { await rm(root,{recursive:true,force:true}); }
  });
  it('validates source resolution caps and connected rest routes', () => {
    const route={maxExitMs:350,bridges:[1,2],clips:[{value:0,animation:'idle',durationMs:1000,start:'rest',end:'rest'},{value:1,animation:'in',durationMs:1000,start:'rest',end:'bed'},{value:2,animation:'out',durationMs:1000,start:'bed',end:'rest'}]};
    const parse=(routing:unknown,backing:unknown={width:648,height:702,scale:1})=>parseManifest(Buffer.from(JSON.stringify({...manifest,remoteCodex:{rive:{...manifest.remoteCodex.rive,motions:{idle:[{value:0,durationMs:1000}]},routing,backing}}})));
    expect(parse(route).remoteCodex?.rive?.routing).toEqual(route);
    for(const q of [{...route,maxExitMs:800},{...route,bridges:[99]},{...route,bridges:[1]},{...route,clips:[...route.clips,route.clips[0]]}])expect(()=>parse(q)).toThrow('routing');
    expect(()=>parse(route,{width:648,height:702,scale:2})).toThrow('backing');
    for(const exitRestMs of [{start:501,end:0},{start:-1,end:0},{start:0,end:null}])expect(()=>parse({...route,clips:route.clips.map(c=>({...c,exitRestMs}))})).toThrow('exit rest');
    expect(()=>parse({...route,clips:route.clips.map(c=>({...c,exitAnimation:''}))})).toThrow('exit animation');
  });
  it('validates and preserves optional procedural settings', () => {
    const parse = (procedural: unknown) => parseManifest(Buffer.from(JSON.stringify({...manifest,remoteCodex:{rive:{...manifest.remoteCodex.rive,procedural}}})));
    const valid = {bodyBone:'body',idleFps:24,activeFps:60,eyeOpen:true,transientFace:true};
    expect(parse(valid).remoteCodex?.rive?.procedural).toEqual(valid);
    for (const invalid of [null,{}, {...valid,bodyBone:''}, {...valid,idleFps:60}, {...valid,activeFps:24}]) expect(()=>parse(invalid)).toThrow('procedural');
    expect(()=>parse({...valid,eyeOpen:'yes'})).toThrow('eyeOpen');
    expect(()=>parse({...valid,sourceFps:24})).toThrow('sourceFps');
    expect(()=>parse({...valid,transientFace:'yes'})).toThrow('transientFace');
    expect(()=>parse({...valid,eyeOpen:false})).toThrow('transientFace');
    expect(parse({...valid,eyeOpen:false,transientFace:false}).remoteCodex?.rive?.procedural?.transientFace).toBe(false);
  });
  it('permits source cadence only for connected routed drawings', () => {
    const rive={...manifest.remoteCodex.rive,procedural:{bodyBone:'body',idleFps:24,activeFps:60,sourceFps:24},motions:{idle:[{value:0,durationMs:1000}]},routing:{maxExitMs:350,bridges:[],clips:[{value:0,animation:'idle',durationMs:1000,start:'rest',end:'rest'}]}};
    const parse=(sourceFps:unknown)=>parseManifest(Buffer.from(JSON.stringify({...manifest,remoteCodex:{rive:{...rive,procedural:{...rive.procedural,sourceFps}}}})));
    expect(parse(24).remoteCodex?.rive?.procedural?.sourceFps).toBe(24);
    expect(parse(30).remoteCodex?.rive?.procedural?.sourceFps).toBe(30);
    for(const v of [0,60,'24',null])expect(()=>parse(v)).toThrow('sourceFps');
  });
});
