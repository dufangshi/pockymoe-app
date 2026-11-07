import { describe, expect, it } from 'vitest';
import { buildRig, varuint, weights, type Rig } from './writer.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
describe('Rive authoring', () => {
  it('encodes uint32 boundaries without signed bitwise truncation', () => {
    expect([...varuint(0xffffffff)]).toEqual([255,255,255,255,15]);
    for (const n of [-1,.5,NaN,Infinity,0x100000000]) expect(() => varuint(n)).toThrow();
  });
  it('packs normalized distance weights without losing byte mass', () => {
    const bs = Array.from({length:8},(_,i)=>({x:i*20,y:0,endX:i*20,endY:100}));
    for (let x=-20;x<200;x+=7) {
      const w=weights(x,45,bs); const v=Array.from({length:4},(_,i)=>(w.values>>>(i*8))&255);
      expect(v.reduce((a,b)=>a+b,0)).toBe(255);
      expect((w.indices&255)).toBeGreaterThan(0);
    }
  });
  it('authors opacity groups without allowing transformed mesh parents', () => {
    const rig=JSON.parse(readFileSync('art/rive-sample/rig.json','utf8')) as Rig;
    rig.groups=[{name:'pose',opacity:0}]; rig.images[0].parent='pose';
    rig.animations[0].tracks.push({target:'pose',property:'opacity',keys:[{frame:0,value:1}]});
    expect(buildRig(rig,resolve('art/rive-sample')).subarray(0,4).toString()).toBe('RIVE');
    rig.images[0].parent=rig.bones[0].name;
    expect(()=>buildRig(rig,resolve('art/rive-sample'))).toThrow('identity group');
  });
  it('rejects broken mesh topology and unknown animation targets before writing', () => {
    const rig=JSON.parse(readFileSync('art/rive-sample/rig.json','utf8')) as Rig;
    rig.images[0].mesh!.triangles[0]=999;
    expect(()=>buildRig(rig,resolve('art/rive-sample'))).toThrow('triangles');
    rig.images[0].mesh!.triangles[0]=0;rig.animations[0].tracks[0].target='absent';
    expect(()=>buildRig(rig,resolve('art/rive-sample'))).toThrow('Unknown track target');
  });
});
