import { _electron as electron } from '@playwright/test';
import { resolve } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { buildRig } from './writer.ts';
const out=resolve(process.argv[2]??'.scratch/rive/verification');await mkdir(out,{recursive:true});
const packIndex=process.argv.indexOf('--pack');
const config=JSON.parse(await readFile(resolve(packIndex>=0?process.argv[packIndex+1]:'.scratch/rive/pack','pet.json'),'utf8')).remoteCodex.rive;
const bytes=(await readFile(resolve(packIndex>=0?process.argv[packIndex+1]:'.scratch/rive/pack','pet.riv'))).toString('base64');
const rig=JSON.parse(await readFile('art/rive-sample/rig.json','utf8'));
rig.stateMachine.inputs.find(i=>i.name==='mouth').name='badMouth';
rig.stateMachine.layers.find(l=>l.name==='mouth').states.find(s=>s.blend).blend.input='badMouth';
const bad=[...buildRig(rig,resolve('art/rive-sample'))];
const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron'),args:['--no-sandbox','--ozone-platform=x11','--enable-unsafe-swiftshader',resolve('.local/desktop-evidence/pet/qa1/harness/main/index.js')],env:{...process.env,ELECTRON_RENDERER_URL:''}});
try{
 await app.firstWindow();await app.evaluate(async()=>{while(!globalThis.petHarness)await new Promise(r=>setTimeout(r,20));});
 const results=[];
 for(const test of [{name:'valid',bytes,config},{name:'missing-artboard',bytes,config:{...config,artboard:'Missing'},error:'Missing artboard'}, {name:'missing-machine',bytes,config:{...config,stateMachine:'Missing'},error:'Missing state machine'}, {name:'missing-contract',bytes:bad,config,error:'mouth'},{name:'bad-file',bytes:[1,2,3,4,5,6,7,8],config,error:'rejected'}]){
  let error=null;
  try{await app.evaluate((_,t)=>globalThis.petHarness.verifyRive(t.bytes,t.config),test);}catch(e){error=String(e);}
  if(test.error?!error?.includes(test.error):error)throw new Error(`${test.name}: ${error}`);
  results.push({test:test.name,result:'passed',error});
 }
 const zipIndex=process.argv.indexOf('--zip');
 if(zipIndex>=0){const installed=await app.evaluate((_,source)=>globalThis.petHarness.importRive(source),resolve(process.argv[zipIndex+1]));if(installed.id===undefined)throw new Error('ZIP installation failed');results.push({test:'atomic-zip-install',result:'passed',error:null});}
 await writeFile(resolve(out,'results.json'),JSON.stringify(results,null,2));console.log(`PASS ${results.length} isolated runtime import checks`);
}finally{await app.close();}
