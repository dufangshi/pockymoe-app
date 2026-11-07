import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { build } from 'vite';
const [,,riveZip,webmZip,output]=process.argv;
if(!riveZip||!webmZip||!output)throw new Error('Usage: node art/tools/rive/benchmark-suite.mjs RIVE.zip WEBM.zip OUT');
const desktop=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),out=resolve(output);process.chdir(desktop);await mkdir(out,{recursive:true});
const evidence=join(out,'harness-build'),harness=join(evidence,'pet/qa1/harness/main/index.js');
async function run(command,args,env={},log){return new Promise((yes,no)=>{const child=spawn(command,args,{cwd:desktop,env:{...process.env,TMPDIR:out,...env},stdio:log?['ignore','pipe','pipe']:'inherit'});let text='';if(log){child.stdout.on('data',b=>{text+=b;});child.stderr.on('data',b=>{text+=b;});}child.on('error',no);child.on('close',async code=>{if(log)await writeFile(log,text);if(code===0)yes();else no(new Error(`${command} exited ${code}; inspect ${log??'output'}`));});});}
await run(process.execPath,['node_modules/electron-vite/bin/electron-vite.js','build','--config','src/pet/tools/electron.config.ts'],{POCKYMOE_DESKTOP_EVIDENCE:evidence},join(out,'harness-build.log'));
await build({configFile:false,build:{ssr:resolve('src/pet/packs.ts'),outDir:join(out,'pack-loader'),emptyOutDir:true,minify:false,rollupOptions:{output:{format:'es',entryFileNames:'packs.mjs'}}}});
const {unpackPetZip,parseManifest,loadPetPack}=await import(pathToFileURL(join(out,'pack-loader/packs.mjs')).href);
const packs={};
for(const [kind,zip] of [['rive',riveZip],['webm',webmZip]]){
 const bytes=await readFile(resolve(zip)),entries=unpackPetZip(bytes),manifests=[...entries.keys()].filter(n=>n==='pet.json'||n.endsWith('/pet.json'));
 if(manifests.length!==1)throw new Error('ZIP must contain one pet.json');
 const root=manifests[0].slice(0,-'pet.json'.length),m=parseManifest(entries.get(manifests[0])),remote=m.remoteCodex;
 const allowed=new Set(['pet.json',m.spritesheetPath,remote?.rive?.path,remote?.peek?.path,remote?.sleeping?.path,remote?.talk?.path,...Object.values(remote?.clips??{}).flat().map(c=>c.path)].filter(Boolean));
 if([...entries.keys()].some(n=>!n.startsWith(root)||!allowed.has(n.slice(root.length))))throw new Error('ZIP contains undeclared files');
 if(Boolean(m.remoteCodex?.rive)!==(kind==='rive'))throw new Error(`Wrong ${kind} ZIP format`);
 const directory=join(out,'packs',kind);await mkdir(directory,{recursive:true});
 for(const [name,data] of entries){const target=join(directory,name.slice(root.length));await mkdir(dirname(target),{recursive:true});await writeFile(target,data);}
 await loadPetPack(directory);packs[kind]={directory,id:m.id,zipSha256:createHash('sha256').update(bytes).digest('hex')};
}
let prior;try{prior=JSON.parse(await readFile(join(out,'benchmark-inputs.json'),'utf8'));}catch{/* First run. */}
if(prior&&JSON.stringify(prior)!==JSON.stringify(packs))throw new Error('Output belongs to different ZIPs; choose a fresh output directory');
await writeFile(join(out,'benchmark-inputs.json'),JSON.stringify(packs,null,2));
const rows=[];
for(const dpr of [1,2])for(let repeat=1;repeat<=3;repeat++){
 const modes=['webm','quad','webgl2','canvas','auto'];if(repeat%2===0)modes.reverse();
 for(const mode of modes){
  const folder=join(out,`${mode}-dpr${dpr}-run${repeat}`),pack=packs[mode==='webm'?'webm':'rive'];
  let cached;try{cached=JSON.parse(await readFile(join(folder,'metrics.json'),'utf8'));}catch{/* A missing result starts a new measured run. */}
  if(cached&&cached.seconds===60&&cached.control===(mode==='webm'?'auto':mode)&&cached.nativeTrace){rows.push({mode,dpr,repeat,...cached});continue;}
  const args=['art/tools/rive/benchmark.mjs',pack.directory,folder,pack.id,'60'];
  console.log(`START ${mode} DPR ${dpr} run ${repeat}/3`);
  await run(process.platform==='linux'?'xvfb-run':process.execPath,process.platform==='linux'?['-a',process.execPath,...args]:args,{RIVE_BENCH_BACKEND:mode==='webm'?'auto':mode,RIVE_BENCH_DPR:String(dpr),RIVE_BENCH_HARNESS:harness},join(out,`${mode}-dpr${dpr}-run${repeat}.log`));
  rows.push({mode,dpr,repeat,...JSON.parse(await readFile(join(folder,'metrics.json'),'utf8'))});
 }
}
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)],table=[];
for(const dpr of [1,2]){
 const reference=median(rows.filter(r=>r.dpr===dpr&&r.mode==='webm').map(r=>r.rendererCPU+r.gpuProcessCPU));
 for(const mode of ['webm','quad','webgl2','canvas','auto']){
  const runs=rows.filter(r=>r.dpr===dpr&&r.mode===mode),sum=median(runs.map(r=>r.rendererCPU+r.gpuProcessCPU));
  table.push({dpr,mode,backend:runs[0].display.backend??'video',renderer:median(runs.map(r=>r.rendererCPU)),gpu:median(runs.map(r=>r.gpuProcessCPU)),rendererPlusGPU:sum,ratio:sum/reference,nativeReadsPerSecond:median(runs.map(r=>r.nativeTrace.readPixels/r.elapsed)),appReadsPerSecond:median(runs.map(r=>r.readbacksPerSecond))});
 }
}
await writeFile(join(out,'backend-medians.json'),JSON.stringify({unit:'CPU seconds / wall seconds × 100; one logical core = 100%',logicalCPUs:cpus().length,seconds:60,repeats:3,packs,table,runs:rows},null,2));console.table(table);
