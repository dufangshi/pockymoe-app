// Native captures of the real page/hub and disposable fixture conversations.
import { _electron as electron, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo=fileURLToPath(new URL('../../../../',import.meta.url)),evidence=process.env.POCKYMOE_DESKTOP_EVIDENCE;
if(!evidence)throw new Error('Set POCKYMOE_DESKTOP_EVIDENCE to an external evidence directory.');
const out=`${evidence}/round3/pet/conversations/real`;mkdirSync(out,{recursive:true});
let fixture,group;
try{fixture=JSON.parse(readFileSync(join(repo,'.local/e2e-desktop-env.json'),'utf8'));group=JSON.parse(readFileSync(`${evidence}/round3/pet/conversations/fixture.json`,'utf8'));}catch{throw new Error('Fixture configuration unavailable');}
const profile=mkdtempSync(join(tmpdir(),'pockymoe-pet-conversations-')),env={};for(const key of ['PATH','HOME','TMPDIR','USER','LOGNAME'])if(process.env[key])env[key]=process.env[key];
Object.assign(env,{POCKYMOE_DESKTOP_E2E:'1',POCKYMOE_DESKTOP_USER_DATA:profile,POCKYMOE_DESKTOP_WEB_ORIGIN:fixture.webOrigin,POCKYMOE_DESKTOP_RELAY_ORIGIN:fixture.relayOrigin});
const event=(thread,type)=>{try{execFileSync('python3',['-c',"import sys;sys.path.insert(0,'scripts/desktop-fixture');from backend import read_state,device_api;s=read_state();d=next(d for d in s['devices'] if d['id']==sys.argv[1]);device_api(s,d,'/e2e/events','POST',{'threadId':sys.argv[2],'type':sys.argv[3]})",group.deviceId,thread,type],{cwd:repo,stdio:'pipe'});}catch{throw new Error('Disposable fixture event failed');}};
const rootKey=`${group.deviceId}:${group.rootThreadId}`,twinKey=`${group.otherDeviceId}:${group.twinThreadId}`;
let app,web,sprite,glass,phase='launch',signedIn=false;const captures=[];
const action=value=>sprite.evaluate(value=>window.rcDesktop.pet.action(value),value);
async function capture(name){await glass.waitForTimeout(250);const box=await app.evaluate(({BrowserWindow})=>{const glass=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/pet/')&&w.getParentWindow()),a=glass.getBounds(),b=glass.getParentWindow().getBounds();return {x:Math.min(a.x,b.x)-10,y:Math.min(a.y,b.y)-10,width:Math.max(a.x+a.width,b.x+b.width)-Math.min(a.x,b.x)+20,height:Math.max(a.y+a.height,b.y+b.height)-Math.min(a.y,b.y)+20};});const file=`${out}/${name}@2x.png`;execFileSync('/usr/sbin/screencapture',['-x',`-R${box.x},${box.y},${box.width},${box.height}`,file],{stdio:'pipe'});captures.push(name);}
async function preferences(pack,mode,locale){
 await action({type:'close'});await app.evaluate(()=>globalThis.__pockymoeDesktopTest.windows.focusMain());
 await web.locator('.matter-rail-bottom button:has(svg[data-icon="settings"])').click();const settings=web.getByTestId('settingsDialog');await expect(settings).toBeVisible();
 if(!await settings.locator('.theme-preset-option').count())await settings.getByRole('button',{name:/^(Preferences|偏好设置)$/}).click();
 await settings.locator(`.theme-preset-option[data-preset="${pack}"]`).click();await settings.locator(`input[name="settings-theme"][value="${mode}"]`).locator('..').click();
 const language=settings.getByRole('combobox',{name:/^(Language|语言)$/});
 if(await language.evaluate(e=>e.tagName)==='SELECT')await language.selectOption(locale);else{await language.click();await web.getByRole('option',{name:locale==='en'?/English/:/简体中文/}).click();}
 await expect(glass.locator('html')).toHaveAttribute('lang',locale,{timeout:1000});await expect(glass.locator('html')).toHaveAttribute('data-theme-preset',pack,{timeout:1000});await expect(glass.locator('html')).toHaveAttribute('data-theme-effective',mode,{timeout:1000});
 await web.keyboard.press('Escape');await expect(settings).toHaveCount(0);
}
async function geometry(width){const value=await app.evaluate(({BrowserWindow,screen},width)=>{const area=screen.getPrimaryDisplay().workArea,main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith(globalThis.__pockymoeDesktopTest.settings.get().webOrigin));main.setBounds({x:area.x+12,y:area.y+12,width:Math.min(width,area.width-24),height:Math.min(850,area.height-24)});main.show();main.focus();const pet=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/pet/')&&!w.getParentWindow());return {main:main.getBounds(),pet:pet.getBounds()};},width);const x=value.main.x+value.main.width-230,y=value.main.y+value.main.height-175;await action({type:'dragStart',x:value.pet.x,y:value.pet.y});await action({type:'dragMove',x,y});await action({type:'dragEnd',x,y});}
try{
 for(const id of [group.children[3],group.children[4]]){try{event(id,'complete');}catch{/* A completed disposable turn needs no settlement. */}}
 await new Promise(resolve=>setTimeout(resolve,250));for(const id of [group.children[3],group.children[4]])event(id,'start');
 app=await electron.launch({args:[join(repo,'desktop')],env});await expect.poll(()=>app.windows().some(page=>page.url().startsWith(fixture.webOrigin))).toBe(true);web=app.windows().find(page=>page.url().startsWith(fixture.webOrigin));
 phase='sign-in';try{await web.goto(`${fixture.webOrigin}/relay-portal?returnTo=%2F`);await web.getByLabel('Email or username',{exact:true}).fill(fixture.username);await web.getByLabel('Password',{exact:true}).fill(fixture.password);await web.getByRole('button',{name:'Sign in',exact:true}).click();await web.locator('.thread-map[data-presentation="page"]').waitFor({timeout:30000});}catch{throw new Error('Fixture sign-in failed');}signedIn=true;
 for(const page of app.windows().filter(page=>page.url().includes('/pet/'))){await page.waitForFunction(()=>document.body.dataset.surface);if(await page.locator('body').getAttribute('data-surface')==='sprite')sprite=page;else glass=page;}
 phase='actual-conversation-shape';await expect.poll(()=>app.evaluate(()=>globalThis.__pockymoeDesktopTest.hub.snapshot()?.syncedDeviceIds?.length??0),{timeout:30000}).toBe(3);await expect.poll(()=>app.evaluate((_,children)=>globalThis.__pockymoeDesktopTest.hub.snapshot()?.items.filter(item=>children.includes(item.threadId)).length??0,group.children),{timeout:30000}).toBe(5);
 const actual=await app.evaluate((_,ids)=>globalThis.__pockymoeDesktopTest.hub.snapshot().items.filter(item=>ids.includes(item.threadId)).map(item=>({key:item.key,rootThreadKey:item.rootThreadKey,title:item.title,rootThreadTitle:item.rootThreadTitle})),group.children);expect(new Set(actual.map(item=>item.rootThreadKey)).size).toBe(1);expect(actual[0].rootThreadKey).toBe(rootKey);
 phase='live-child-alerts';await expect.poll(()=>app.evaluate((_,id)=>globalThis.__pockymoeDesktopTest.hub.snapshot()?.items.find(item=>item.threadId===id)?.state,group.children[3]),{timeout:15000}).toBe('running');event(group.children[3],'approval');await expect(glass.locator('.bubble.sticky')).toBeVisible({timeout:15000});event(group.children[4],'approval');await expect(glass.locator('.bubble .request-more')).toHaveText('+1',{timeout:15000});
 for(const pack of ['classic','plum-pocket','terminal'])for(const mode of ['light','dark'])for(const width of [1440,900])for(const locale of ['en','zh-CN']){
  const id=`${pack}-${mode}-${width}-${locale}`;phase=id;console.log(`real ${id}`);await preferences(pack,mode,locale);await geometry(width);
  await action({type:'showConversation',key:rootKey});await expect(glass.locator(`.conversation-row[data-conversation-key="${rootKey}"]`)).toHaveCount(1);await expect(glass.locator(`.task-row[data-key="${twinKey}"]`)).toHaveCount(1);
  const own=glass.locator(`.conversation-row[data-conversation-key="${rootKey}"]`);await expect(own.locator('.children-count')).toHaveText('5');await expect(own.locator('.request-row')).toHaveCount(4);await expect(glass.locator('.chat')).toHaveAttribute('data-key',rootKey);
  const keys=await glass.locator('.task-row').evaluateAll(rows=>rows.map(row=>row.dataset.key));expect(new Set(keys).size).toBe(keys.length);expect(await glass.locator('.panel-header').evaluate(e=>e.offsetHeight)).toBe(26);expect(await glass.locator('.panel-header').innerText()).toBe('');expect(await glass.locator('.panel').innerText()).not.toMatch(/智能体|\bAgent\b/);
  await capture(`${id}-panel`);await own.locator(`.request-row[data-key="${group.deviceId}:${group.children[1]}"]`).click();await expect(glass.locator('.chat')).toHaveAttribute('data-key',`${group.deviceId}:${group.children[1]}`);await own.locator('.task-row .row-title').click();await expect(glass.locator('.chat')).toHaveAttribute('data-key',rootKey);
  await action({type:'close'});await expect(glass.locator('.bubble.sticky')).toHaveAttribute('data-conversation-key',rootKey);await expect(glass.locator('.bubble-title')).toHaveText('app');expect(await glass.locator('.bubble').innerText()).not.toMatch(/智能体|\bAgent\b|relay-/);await capture(`${id}-bubble`);
 }
 writeFileSync(`${out}/results.json`,JSON.stringify({result:'passed',actual,captures,rootKey,twinKey},null,2));console.log(`PASS ${captures.length} native captures over real fixture map; real root/child grouping and locale/theme sync.`);
}catch(error){if(signedIn)console.error(error.message);writeFileSync(`${out}/results.json`,JSON.stringify({result:'failed',phase,captures},null,2));console.error(`Conversation real QA failed at ${phase}; authentication data omitted.`);process.exitCode=1;}
finally{if(app)await app.close().catch(()=>{});rmSync(profile,{recursive:true,force:true});}
