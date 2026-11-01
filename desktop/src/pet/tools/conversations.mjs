// Focused conversation grouping, request targeting and local rendering regression.
import { _electron as electron, expect } from '@playwright/test';
import electronPath from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
const evidenceRoot=process.env.POCKYMOE_DESKTOP_EVIDENCE;
if(!evidenceRoot)throw new Error('Set POCKYMOE_DESKTOP_EVIDENCE to an external evidence directory.');
const out=`${evidenceRoot}/round3/pet/conversations`;await mkdir(out,{recursive:true});
const app=await electron.launch({executablePath:electronPath,args:[`${evidenceRoot}/pet/qa1/harness/main/index.js`],env:{...process.env,ELECTRON_RENDERER_URL:''}});
let sprite,glass;const errors=[],captures=[];
const h=(method,value)=>app.evaluate((_,{method,value})=>globalThis.petHarness[method](value),{method,value});
const action=value=>sprite.evaluate(value=>window.rcDesktop.pet.action(value),value);
const root={key:'mac:root',deviceId:'mac',deviceName:'Mac',workspaceId:'w',workspaceLabel:'Pockymoe',threadId:'root',title:'app',state:'running',since:new Date().toISOString(),unread:false};
const children=Array.from({length:5},(_,i)=>({...root,key:`mac:child-${i}`,threadId:`child-${i}`,rootThreadKey:root.key,rootThreadTitle:root.title,title:`Worker ${i}`,agentName:`relay-${i}`,state:i<2?'needsInput':i===2?'failed':i===3?'completed':'running',unread:true,turnId:`turn-${i}`,request:i<2?{id:`request-${i}`,kind:'approval',summary:`cargo test -p check-${i}`} :null}));
const twin={...root,key:'linux:root',deviceId:'linux',deviceName:'Linux'};
const sync=(items,accountId)=>h('sync',{version:1,accountId,generatedAt:new Date().toISOString(),focusedThreadKey:null,items});
const fire=item=>h('event',{type:item.state==='needsInput'?'needsInput':item.state,alertId:`${item.deviceId}:${item.request?.id??item.turnId}`,item,at:new Date().toISOString()});
async function ownCopy(){const copy=await glass.locator('body').innerText();expect(copy).not.toMatch(/智能体|\bAgent\b/);expect(await glass.locator('.agent-meta').count()).toBe(0);}
async function shot(name){await glass.waitForTimeout(120);await glass.screenshot({path:`${out}/${name}@2x.png`,omitBackground:true});captures.push(name);const clipped=await glass.evaluate(()=>[...document.querySelectorAll('.panel,.bubble,.panel-header,.chat')].filter(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+1||r.bottom>innerHeight+1||r.x<0||r.y<0;}).map(e=>e.className));expect(clipped,name).toEqual([]);}
try{
 await expect.poll(()=>app.windows().length).toBe(2);
 for(const page of app.windows()){page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>document.body.dataset.surface);if(await page.locator('body').getAttribute('data-surface')==='sprite')sprite=page;else glass=page;}
 await sprite.waitForFunction(()=>document.querySelector('#sprite')?.style.backgroundImage.includes('data:'));
 await h('captureOnly',true); // Rendering/routing matrix holds virtual focus; real-app harness separately exercises actual blur.
 for(const pack of ['classic','plum-pocket','terminal'])for(const effective of ['light','dark'])for(const width of [1440,900])for(const locale of ['en','zh-CN']){
   const id=`${pack}-${effective}-${width}-${locale}`;console.log(id);await h('workArea',width);await h('appearance',{pack,effective,locale,accent:pack==='terminal'?'#39c795':pack==='plum-pocket'?'#e8a93a':'#ad782e'});
   await sync([root,...children,twin],id);await action({type:'toggleTray'});await expect(glass.locator('.task-row')).toHaveCount(2);await expect(glass.locator('.conversation-row')).toHaveCount(2);
   const first=glass.locator('.conversation-row[data-conversation-key="mac:root"]');await expect(first.locator('.request-row')).toHaveCount(2);await expect(first.locator('.children-count')).toHaveText('5');await expect(first.locator('.children-count')).toHaveAttribute('title',children.map(item=>item.agentName).join(', '));
   await expect(first.locator('.row-main>.pockymoe-status-mark')).toHaveAttribute('data-status','waiting');expect(await glass.locator('.panel-header').evaluate(e=>e.getBoundingClientRect().height)).toBe(26);expect((await glass.locator('.panel-header').innerText()).trim()).toBe('');await ownCopy();await shot(`${id}-panel`);
   await glass.locator('.task-row[data-key="linux:root"]').click();await expect(first.locator('.request-row')).toHaveCount(1);await first.locator('.task-row .row-title').click();await expect(first.locator('.request-row')).toHaveCount(2);
   await expect(glass.locator('.chat')).toHaveAttribute('data-key','mac:root');await glass.locator('#reply-input').fill('root reply');await glass.locator('#reply-input').press('Enter');await expect.poll(async()=>(await h('commands')).filter(c=>c.type==='reply').at(-1)?.threadId).toBe('root');
   await first.locator('.request-row[data-key="mac:child-1"]').click();await expect(glass.locator('.chat')).toHaveAttribute('data-key','mac:child-1');await glass.locator('#reply-input').fill('specific reply');await glass.locator('#reply-input').press('Enter');await expect.poll(async()=>(await h('commands')).filter(c=>c.type==='reply').at(-1)?.threadId).toBe('child-1');
   await first.locator('.task-row .row-title').click();await expect(glass.locator('.chat')).toHaveAttribute('data-key','mac:root');
   const approve=locale==='en'?'Approve':'批准';await first.locator('.request-row[data-key="mac:child-0"]').getByRole('button',{name:approve,exact:true}).click();await expect(first.locator('.request-row')).toHaveCount(1);await expect(glass.locator('.task-row')).toHaveCount(2);
   const resolved=(await h('commands')).filter(c=>c.type==='resolveRequest').at(-1);expect(resolved).toMatchObject({threadId:'child-0',requestId:'request-0',decision:'approve'});await action({type:'close'});
   // An absent idle root still receives the default reply route.
   await sync([...children,twin],`${id}-without-root`);await action({type:'toggleTray'});await expect(glass.locator('.chat')).toHaveAttribute('data-key','mac:root');await glass.locator('#reply-input').fill('missing root reply');await glass.locator('#reply-input').press('Enter');await expect.poll(async()=>(await h('commands')).filter(c=>c.type==='reply').at(-1)?.threadId).toBe('root');await action({type:'close'});
   // Mixed child alerts coalesce under one conversation; pills never expose role/name chatter.
   await sync([root,...children,twin],`${id}-bubble`);await fire(children[3]);await fire(children[2]);await fire(children[0]);await fire(children[1]);await expect(glass.locator('.bubble')).toHaveCount(1);await expect(glass.locator('.bubble')).toHaveAttribute('data-conversation-key','mac:root');await expect(glass.locator('.bubble-title')).toHaveText('app');await expect(glass.locator('.bubble .request-more')).toHaveText('+1');await ownCopy();await expect(glass.locator('.bubble')).not.toContainText('relay-');await shot(`${id}-bubble`);
   await glass.locator('.bubble .request-more').click();await expect(glass.locator('.task-row')).toHaveCount(2);await expect(first.locator('.request-row')).toHaveCount(2);await action({type:'close'});
   await glass.locator('.bubble-title').click();await expect(glass.locator('.bubble')).toHaveCount(0);expect((await h('commands')).filter(c=>c.type==='navigate').at(-1)?.path).toBe('/devices/mac/threads/root');
   const acknowledged=await h('acknowledgements');for(const i of [0,1,2,3])expect(acknowledged).toContain(`mac:${children[i].request?.id??children[i].turnId}`);
 }
 expect(errors).toEqual([]);await writeFile(`${out}/mock-results.json`,JSON.stringify({result:'passed',captures,errors},null,2));console.log(`PASS ${captures.length} captures, unique conversation rows and exact request/reply routes.`);
}finally{await app.close();}
