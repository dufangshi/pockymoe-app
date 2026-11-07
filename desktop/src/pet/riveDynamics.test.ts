import { describe, it, expect } from 'vitest';
import { RiveDynamics, RiveFrameGate } from './riveDynamics';
describe('Rive procedural motion', () => {
  it('reacts to movement and drag, then damps to rest at different frame cadences', () => {
    for (const hz of [30,60,120]) {
      const d = new RiveDynamics(()=>.5);
      d.step(0,{x:0,y:0,angle:0});
      let peak=0, final=0;
      for(let i=0;i<hz*5;i++) {
        const out=d.step(1/hz,{x:20,y:0,angle:.2},i<hz/4?{x:800,y:0}:undefined);
        peak=Math.max(peak,Math.abs(out.swayHair));final=Math.abs(out.swayHair);
        expect(Object.values(out).every(Number.isFinite)).toBe(true);
      }
      expect(peak).toBeGreaterThan(.2);expect(final).toBeLessThan(.001);
    }
  });
  it('blinks outside idle and has no exact four-second breathing loop', () => {
    const d = new RiveDynamics(()=>0), samples=[];
    for(let i=0;i<600;i++)samples.push(d.step(1/60,{x:0,y:0,angle:-1.2}));
    expect(samples.some(s=>s.blink>.99)).toBe(true);
    expect(samples[0].breath).not.toBeCloseTo(samples[240].breath,2);
    expect(samples.every(s=>s.blink>=0&&s.blink<=1)).toBe(true);
  });
  it('caps slow draws while retaining time, and wakes immediately on an event', () => {
    const gate=new RiveFrameGate(), steps:number[]=[];
    for(let i=0;i<=60;i++){const dt=gate.take(i*1000/60,30);if(dt!==null)steps.push(dt);}
    expect(steps).toHaveLength(31);expect(steps.reduce((a,b)=>a+b,0)).toBeCloseTo(1,8);
    expect(gate.take(1001,30,true)).not.toBeNull();
    expect(gate.take(1002,30)).toBeNull();
  });
});
