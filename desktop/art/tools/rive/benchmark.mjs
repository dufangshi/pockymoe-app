import { PNG } from 'pngjs';
import { _electron as electron } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cpus } from 'node:os';
const [,,pack,out,id='mint-courier',seconds='60']=process.argv;
if(!pack||!out)throw new Error('Usage: node art/tools/rive/benchmark.mjs PACK OUT ID [seconds=60]');
await mkdir(out,{recursive:true});
const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron'),args:['--no-sandbox','--ozone-platform=x11','--enable-unsafe-swiftshader',resolve('.local/desktop-evidence/pet/qa1/harness/main/index.js')],env:{...process.env,ELECTRON_RENDERER_URL:'',POCKYMOE_CLIP_PACK:resolve(pack)}});
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
 await sprite.waitForFunction(()=>document.querySelector('#character.rive')||document.querySelector('#character.clips'));
 await sprite.waitForTimeout(3000);
 await sprite.screenshot({path:resolve(out,'pet-window.png'),omitBackground:true});
 const read=()=>app.evaluate(({app,BrowserWindow})=>({time:performance.now(),metrics:app.getAppMetrics().map(m=>({pid:m.pid,type:m.type,cpu:m.cpu.percentCPUUsage,cumulativeCPU:m.cpu.cumulativeCPUUsage,memory:m.memory})),petPid:BrowserWindow.getAllWindows().find(w=>!w.getParentWindow()).webContents.getOSProcessId()}));
 const samples=[await read()];
 for(let i=0;i<Number(seconds);i++){
  await sprite.waitForTimeout(1000);
  samples.push(await read());
  if(i%20===19)console.log(`${id}: ${i+1}/${seconds}s`);
 }
 const first=samples[0],last=samples.at(-1),elapsed=(last.time-first.time)/1000;
 const total=(sample,type)=>sample.metrics.filter(m=>type==='pet'?m.pid===sample.petPid:m.type===type).reduce((s,m)=>s+m.cumulativeCPU,0);
 const mean=type=>100*(total(last,type)-total(first,type))/elapsed;
 if(first.petPid!==last.petPid)throw new Error('Pet renderer restarted during measurement');
 const info=await app.evaluate(async({app})=>({features:app.getGPUFeatureStatus(),gpu:await app.getGPUInfo('basic')}));
 const result={id,seconds:Number(seconds),elapsed,logicalCPUs:cpus().length,rendererCPU:mean('pet'),gpuProcessCPU:mean('GPU'),note:'CPU seconds / measured wall seconds * 100 (one fully busy logical core = 100%). GPU process CPU is not GPU hardware utilization.',info,samples};
 await writeFile(resolve(out,'metrics.json'),JSON.stringify(result,null,2));
 if(id==='mint-courier'){
  const png=PNG.sync.read(await sprite.screenshot({omitBackground:true}));let sx=0,sy=0,n=0;
  for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++)if(png.data[(y*png.width+x)*4+3]>180){sx+=x;sy+=y;n++;}
  const size=await sprite.evaluate(()=>({w:innerWidth,h:innerHeight}));
  for(const [point,expected] of [[{x:sx/n/png.width*size.w,y:sy/n/png.height*size.h},false],[{x:0,y:0},true]]){
   await sprite.evaluate(p=>window.dispatchEvent(new PointerEvent('pointermove',{clientX:p.x,clientY:p.y})),point);
   const ignored=await app.evaluate(()=>globalThis.petHarness.ignored());if(ignored!==expected)throw new Error(`Alpha hit: ignored=${ignored} expected=${expected}`);
  }
  await app.evaluate(()=>{globalThis.petHarness.workArea(1440);globalThis.petHarness.settings({petEdgeHide:true});});
  for(const [edge,x,y] of [['left',0,300],['right',1312,300],['top',600,38],['bottom',600,710]]){
   const b=await app.evaluate(()=>globalThis.petHarness.metrics().sprite);
   await sprite.evaluate(async({b,x,y})=>{for(const a of [{type:'dragStart',x:b.x,y:b.y},{type:'dragMove',x,y},{type:'dragEnd',x,y}])await window.rcDesktop.pet.action(a);},{b,x,y});
   await sprite.waitForTimeout(1500);
   const before=await sprite.screenshot({omitBackground:true});await sprite.waitForTimeout(500);const after=await sprite.screenshot({omitBackground:true});
   await writeFile(resolve(out,`dock-${edge}.png`),after);
   const tucked=await sprite.locator('#character').evaluate(e=>e.classList.contains('docked-rest'));
   if(!tucked||!before.equals(after))throw new Error(`Tucked Rive did not hold: ${edge}`);
  }
  await app.evaluate(()=>globalThis.petHarness.settings({petEdgeHide:false}));
 }
 // Appearance/width inspection runs after the idle measurement.
 if(id==='mint-courier')for(const width of [1440,390])for(const theme of ['classic','plum-pocket','terminal'])for(const effective of ['light','dark']){
  await app.evaluate((_,{width,theme,effective})=>{globalThis.petHarness.workArea(width);globalThis.petHarness.appearance({pack:theme,effective,accent:'#ad782e'});},{width,theme,effective});
  await sprite.waitForTimeout(120);await sprite.screenshot({path:resolve(out,`${theme}-${effective}-${width}.png`),omitBackground:true});
 }
 console.log(JSON.stringify({id,rendererCPU:result.rendererCPU,gpuProcessCPU:result.gpuProcessCPU}));
}finally{await app.close();}
