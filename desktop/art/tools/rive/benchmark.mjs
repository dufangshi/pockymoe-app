import { PNG } from 'pngjs';
import electronExecutable from 'electron';
import { _electron as electron } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { summarizeNativeTrace } from './trace-summary.mjs';
import { cpus } from 'node:os';
import { createHash } from 'node:crypto';
const [,,pack,out,id='mint-courier',seconds='60']=process.argv;
if(!pack||!out)throw new Error('Usage: node art/tools/rive/benchmark.mjs PACK OUT ID [seconds=60]');
const dpr=Number(process.env.RIVE_BENCH_DPR??'1');
const profile=process.env.RIVE_BENCH_PROFILE==='1';
const control=process.env.RIVE_BENCH_BACKEND??'auto';
if(!['auto','webgl2','canvas','quad'].includes(control))throw new Error('Invalid RIVE_BENCH_BACKEND');
if(![1,2].includes(dpr))throw new Error('RIVE_BENCH_DPR must be 1 or 2');
const manifest=JSON.parse(await readFile(resolve(pack,'pet.json'),'utf8'));
if(manifest.id!==id)throw new Error(`Benchmark ID ${id} does not match pack ${manifest.id}`);
const riveBytes=manifest.remoteCodex?.rive?await readFile(resolve(pack,manifest.remoteCodex.rive.path)):null;
const packEvidence={id:manifest.id,...(riveBytes?{riveBytes:riveBytes.length,riveSha256:createHash('sha256').update(riveBytes).digest('hex')}:{})};
await mkdir(out,{recursive:true});
const app=await electron.launch({executablePath:electronExecutable,args:['--no-sandbox',...(process.platform==='linux'?['--ozone-platform=x11','--enable-unsafe-swiftshader']:[]),`--force-device-scale-factor=${dpr}`,resolve(process.env.RIVE_BENCH_HARNESS??'.local/desktop-evidence/pet/qa1/harness/main/index.js')],env:{...process.env,TMPDIR:resolve(out),ELECTRON_RENDERER_URL:'',POCKYMOE_CLIP_PACK:resolve(pack)}});
try{
 await app.firstWindow();
 await app.evaluate(async()=>{while(!globalThis.petHarness)await new Promise(r=>setTimeout(r,20));});
 await app.evaluate((_,id)=>globalThis.petHarness.settings({petId:id,petEdgeHide:false}),id);
 let sprite;
 for(const page of app.windows()){
  await page.waitForFunction(()=>document.body.dataset.surface);
  if(await page.locator('body').getAttribute('data-surface')==='sprite')sprite=page;
 }
 if(!sprite)throw new Error('No pet window');
 sprite.on('pageerror',e=>console.error(e.message));
 // Keep both idle measurements awake with the same random choices. Production
 // still uses Math.random; reload installs this before either sequencer starts.
 await sprite.addInitScript(()=>{Math.random=()=>0.5;});
 await sprite.addInitScript(()=>{
  globalThis.benchDraws={frames:0,calls:0};let drawn=false;
  for(const name of ['drawElements','drawElementsInstanced','drawArrays','drawArraysInstanced']){
   const native=WebGL2RenderingContext.prototype[name];WebGL2RenderingContext.prototype[name]=function(...args){const result=native.apply(this,args);globalThis.benchDraws.calls++;drawn=true;return result;};
  }
  const raf=window.requestAnimationFrame;window.requestAnimationFrame=callback=>raf.call(window,time=>{callback(time);if(drawn){globalThis.benchDraws.frames++;drawn=false;}});
 });
 if(profile)await sprite.addInitScript(()=>{
  const stats=globalThis.riveGLProfile={frames:[],textures:[],buffers:0,frame:{calls:0,triangles:0,submitMs:0,readbackMs:0,uploadBytes:0}};
  const proto=WebGL2RenderingContext.prototype;
  for(const name of ['drawElements','drawElementsInstanced','drawArrays','drawArraysInstanced']){
   const native=proto[name];proto[name]=function(...args){
    const t=performance.now(),result=native.apply(this,args);stats.frame.calls++;
    const count=name.startsWith('drawElements')?args[1]:args[2],instances=name==='drawElementsInstanced'?args[4]:name==='drawArraysInstanced'?args[3]:1;
    if(args[0]===this.TRIANGLES)stats.frame.triangles+=count*instances/3;else if(args[0]===this.TRIANGLE_STRIP||args[0]===this.TRIANGLE_FAN)stats.frame.triangles+=Math.max(0,count-2)*instances;
    stats.frame.submitMs+=performance.now()-t;return result;
   };
  }
  const read=proto.readPixels;proto.readPixels=function(...args){const t=performance.now(),result=read.apply(this,args);stats.frame.readbackMs+=performance.now()-t;return result;};
  const raf=window.requestAnimationFrame;window.requestAnimationFrame=callback=>raf.call(window,time=>{callback(time);if(stats.frame.calls){stats.frames.push(stats.frame);stats.frame={calls:0,triangles:0,submitMs:0,readbackMs:0,uploadBytes:0};}});
  for(const name of ['bufferData','bufferSubData']){const native=proto[name];proto[name]=function(...args){const data=args[name==='bufferData'?1:2],bytes=typeof data==='number'?data:args.length>=5?(args[4]||(data?.length??0)-(args[3]??0))*(data?.BYTES_PER_ELEMENT??1):data?.byteLength??0;stats.buffers+=bytes;stats.frame.uploadBytes+=bytes;return native.apply(this,args);};}
  const storage=proto.texStorage2D;proto.texStorage2D=function(...args){stats.textures.push({kind:'storage',levels:args[1],format:args[2],width:args[3],height:args[4]});return storage.apply(this,args);};
  const texture=proto.texImage2D;proto.texImage2D=function(...args){const image=args[5];stats.textures.push({kind:'image',level:args[1],format:args[2],width:args.length>=9?args[3]:image?.width,height:args.length>=9?args[4]:image?.height});return texture.apply(this,args);};
 });
 const url=new URL(sprite.url());if(control!=='auto')url.searchParams.set('riveControl',control);await sprite.goto(url.href);
 await sprite.waitForFunction(()=>document.querySelector('#character.rive')||document.querySelector('#character.clips'));
 await sprite.waitForTimeout(3000);
 await sprite.screenshot({path:resolve(out,'pet-window.png'),omitBackground:true});
 await sprite.evaluate(()=>{globalThis.benchDraws={frames:0,calls:0};});
 const trace=await sprite.context().newCDPSession(sprite),traceEvents=[];
 trace.on('Tracing.dataCollected',({value})=>traceEvents.push(...value));
 await trace.send('Tracing.start',{categories:'gpu,disabled-by-default-gpu.service'+(profile?',devtools.timeline,v8.execute':''),transferMode:'ReportEvents'});
 if(profile)await sprite.evaluate(()=>{globalThis.riveGLProfile.frames=[];});
 await sprite.evaluate(()=>{globalThis.riveReadbacks=0;globalThis.riveCanvasReads=0;const canvasNative=CanvasRenderingContext2D.prototype.getImageData;CanvasRenderingContext2D.prototype.getImageData=function(...args){globalThis.riveCanvasReads++;return canvasNative.apply(this,args);};const native=WebGL2RenderingContext.prototype.readPixels;WebGL2RenderingContext.prototype.readPixels=function(...args){globalThis.riveReadbacks++;return native.apply(this,args);};});
 const read=()=>app.evaluate(({app,BrowserWindow})=>({time:performance.now(),metrics:app.getAppMetrics().map(m=>({pid:m.pid,type:m.type,cpu:m.cpu.percentCPUUsage,cumulativeCPU:m.cpu.cumulativeCPUUsage,memory:m.memory})),petPid:BrowserWindow.getAllWindows().find(w=>!w.getParentWindow()).webContents.getOSProcessId()}));
 const media=()=>sprite.evaluate(()=>({mood:document.querySelector('#app')?.dataset.mood,videos:[...document.querySelectorAll('video')].map(v=>({src:v.currentSrc,currentTime:v.currentTime,paused:v.paused,ended:v.ended,readyState:v.readyState,totalVideoFrames:v.getVideoPlaybackQuality().totalVideoFrames,droppedVideoFrames:v.getVideoPlaybackQuality().droppedVideoFrames}))}));
 const mediaStart=await media(),samples=[await read()];
 for(let i=0;i<Number(seconds);i++){
  await sprite.waitForTimeout(1000);
  samples.push(await read());
  if(i%20===19)console.log(`${id}: ${i+1}/${seconds}s`);
 }
 const completed=new Promise(resolve=>trace.once('Tracing.tracingComplete',resolve));await trace.send('Tracing.end');await completed;
 const nativeTrace=summarizeNativeTrace(traceEvents);await writeFile(resolve(out,'native-trace.json'),JSON.stringify({traceEvents}));
 const mediaEnd=await media(),first=samples[0],last=samples.at(-1),elapsed=(last.time-first.time)/1000;
 const total=(sample,type)=>sample.metrics.filter(m=>type==='pet'?m.pid===sample.petPid:m.type===type).reduce((s,m)=>s+m.cumulativeCPU,0);
 const mean=type=>100*(total(last,type)-total(first,type))/elapsed;
 const allCPU=sample=>sample.metrics.reduce((s,m)=>s+m.cumulativeCPU,0);
 if(first.petPid!==last.petPid)throw new Error('Pet renderer restarted during measurement');
 const info=await app.evaluate(async({app})=>({features:app.getGPUFeatureStatus(),gpu:await app.getGPUInfo('basic')}));
 const readbacks=await sprite.evaluate(()=>globalThis.riveReadbacks);
 const canvasReadbacks=await sprite.evaluate(()=>globalThis.riveCanvasReads);
 const drawCounts=await sprite.evaluate(()=>globalThis.benchDraws);
 const display=await sprite.evaluate(()=>({dpr:devicePixelRatio,width:innerWidth,height:innerHeight,backend:document.querySelector('#rive')?.dataset.backend,control:document.querySelector('#rive')?.dataset.control,canvases:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height,cssWidth:c.clientWidth,cssHeight:c.clientHeight,...(c.id==='rive'&&c.dataset.backend==='webgl2'?{glAttributes:c.getContext('webgl2')?.getContextAttributes()}:{})}))}));
 if(display.dpr!==dpr)throw new Error(`Unexpected display DPR ${display.dpr}`);
 const result={id,control,drawCounts,nativeTrace,packEvidence,mediaStart,mediaEnd,seconds:Number(seconds),elapsed,logicalCPUs:cpus().length,idleRandom:0.5,display,webglReadbacks:readbacks,canvasReadbacks,readbacksPerSecond:(readbacks+canvasReadbacks)/elapsed,rendererCPU:mean('pet'),gpuProcessCPU:mean('GPU'),allProcessCPU:100*(allCPU(last)-allCPU(first))/elapsed,note:'CPU seconds / measured wall seconds * 100 (one fully busy logical core = 100%). GPU process CPU is not GPU hardware utilization. readbacks counts window WebGL readPixels and Canvas2D getImageData calls, not Chromium-native presentation readbacks. allProcessCPU additionally includes browser, utility and control-window processes.',info,samples};
 await writeFile(resolve(out,'metrics.json'),JSON.stringify(result,null,2));
 if(profile){
  const gl=await sprite.evaluate(()=>globalThis.riveGLProfile);
  await writeFile(resolve(out,'webgl-profile.json'),JSON.stringify({...gl,note:'Instrumented run: draw counts include runtime rendering passes; triangle count is submitted triangles, not visible coverage. submitMs is JS API time; readbackMs measures the readPixels call; PBO probes do not block for completion. Frames are captured at rAF boundaries independent of alpha probes. Texture records include render targets and startup reallocations. Not a hardware GPU utilization measurement.'},null,2));

 }
 if(id==='mint-courier'||process.env.RIVE_BENCH_CAPTURE==='1'){
  const png=PNG.sync.read(await sprite.screenshot({omitBackground:true}));let sx=0,sy=0,n=0;
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++)if(png.data[(y*png.width+x)*4+3]>180){sx+=x;sy+=y;n++;}
  const size=await sprite.evaluate(()=>({w:innerWidth,h:innerHeight}));
  for(const [point,expected] of [[{x:sx/n/png.width*size.w,y:sy/n/png.height*size.h},false],[{x:0,y:0},true]]){
   await app.evaluate((_,p)=>{const b=globalThis.petHarness.metrics().sprite;globalThis.petHarness.cursor({x:b.x+p.x,y:b.y+p.y});},point);
   await sprite.evaluate(p=>window.dispatchEvent(new PointerEvent('pointermove',{clientX:p.x,clientY:p.y})),point);
   await sprite.waitForTimeout(250);
   const ignored=await app.evaluate(()=>globalThis.petHarness.ignored());if(ignored!==expected)throw new Error(`Alpha hit: ignored=${ignored} expected=${expected}`);
  }
  await app.evaluate(()=>{globalThis.petHarness.cursor({x:-10000,y:-10000});globalThis.petHarness.workArea(1440);globalThis.petHarness.settings({petEdgeHide:true});});
  const windowSize=await app.evaluate(()=>globalThis.petHarness.metrics().sprite);
  for(const [edge,x,y] of [['left',0,300],['right',1440-windowSize.width,300],['top',600,38],['bottom',600,838-windowSize.height]]){
   const b=await app.evaluate(()=>globalThis.petHarness.metrics().sprite);
   await sprite.evaluate(async({b,x,y})=>{for(const a of [{type:'dragStart',x:b.x,y:b.y},{type:'dragMove',x,y},{type:'dragEnd',x,y}])await window.rcDesktop.pet.action(a);},{b,x,y});
   await sprite.waitForTimeout(1500);
   const before=await sprite.screenshot({omitBackground:true});await sprite.waitForTimeout(500);const after=await sprite.screenshot({omitBackground:true});
   await writeFile(resolve(out,`dock-${edge}.png`),after);
   const tucked=await sprite.locator('#character').evaluate(e=>e.classList.contains('docked-rest'));
   if(!tucked||!before.equals(after))throw new Error(`Tucked Rive did not hold: ${edge}`);
   for(const theme of ['classic','plum-pocket','terminal'])for(const effective of ['light','dark']){
    await app.evaluate((_,{theme,effective})=>globalThis.petHarness.appearance({pack:theme,effective,accent:'#ad782e'}),{theme,effective});
    await sprite.waitForTimeout(120);await sprite.screenshot({path:resolve(out,`dock-${edge}-${theme}-${effective}.png`),omitBackground:true});
   }
  }
  await app.evaluate(()=>globalThis.petHarness.settings({petEdgeHide:false}));
 }
 // Appearance/width inspection runs after the idle measurement.
 if(id==='mint-courier'||process.env.RIVE_BENCH_CAPTURE==='1')for(const width of [1440,390])for(const theme of ['classic','plum-pocket','terminal'])for(const effective of ['light','dark']){
  await app.evaluate((_,{width,theme,effective})=>{globalThis.petHarness.workArea(width);globalThis.petHarness.appearance({pack:theme,effective,accent:'#ad782e'});},{width,theme,effective});
  await sprite.waitForTimeout(120);await sprite.screenshot({path:resolve(out,`${theme}-${effective}-${width}.png`),omitBackground:true});
 }
 console.log(JSON.stringify({id,rendererCPU:result.rendererCPU,gpuProcessCPU:result.gpuProcessCPU}));
}finally{await app.close();}
