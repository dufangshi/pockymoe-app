// Real Electron + real relay-page login, without mocked hub/appearance. Authentication stays inside this process.
import { _electron as electron, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const evidenceRoot = process.env.POCKYMOE_DESKTOP_EVIDENCE;
if (!evidenceRoot) throw new Error('Set POCKYMOE_DESKTOP_EVIDENCE to an external evidence directory.');
const out = `${evidenceRoot}/round3/pet/real`; mkdirSync(out, { recursive: true });
let fixture; try { fixture = JSON.parse(readFileSync(join(repo, '.local/e2e-desktop-env.json'), 'utf8')); } catch { throw new Error('Desktop fixture configuration unavailable'); }
const profile = mkdtempSync(join(tmpdir(), 'pockymoe-pet-v3-'));
const childEnv = {}; for (const key of ['PATH','HOME','TMPDIR','USER','LOGNAME']) if(process.env[key]) childEnv[key]=process.env[key];
Object.assign(childEnv,{POCKYMOE_DESKTOP_E2E:'1',POCKYMOE_DESKTOP_USER_DATA:profile,POCKYMOE_DESKTOP_THEME:'light',POCKYMOE_DESKTOP_WEB_ORIGIN:fixture.webOrigin,POCKYMOE_DESKTOP_RELAY_ORIGIN:fixture.relayOrigin});
const control=(...args)=>{ try {execFileSync(join(repo,'scripts/e2e-desktop-backend.sh'),args.map(String),{stdio:'pipe'});}catch{throw new Error('Fixture event failed');} };
const interactionsOnly=process.argv.includes('--interactions-only');
let app,web,sprite,glass,phase='launch',signedIn=false;
const results={result:'running',moods:[],events:[],screenshots:[]};
const action=value=>sprite.evaluate(value=>window.rcDesktop.pet.action(value),value);
async function nativeShot(name) {
  // Capture only the rectangle over our foreground fixture window, never unrelated desktop content.
  await glass.waitForTimeout(250);
  const box=await app.evaluate(({BrowserWindow})=>{const view=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/pet/')&&!!w.getParentWindow());const pet=view.getParentWindow();const a=view.getBounds(),b=pet.getBounds();return {x:Math.min(a.x,b.x)-12,y:Math.min(a.y,b.y)-12,width:Math.max(a.x+a.width,b.x+b.width)-Math.min(a.x,b.x)+24,height:Math.max(a.y+a.height,b.y+b.height)-Math.min(a.y,b.y)+24};});
  const file=join(out,`${name}-desktop@2x.png`);execFileSync('/usr/sbin/screencapture',['-x',`-R${box.x},${box.y},${box.width},${box.height}`,file],{stdio:'pipe'});results.screenshots.push(file);
}
try {
  app=await electron.launch({args:[join(repo,'desktop')],env:childEnv});
  await expect.poll(()=>app.windows().some(page=>page.url().startsWith(fixture.webOrigin))).toBe(true);web=app.windows().find(page=>page.url().startsWith(fixture.webOrigin));
  // Record every published pose and sprite bounds call before authentication.
  await app.evaluate(({BrowserWindow})=>{
    globalThis.petV3Log={boundsCalls:0,moods:[],events:[],acks:[]};
    const pet=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/pet/')&&!w.getParentWindow());
    const set=pet.setBounds.bind(pet),send=pet.webContents.send.bind(pet.webContents);
    pet.setBounds=(...args)=>{globalThis.petV3Log.boundsCalls++;return set(...args);};
    pet.webContents.send=(channel,value,...rest)=>{if(channel==='rcDesktop:pet:state'&&globalThis.petV3Log.moods.at(-1)?.mood!==value.mood)globalThis.petV3Log.moods.push({at:Date.now(),mood:value.mood});return send(channel,value,...rest);};
    const hub=globalThis.__pockymoeDesktopTest.hub;
    hub.onEvent(event=>globalThis.petV3Log.events.push({at:Date.now(),type:event.type,key:event.item.key,alertId:event.alertId}));
    hub.onAcknowledge((id,source)=>globalThis.petV3Log.acks.push({at:Date.now(),id,source}));
  });
  phase='sign-in';
  try {
    await web.goto(`${fixture.webOrigin}/relay-portal?returnTo=%2F`);await web.getByLabel('Email or username',{exact:true}).fill(fixture.username);await web.getByLabel('Password',{exact:true}).fill(fixture.password);await web.getByRole('button',{name:'Sign in',exact:true}).click();await web.locator('.thread-map[data-presentation="page"]').waitFor({timeout:30000});
  }catch{throw new Error('Fixture sign-in did not complete');}
  signedIn=true;phase='login-minute';
  for(const page of app.windows().filter(page=>page.url().includes('/pet/'))){await page.waitForFunction(()=>document.body.dataset.surface);if(await page.locator('body').getAttribute('data-surface')==='sprite')sprite=page;else glass=page;}
  const start=Date.now();
  const skipMinute=interactionsOnly;
  await expect.poll(()=>app.evaluate(()=>globalThis.__pockymoeDesktopTest.hub.snapshot()?.syncedDeviceIds?.length ?? 0),{timeout:30000}).toBe(3);
  // No event injection, settings changes, or approval actions during the measured login minute.
  for(let i=0;i<(skipMinute?0:6);i++){await web.waitForTimeout(Math.max(0,start+(i+1)*10000-Date.now()));console.log(`Stable login observation ${(i+1)*10}s`);}
  const stable=await app.evaluate(({app})=>({...globalThis.petV3Log,dockVisible:app.dock.isVisible(),snapshot:{items:globalThis.__pockymoeDesktopTest.hub.snapshot()?.items.length,syncedDevices:globalThis.__pockymoeDesktopTest.hub.snapshot()?.syncedDeviceIds.length}}));
  expect(stable.moods.some(value=>value.mood==='failed')).toBe(false);expect(stable.moods.length).toBeLessThanOrEqual(2);expect(stable.events).toEqual([]);expect(stable.dockVisible).toBe(true);results.loginMinute={...stable,durationMs:Date.now()-start,skipped:skipMinute};
  if(!skipMinute)writeFileSync(join(out,'login-minute.json'),JSON.stringify(results.loginMinute,null,2));
  console.log(skipMinute ? 'Login minute skipped for interaction-only rerun.' : `PASS login minute: ${stable.moods.length} pose changes, no failed pose, zero historical events, Dock visible.`);
  phase='fixed-controls';
  await app.evaluate(()=>{globalThis.petV3Log.boundsCalls=0;globalThis.__pockymoeDesktopTest.settings.set({petVisible:true,petMini:false,snoozeUntil:null});});
  phase='fixed-controls-open';await action({type:'toggleTray'});await expect(glass.locator('.panel')).toBeVisible();
  phase='fixed-controls-native-blur';
  // Real blur: focus the main fixture window rather than synthesizing a blur event.
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(globalThis.__pockymoeDesktopTest.settings.get().webOrigin)).focus());await expect(glass.locator('.panel')).toHaveCount(0);
  for(let repeat=0;repeat<3;repeat++){phase='fixed-controls-menu';await action({type:'menu',value:true});await expect(glass.getByRole('menu')).toBeVisible();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(globalThis.__pockymoeDesktopTest.settings.get().webOrigin)).focus());await expect(glass.getByRole('menu')).toHaveCount(0);}
  phase='fixed-controls-escape';await action({type:'toggleTray'});await glass.keyboard.press('Escape');await expect(glass.locator('.panel')).toHaveCount(0);
  await action({type:'openMap'});await action({type:'openMain'});await action({type:'setMini',value:true});await action({type:'setMini',value:false});
  results.controls=await app.evaluate(({app})=>({spriteSetBoundsCalls:globalThis.petV3Log.boundsCalls,dockVisible:app.dock.isVisible()}));expect(results.controls.spriteSetBoundsCalls).toBe(0);expect(results.controls.dockVisible).toBe(true);
  phase='real-background';
  const geometry=await app.evaluate(({BrowserWindow,screen})=>{const area=screen.getPrimaryDisplay().workArea,main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(globalThis.__pockymoeDesktopTest.settings.get().webOrigin));main.setBounds({x:area.x+20,y:area.y+20,width:Math.min(1440,area.width-40),height:Math.min(900,area.height-40)});main.show();main.focus();const body=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/pet/')&&!w.getParentWindow());return {main:main.getBounds(),pet:body.getBounds()};});
  const x=geometry.main.x+geometry.main.width-230,y=geometry.main.y+geometry.main.height-190;
  await action({type:'dragStart',x:geometry.pet.x,y:geometry.pet.y});await action({type:'dragMove',x,y});await action({type:'dragEnd',x,y});
  await action({type:'toggleTray'});await expect(glass.locator('.panel')).toBeVisible();await web.waitForTimeout(350);await nativeShot('en-panel-over-real-map');
  await action({type:'close'});
  phase='live-approval';
  const d=fixture.devices[0];control('start-turn',d.index,d.scenarios.events);await web.waitForTimeout(1400);control('request-approval',d.index,d.scenarios.events);
  await expect(glass.locator('.bubble.sticky')).toBeVisible({timeout:20000});await web.waitForTimeout(1800);await nativeShot('en-waiting-over-real-map');
  await glass.getByRole('button',{name:'Approve',exact:true}).click();await expect(glass.locator('.bubble.sticky')).toHaveCount(0,{timeout:15000});await expect.poll(()=>app.evaluate(()=>globalThis.petV3Log.acks.some(ack=>ack.source==='pet')),{timeout:15000}).toBe(true);
  phase='live-complete';control('complete',d.index,d.scenarios.events);await expect.poll(()=>app.evaluate(()=>globalThis.petV3Log.events.some(e=>e.type==='completed')),{timeout:15000}).toBe(true);
  phase='locale-settings';
  await action({type:'dismiss'});await web.locator('.matter-rail-bottom button:has(svg[data-icon="settings"])').click();const settings=web.getByTestId('settingsDialog');await expect(settings).toBeVisible();
  let language=settings.getByRole('combobox',{name:/^(Language|语言)$/});if(!await language.count()){await settings.getByRole('button',{name:/^(Preferences|偏好设置)$/}).click();language=settings.getByRole('combobox',{name:/^(Language|语言)$/});}
  // The page language control may be a native or the new shared custom Select during parallel work.
  if(await language.evaluate(e=>e.tagName)==='SELECT')await language.selectOption('zh-CN');else{await language.click();await web.getByRole('option',{name:/简体中文|Chinese/}).click();}
  await expect(glass.locator('html')).toHaveAttribute('lang','zh-CN',{timeout:1000});
  await action({type:'toggleTray'});await expect(glass.locator('.panel')).toHaveAttribute('aria-label','活动面板');await nativeShot('zh-panel-over-real-settings');await action({type:'close'});
  results.eventLog=await app.evaluate(()=>({events:globalThis.petV3Log.events,acknowledgements:globalThis.petV3Log.acks,notifications:globalThis.__pockymoeDesktopTest.notifications.constructed}));
  expect(results.eventLog.events.some(event=>event.type==='needsInput')).toBe(true);expect(results.eventLog.acknowledgements.some(ack=>ack.source==='pet')).toBe(true);
  results.result='passed';writeFileSync(join(out,skipMinute?'interaction-results.json':'results.json'),JSON.stringify(results,null,2));console.log('PASS real approval + completion + reciprocal acknowledgement; en/zh native glass captures.');
}catch(error){
  if(signedIn)console.error(error.message);
  results.result='failed';results.phase=phase;writeFileSync(join(out,interactionsOnly?'interaction-results.json':'results.json'),JSON.stringify(results,null,2));
  if(signedIn&&web)await web.screenshot({path:join(out,'failure-after-sign-in.png')}).catch(()=>{});console.error(`Real pet QA failed at ${phase}; authentication data is not logged.`);process.exitCode=1;
}finally{if(app)await app.close().catch(()=>{});rmSync(profile,{recursive:true,force:true});}
