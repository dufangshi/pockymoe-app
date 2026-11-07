import { _electron as electron } from '@playwright/test';
import { build } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RivePack } from '../../../src/pet/rive';
import type { preview } from './preview/preview';
declare global { interface Window { preview: typeof preview } }
interface Scenario { name: string; duration: number; initial: number; events?: { at: number; motion: number }[]; frameValues?: Record<string, number | boolean>[] }
const [,,pack,out,scenariosFile,fpsString='24']=process.argv;
if(!pack||!out||!scenariosFile) throw new Error('Usage: node art/tools/rive/record.ts PACK OUT SCENARIOS [24|30]');
const fps=Number(fpsString);if(![24,30].includes(fps))throw new Error('Recording fps must be 24 or 30');
const output=resolve(out);await mkdir(output,{recursive:true});
const manifest=JSON.parse(await readFile(resolve(pack,'pet.json'),'utf8')) as {remoteCodex:{rive:RivePack}};
const config=manifest.remoteCodex.rive;
const scenarios=JSON.parse(await readFile(scenariosFile,'utf8')) as Scenario[];
const rigFile=process.env.RIVE_RECORD_RIG;
const bones=rigFile?(JSON.parse(await readFile(rigFile,'utf8')) as {bones:{name:string}[]}).bones.map(b=>b.name):[];
await build({configFile:false,root:resolve('art/tools/rive/preview'),base:'./',build:{outDir:resolve(output,'app'),emptyOutDir:true,assetsInlineLimit:0}});
const main=resolve(output,'main.cjs');await writeFile(main,"const {app,BrowserWindow}=require('electron');const {join}=require('node:path');require('node:fs').mkdirSync(join(__dirname,'profile'),{recursive:true});app.setPath('userData',join(__dirname,'profile'));app.commandLine.appendSwitch('enable-unsafe-swiftshader');app.whenReady().then(()=>{const w=new BrowserWindow({width:648,height:702,transparent:true,frame:false,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false}});w.loadFile(process.argv.at(-1));});");
const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron'),args:['--no-sandbox','--ozone-platform=x11',main,resolve(output,'app/index.html')]});
try {
 const page=await app.firstWindow();page.on('pageerror',e=>console.error(e));await page.waitForFunction(()=>'preview' in window);
 const bytes=(await readFile(resolve(pack,config.path))).toString('base64');
 for(const s of scenarios){
  if(!/^[a-zA-Z0-9_-]+$/.test(s.name)||!Number.isFinite(s.duration)||s.duration<=0||s.duration>120)throw new Error('Invalid recording scenario');
  const directory=resolve(output,'frames',s.name);await mkdir(directory,{recursive:true});
  await page.evaluate(async({bytes,config,initial})=>{await window.preview.load(bytes,config,{motion:initial});window.preview.resize(648,702);},{bytes,config,initial:s.initial});
  const count=Math.round(s.duration*fps),samples=[];
  for(let i=0;i<count;i++){
   const event=s.events?.find(e=>Math.round(e.at*fps)===i),values={...s.frameValues?.[i],...(event?{motion:event.motion}:{})};
   const frame=await page.evaluate(({seconds,values,trigger,bones})=>window.preview.capture(seconds,values,trigger,bones),{seconds:i?1/fps:0,values,trigger:event?'motionStart':undefined,bones});
   await writeFile(resolve(directory,`${String(i).padStart(5,'0')}.png`),Buffer.from(frame.data.split(',')[1],'base64'));
   samples.push({time:i/fps,transforms:frame.transforms,values});
   if(i%120===119)console.log(`${s.name}: ${i+1}/${count}`);
  }
  await writeFile(resolve(output,`${s.name}.json`),JSON.stringify({name:s.name,fps,config,scenario:s,samples}));
  console.log(`PASS ${s.name}: ${count} frames at ${fps}fps`);
 }
 await page.evaluate(()=>window.preview.dispose());
}finally{await app.close();}
