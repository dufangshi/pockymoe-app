// Contact sheets from the existing local Electron harness; no service is started.
import { _electron as electron } from '@playwright/test';
import electronPath from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
const evidenceRoot=process.env.POCKYMOE_DESKTOP_EVIDENCE;
if(!evidenceRoot)throw new Error('Set POCKYMOE_DESKTOP_EVIDENCE to an external evidence directory.');
const root=`${evidenceRoot}/round3/pet`;
const browser=await electron.launch({executablePath:electronPath,args:[`${evidenceRoot}/pet/qa1/harness/main/index.js`],env:{...process.env,ELECTRON_RENDERER_URL:''}});
try{
 const page=await browser.firstWindow();
 for(const mode of ['light','dark']){
  const entries=[];
  for(const pack of ['classic','plum-pocket','terminal'])for(const scene of ['panel','waiting','error','more','mini']){const name=`${pack}-${mode}-900-${scene}`;entries.push({name,image:`data:image/png;base64,${(await readFile(`${root}/${name}@2x.png`)).toString('base64')}`});}
  const data=await page.evaluate(async({entries,mode})=>{const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=1050;const ctx=canvas.getContext('2d');ctx.fillStyle=mode==='dark'?'#20232a':'#e4e7eb';ctx.fillRect(0,0,1600,1050);for(const [i,entry] of entries.entries()){const im=new Image();im.src=entry.image;await im.decode();const x=i%5*320+12,y=Math.floor(i/5)*350+30,scale=Math.min(296/im.width,306/im.height);ctx.font='12px system-ui';ctx.fillStyle=mode==='dark'?'#c2c7d2':'#4c5360';ctx.fillText(entry.name,x,y-10,296);ctx.drawImage(im,x,y,im.width*scale,im.height*scale);}return canvas.toDataURL('image/png');},{entries,mode});
  await writeFile(`${root}/contact-${mode}.png`,Buffer.from(data.split(',')[1],'base64'));
 }
}finally{await browser.close();}
