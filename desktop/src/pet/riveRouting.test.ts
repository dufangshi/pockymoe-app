import { describe, expect, it } from 'vitest';
import { RiveRestRouter, riveBackingSize, type RiveRouting } from './riveRouting';
const config: RiveRouting = {maxExitMs:350,bridges:[2,3],clips:[{value:0,animation:'idle',durationMs:1000,start:'rest',end:'rest',loop:true},{value:1,animation:'work',durationMs:2000,start:'rest',end:'rest'},{value:2,animation:'bed-in',durationMs:1000,start:'rest',end:'bed'},{value:3,animation:'bed-out',durationMs:1000,start:'bed',end:'rest'},{value:4,animation:'bed',durationMs:2000,start:'bed',end:'bed',loop:true}]};
describe('material-safe routing',()=>{
  it('reverses to the nearer start and enters only at shared rest',()=>{
    const r=new RiveRestRouter(config,1);r.step(.4);r.request(0);
    const mid=r.step(.175);expect(mid.value).toBe(1);expect(mid.time).toBeCloseTo(.2);
    const boundary=r.step(.175);expect(boundary.time).toBe(0);expect(boundary.boundary).toBe(true);
    expect(r.step(0)).toMatchObject({value:0,time:0,leaving:false});
  });
  it('finishes forward at the nearer end',()=>{
    const r=new RiveRestRouter(config,1);r.step(1.8);r.request(0);expect(r.step(.2)).toMatchObject({value:1,time:2,boundary:true});
    expect(r.step(0).value).toBe(0);
  });
  it('exits a bed family through the authored bed-out within the total budget',()=>{
    const r=new RiveRestRouter(config,4);r.step(.4);r.request(1);
    const seen=new Set<number>();for(let i=0;i<35;i++)seen.add(r.step(.01).value);
    expect(seen.has(3)).toBe(true);expect(r.step(0)).toMatchObject({value:1,time:0});
  });
  it('replans a second interrupt without changing the current material or position',()=>{
    const r=new RiveRestRouter(config,1);r.step(.5);r.request(0);const before=r.step(.1);r.request(2);
    expect(r.step(0)).toMatchObject({value:before.value,time:before.time});
  });
  it('reaches every fixture target from both halves within the combined budget',()=>{
    for(const from of config.clips)for(const target of config.clips)for(const phase of [.25,.75]) {
      const r=new RiveRestRouter(config,from.value);r.step(from.durationMs/1000*phase);r.request(target.value,true);
      for(let i=0;i<35;i++)r.step(.01);
      const landed=r.step(0);expect(landed).toMatchObject({value:target.value,leaving:false});expect(landed.time).toBeLessThanOrEqual(.35);
    }
  });
  it('caps source backing resolution and preserves the aspect ratio and legacy DPR',()=>{
    expect(riveBackingSize(1037,1123,2,{width:648,height:702,scale:1})).toEqual({width:648,height:702});
    expect(riveBackingSize(648,702,2,{width:648,height:702,scale:1.25})).toEqual({width:810,height:878});
    expect(riveBackingSize(200,220,2)).toEqual({width:400,height:440});
  });
});
