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
  it('embeds a shared texture once and rejects inconsistent asset dimensions', () => {
    const rig=JSON.parse(readFileSync('art/rive-sample/rig.json','utf8')) as Rig;
    const first=rig.images[0];
    rig.images=[first,{...structuredClone(first),name:'second'}];
    for(const p of rig.images)p.assetSize=[1024,1024];
    rig.animations=[];rig.stateMachine.layers=[];
    const data=buildRig(rig,resolve('art/rive-sample'));
    const texture=readFileSync(resolve('art/rive-sample',first.path));
    expect(data.indexOf(texture)).toBeGreaterThan(0);
    expect(data.indexOf(texture,data.indexOf(texture)+1)).toBe(-1);
    rig.images[1].assetSize=[512,512];
    expect(()=>buildRig(rig,resolve('art/rive-sample'))).toThrow('Conflicting texture dimensions');
  });
  it('validates per-vertex skin assignments used to batch disconnected mesh islands', () => {
    const rig=JSON.parse(readFileSync('art/rive-sample/rig.json','utf8')) as Rig;
    const mesh=rig.images[0].mesh!;
    mesh.influences=mesh.vertices.map(()=>[{bone:mesh.bones![0],weight:1}]);
    expect(buildRig(rig,resolve('art/rive-sample')).length).toBeGreaterThan(8);
    mesh.influences[0][0].weight=-1;
    expect(()=>buildRig(rig,resolve('art/rive-sample'))).toThrow('Invalid vertex influences');
    mesh.influences[0][0]={bone:'missing',weight:1};
    expect(()=>buildRig(rig,resolve('art/rive-sample'))).toThrow('Unknown reference');
  });
  it('validates drawing-specific bind coordinates for a shared skeleton', () => {
    const rig=JSON.parse(readFileSync('art/rive-sample/rig.json','utf8')) as Rig;
    const mesh=rig.images[0].mesh!;
    mesh.binds={[mesh.bones![0]]:{x:100,y:150}};
    expect(buildRig(rig,resolve('art/rive-sample')).length).toBeGreaterThan(8);
    mesh.binds[mesh.bones![0]].x=NaN;
    expect(()=>buildRig(rig,resolve('art/rive-sample'))).toThrow('drawing bind');
  });
  it('writes discrete Solo drawing choices and rejects non-child references', () => {
    const rig=JSON.parse(readFileSync('art/rive-sample/rig.json','utf8')) as Rig;
    rig.groups=[{name:'drawing',solo:true}];rig.images[0].parent='drawing';
    rig.animations=[{name:'swap',duration:12,tracks:[{target:'drawing',property:'activeChild',keys:[{frame:0,value:rig.images[0].name}]}]}];
    rig.stateMachine.layers=[];
    expect(buildRig(rig,resolve('art/rive-sample')).length).toBeGreaterThan(8);
    rig.groups.push({name:'empty',parent:'drawing'});
    rig.animations[0].tracks[0].keys.push({frame:6,value:'empty'});
    expect(buildRig(rig,resolve('art/rive-sample')).length).toBeGreaterThan(8);
    rig.animations[0].tracks[0].keys[0].value=rig.images[1].name;
    expect(()=>buildRig(rig,resolve('art/rive-sample'))).toThrow('Invalid Solo child');
    rig.animations[0].tracks=[{target:`${rig.images[0].name}.v0`,property:'u',keys:[{frame:0,value:0}]}];
    expect(()=>buildRig(rig,resolve('art/rive-sample'))).toThrow('Mesh UV animation');
    rig.animations[0].tracks=[{target:rig.bones[0].name,property:'x',keys:[{frame:0,value:'bad'}]}];
    expect(()=>buildRig(rig,resolve('art/rive-sample'))).toThrow('float keys');
  });
});
