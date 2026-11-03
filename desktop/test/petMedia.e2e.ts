import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { generateMediaFixture } from './petMediaFixture';

test('synthetic VP9 alpha streams through the pet protocol and switches without blanking', async () => {
  test.skip(!process.env.POCKYMOE_FFMPEG, 'Dedicated pet-media CI supplies the local synthetic encoder');
  test.setTimeout(45_000);
  const root=mkdtempSync(join(tmpdir(),'pet-synthetic-'));const pack=join(root,'pack');mkdirSync(pack);generateMediaFixture(pack);
  const out=process.env.POCKYMOE_DESKTOP_EVIDENCE || join(tmpdir(),'pet-media-evidence');
  const app=await electron.launch({args:[resolve(out,'pet/qa1/harness/main/index.js')],env:{...process.env,POCKYMOE_CLIP_PACK:pack,ELECTRON_RENDERER_URL:''}});
  try{
    await expect.poll(()=>app.windows().length).toBe(2);
    let sprite=app.windows()[0];for(const p of app.windows()){await p.waitForFunction(()=>document.body.dataset.surface);if(await p.locator('body').getAttribute('data-surface')==='sprite')sprite=p;}
    await sprite.evaluate(() => {
      const pending = new Set<number>(), request = HTMLVideoElement.prototype.requestVideoFrameCallback, cancel = HTMLVideoElement.prototype.cancelVideoFrameCallback;
      HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
        let id = 0; id = request.call(this, (now, metadata) => { pending.delete(id); callback(now, metadata); }); pending.add(id); return id;
      };
      HTMLVideoElement.prototype.cancelVideoFrameCallback = function (id) { pending.delete(id); cancel.call(this, id); };
      Object.assign(window, { pendingVideoCallbacks: () => pending.size });
    });
    await app.evaluate(()=> (globalThis as unknown as {petHarness:{settings(p:unknown):void}}).petHarness.settings({petId:'synthetic',petSize:'L'}));
    await expect(sprite.locator('#character')).toHaveClass(/clips/);
    await expect(sprite.locator('video.pet-video')).toHaveCount(2);
    const videos=await sprite.locator('video.pet-video').evaluateAll(v=>v.map(x=>({src:(x as HTMLVideoElement).src,error:(x as HTMLVideoElement).error?.message})));expect(videos.every(v=>v.src.startsWith('pockymoe-pet://media/')&&!v.error)).toBe(true);
    const sample=await sprite.evaluate(async()=>{
      const c=document.querySelector<HTMLCanvasElement>('#clip')!,ctx=c.getContext('2d')!;
      const source=document.querySelector<HTMLVideoElement>('video.pet-video')!.src;
      const records:{opaque:number;corner:number;decoders:number;time:number;path:string}[]=[];
      for(let i=0;i<340;i++){records.push({opaque:ctx.getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data[3],corner:ctx.getImageData(0,0,1,1).data[3],decoders:document.querySelectorAll('video.pet-video').length,time:performance.now(),path:document.querySelector<HTMLVideoElement>('video.pet-video')!.src});await new Promise<void>(r=>requestAnimationFrame(()=>r()));}
      return {records,source};
    });
    expect(sample.records.every(r=>r.opaque>200&&r.corner===0&&r.decoders<=2)).toBe(true);
    expect(new Set(sample.records.map(r=>r.path)).size).toBeGreaterThan(1);
    const range=await app.evaluate(async({net},url)=>{const r=await net.fetch(url,{headers:{Range:'bytes=0-3'}});return {status:r.status,type:r.headers.get('content-type'),range:r.headers.get('content-range'),bytes:[...new Uint8Array(await r.arrayBuffer())]};},sample.source);
    expect(range).toMatchObject({status:206,type:'video/webm',bytes:[26,69,223,163]});expect(range.range).toMatch(/^bytes 0-3\//);
    await sprite.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => sprite.locator('video.pet-video').evaluateAll(v => v.every(x => (x as HTMLVideoElement).paused && (x as HTMLVideoElement).currentTime === 0))).toBe(true);
    await app.evaluate(()=> (globalThis as unknown as {petHarness:{settings(p:unknown):void}}).petHarness.settings({petSize:'M'}));
    await expect.poll(() => sprite.locator('#clip').evaluate(c => (c as HTMLCanvasElement).width === Math.round(c.clientWidth * devicePixelRatio))).toBe(true);
    await sprite.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(() => sprite.locator('video.pet-video').evaluateAll(v => v.some(x => !(x as HTMLVideoElement).paused))).toBe(true);
    await app.evaluate(()=> (globalThis as unknown as {petHarness:{settings(p:unknown):void}}).petHarness.settings({petId:'moe'}));
    await expect(sprite.locator('video.pet-video')).toHaveCount(0);
    expect(await sprite.evaluate(() => (window as unknown as { pendingVideoCallbacks(): number }).pendingVideoCallbacks())).toBe(0);
    expect(await app.evaluate(async({net},url)=>(await net.fetch(url)).status,sample.source)).toBe(404);
  }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});
