// Focused Electron regressions for v3: fixed character, real child focus, sparse history, docking and glass UI.
import { _electron as electron, expect } from '@playwright/test';
import electronPath from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
const out = process.env.POCKYMOE_DESKTOP_EVIDENCE;
if (!out) throw new Error('Set POCKYMOE_DESKTOP_EVIDENCE to an external evidence directory.');
const evidence = `${out}/round3/pet`; await mkdir(evidence, { recursive: true });
const harness = `${out}/pet/qa1/harness/main/index.js`;
const app = await electron.launch({ executablePath: electronPath, args: [harness], env: { ...process.env, ELECTRON_RENDERER_URL: '' } });
const captures = [], errors = [];
const smoke = process.argv.includes('--smoke'), menusOnly = process.argv.includes('--menus-only');
let sprite, glass, accountId = 'round3';
const h = (method, value) => app.evaluate((_, { method, value }) => globalThis.petHarness[method](value), { method, value });
const action = value => sprite.evaluate(value => window.rcDesktop.pet.action(value), value);
const sync = items => h('sync', { version: 1, generatedAt: new Date().toISOString(), accountId, focusedThreadKey: null, syncedDeviceIds: Array.from({length:11},(_,i)=>`device-${i}`), items, recent: [] });
const item = (i, state='failed') => ({key:`device-${i%11}:t${i}`,deviceId:`device-${i%11}`,threadId:`t${i}`,deviceName:`Mac ${i%11}`,workspaceId:`w${i%21}`,workspaceLabel:`Project ${i%21}`,title:`Refine queue recovery ${i}`,state,since:new Date().toISOString(),unread:true,turnId:`turn-${i}`,request:state==='needsInput'?{id:`request-${i}`,kind:'approval',summary:'cargo test -p pockymoe-runtime'}:undefined});
async function shot(name) {
  await glass.waitForTimeout(250);
  const png = PNG.sync.read(await glass.screenshot({path:`${evidence}/${name}@2x.png`,omitBackground:true}));
  captures.push({name,width:png.width,height:png.height});
  const overflow=await glass.evaluate(()=>[...document.querySelectorAll('.controls,.panel,.bubble,.more')].filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.top<0||r.right>innerWidth+1||r.bottom>innerHeight+1;}).map(e=>e.className));expect(overflow,name).toEqual([]);
}
async function move(x,y) {
  const bounds=(await h('metrics')).sprite;
  await action({type:'dragStart',x:bounds.x,y:bounds.y});await action({type:'dragMove',x,y});await action({type:'dragEnd',x,y});await sprite.waitForTimeout(1100);
}
try {
  await expect.poll(()=>app.windows().length).toBe(2);
  for (const page of app.windows()) { page.on('pageerror',e=>errors.push(e.message)); await page.waitForFunction(()=>document.body.dataset.surface); if(await page.locator('body').getAttribute('data-surface')==='sprite')sprite=page;else glass=page; }
  await sprite.waitForFunction(()=>document.querySelector('#sprite')?.style.backgroundImage.includes('data:'));
  await h('workArea',1440); await move(1050,580);
  await sync(Array.from({length:250},(_,i)=>({...item(i,i%2?'failed':'completed'),since:'2026-01-01T00:00:00Z'})));
  await sprite.waitForTimeout(2300);await expect(sprite.locator('#app')).toHaveAttribute('data-mood','idle');
  expect((await h('metrics')).dockVisible).toBe(true);
  await h('resetMetrics');
  await action({type:'toggleTray'});await expect(glass.locator('.panel')).toBeVisible();await expect(glass.locator('.task-row')).toHaveCount(250);expect(await glass.locator('select').count()).toBe(0);
  await h('blur');await expect(glass.locator('.panel')).toHaveCount(0);
  await action({type:'menu',value:true});await expect(glass.getByRole('menu')).toBeVisible();await h('blur');await expect(glass.getByRole('menu')).toHaveCount(0);
  await action({type:'toggleTray'});await glass.keyboard.press('Escape');await expect(glass.locator('.panel')).toHaveCount(0);
  await action({type:'openMain'});await action({type:'openMap'});await action({type:'setMini',value:true});await action({type:'setMini',value:false});
  expect((await h('metrics')).spriteBoundsCalls).toBe(0);expect((await h('metrics')).dockVisible).toBe(true);
  const controlsMetrics=await h('metrics');
  const resolved = item(42, 'needsInput'), resumed = { ...resolved, state: 'running', request: null };
  await sync([resumed]); await h('event', { type: 'resolved', alertId: `${resolved.deviceId}:${resolved.request.id}`, item: resolved, at: new Date().toISOString() });
  await action({ type: 'toggleTray' }); await expect(glass.locator(`.task-row[data-key="${resumed.key}"]`)).toHaveCount(1); await action({ type: 'close' });

  for(const pack of smoke?['classic']:['classic','plum-pocket','terminal'])for(const effective of ['light','dark'])for(const width of smoke?[900]:[1440,900]){
    const id=`${pack}-${effective}-${width}`;console.log(`v3 ${id}`);accountId=id;await h('workArea',width);await move(width-280,560);
    await h('appearance',{pack,effective,locale:'en',accent:pack==='terminal'?'#3acb95':pack==='plum-pocket'?'#df9a36':'#ad782e'});await glass.emulateMedia({reducedMotion:'reduce'});
    if(menusOnly){await action({type:'menu',value:true});await shot(`${id}-more`);await action({type:'close'});continue;}
    const rows=Array.from({length:8},(_,i)=>item(i,i===0?'needsInput':i===1?'failed':i===2?'completed':'running'));
    await sync(rows); await action({type:'toggleTray'});await expect(glass.locator('.panel')).toBeVisible();await expect(glass.locator('[data-scroll-area]')).toHaveAttribute('data-overflow-bottom','true');await shot(`${id}-panel`);
    // Selection directly determines reply target. A false result stays inline with the draft.
    await glass.locator('.task-row').first().click();await glass.locator('#reply-input').fill('Keep this draft');await h('failCommand','reply');await glass.locator('#reply-input').press('Enter');await expect(glass.locator('.error-mark')).toBeVisible();await expect(glass.locator('#reply-input')).toHaveValue('Keep this draft');await h('failCommand',null);await action({type:'close'});
    const waiting={...item(300,'needsInput'),key:`device-0:waiting-${id}`,threadId:`waiting-${id}`,request:{id:`approve-${id}`,kind:'approval',summary:'Run the focused regression checks?'}};
    await sync([waiting,...rows]);await h('event',{type:'needsInput',alertId:`device-0:${waiting.request.id}`,item:waiting,at:new Date().toISOString()});await expect(glass.locator('.bubble')).toBeVisible();await expect(glass.locator('.request-summary code')).toHaveCount(0);await shot(`${id}-waiting`);
    await h('failCommand','resolveRequest');await glass.getByRole('button',{name:'Approve',exact:true}).click();await expect(glass.locator('.error-mark')).toBeVisible();await glass.locator('.error-mark').click();await expect(glass.getByRole('button',{name:'Open in thread'})).toBeVisible();await shot(`${id}-error`);await h('blur');await expect(glass.locator('.error-popover')).toHaveCount(0);await expect(glass.locator('.bubble.sticky')).toBeVisible();await action({type:'dismiss'});await h('failCommand',null);
    await action({type:'menu',value:true});await shot(`${id}-more`);await action({type:'close'});
    await h('settings',{petMini:true});await shot(`${id}-mini`);await h('settings',{petMini:false});
    await h('settings',{petId:'gpt-dragon'});await sprite.waitForTimeout(200);await sprite.screenshot({path:`${evidence}/${id}-dragon@2x.png`,omitBackground:true});await h('settings',{petId:'moe'});
  }
  const docking=[];
  if(!menusOnly){
  await sync([]);await action({type:'close'});await h('workArea',900);await h('cursor',{x:-10000,y:-10000});
  for(const size of ['S','M','L'])for(const edge of ['left','right','top','bottom']){
    await h('settings',{petSize:size});const height={S:96,M:128,L:160}[size],width=Math.round(height*192/208);
    const x=edge==='left'?0:edge==='right'?900-width:420,y=edge==='top'?38:edge==='bottom'?838-height:400;
    await move(x,y);await expect(sprite.locator('#app')).toHaveAttribute('data-edge',edge);await expect(sprite.locator('#app')).toHaveAttribute('data-dock-amount','1');
    const bounds=(await h('metrics')).sprite;expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y).toBeGreaterThanOrEqual(38);expect(bounds.x+bounds.width).toBeLessThanOrEqual(900);expect(bounds.y+bounds.height).toBeLessThanOrEqual(838);
    await sprite.screenshot({path:`${evidence}/dock-${edge}-${size}@2x.png`,omitBackground:true});
    await h('cursor',{x:bounds.x+width/2,y:bounds.y+height/2});await sprite.waitForTimeout(450);await expect(sprite.locator('#app')).toHaveAttribute('data-dock-amount','0');
    await h('cursor',{x:-10000,y:-10000});await sprite.waitForTimeout(1100);await expect(sprite.locator('#app')).toHaveAttribute('data-dock-amount','1');docking.push({size,edge,bounds});
  }
  // Negative-coordinate second display; unplugging restores to primary work area.
  await h('displays',[{id:1,workArea:{x:0,y:38,width:900,height:800}},{id:2,workArea:{x:-1440,y:40,width:1440,height:860}}]);
  await move(-1440,400);expect((await h('metrics')).requestedBounds.x).toBe(-1440);
  await h('displays',[{id:1,workArea:{x:0,y:38,width:900,height:800}}]);expect((await h('metrics')).sprite.x).toBeGreaterThanOrEqual(0);
  }
  expect(errors).toEqual([]);await writeFile(`${evidence}/${menusOnly?'menu-results':'renderer-results'}.json`,JSON.stringify({result:'passed',controlsMetrics,captures,docking,errors},null,2));console.log(`PASS ${captures.length} captures; fixed sprite; Dock; blur/Esc; ${docking.length} docking cases + virtual secondary-display geometry.`);
}finally{await app.close();}
