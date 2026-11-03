import { recordLifecycle } from './lifecycle';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ActivityItem, DesktopSettings, PockymoeHost } from '../src/shared/contract';
import { item, snapshot } from './fixtures';

// Runtime type is declared by shell.e2e.ts.
declare global { interface Window { pockymoeHost?: PockymoeHost; commands: unknown[] } }
const evidence = process.env.POCKYMOE_DESKTOP_EVIDENCE || join(tmpdir(), 'pockymoe-pet-work-evidence');
/** An unpacked pack with clips, to check real playback; the fixtures here have no WebP encoder. */
const clipPack = process.env.POCKYMOE_CLIP_PACK;
type Testing = { hub: { sync(value: unknown): void }; settings: { set(patch: Partial<DesktopSettings>): void }; appearance: { sync(value: unknown): void }; windows: { createLocal(view: string): void } };
const clipPackId = (): string => (JSON.parse(readFileSync(join(clipPack!, 'pet.json'), 'utf8')) as { id: string }).id;
let server: Server, origin: string, app: ElectronApplication, profile: string, page: Page;
let speech: string[] = [];
function wav(): Buffer {
  const n = 480, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const FIXTURE = `<!doctype html><meta charset="utf-8"><title>Fixture</title><script>window.commands=[];window.fixtureReady=false;const installFixture=()=>{window.pockymoeHost?.onCommand(command=>{window.commands.push(command);
  const data=command.type==='turnText'?{request:'修一下登录白屏',answer:'白屏已修好，原因是回调读取了未加载的用户信息。'}:command.type==='listConnections'?[{deviceId:'old',deviceName:'wsl',id:'c2',name:'Older',protocol:'openai_chat',model:'small',supervisorVersion:'0.13.41',needsUpdate:true},{deviceId:'mac',deviceName:'MacBook',id:'c1',name:'Main',protocol:'openai_chat',model:'small',supervisorVersion:'0.13.43',needsUpdate:false}]:command.type==='listMuteTargets'?{devices:[{id:'mac',label:'MacBook Pro'},{id:'pc',label:'Windows PC'}],workspaces:[{id:'mac:rc',label:'remoteCodex · MacBook Pro'}],threads:[{id:'mac:thread-1',label:'修复登录状态同步 · remoteCodex'}]}:command.type==='connectionModels'?[{id:'small',name:'Small model'},{id:'large',name:'Large model'}]:command.type==='completeWithConnection'?{text:'连接总结：白屏修好了。'}:undefined;
  if(command.type==='connectionModels'&&window.failModels){window.pockymoeHost.commandResult(command.id,{ok:false,error:'upstream refused'});return;}
  if(command.type==='completeWithConnection'&&command.connectionId==='c2'){window.pockymoeHost.commandResult(command.id,{ok:false,code:'supervisorTooOld',error:'x'});return;}
  window.pockymoeHost.commandResult(command.id,{ok:true,...(data?{data}:{})});});window.fixtureReady=true;};if(document.readyState==='loading')addEventListener('DOMContentLoaded',installFixture,{once:true});else installFixture();</script>`;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end(FIXTURE); return; }
      if (req.url === '/v1/audio/speech') { speech.push(JSON.parse(body).input as string); res.setHeader('content-type', 'audio/wav'); res.end(wav()); return; }
      res.statusCode = 404; res.end();
    });
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture port missing');
  origin = `http://127.0.0.1:${address.port}`; mkdirSync(evidence, { recursive: true });
});
test.afterAll(async () => { await new Promise<void>(done => server.close(() => done())); });
test.beforeEach(async () => {
  speech = []; profile = mkdtempSync(join(tmpdir(), 'pockymoe-pet-work-'));
  if (clipPack && test.info().title.startsWith('clips')) { mkdirSync(join(profile, 'pets')); cpSync(clipPack, join(profile, 'pets', clipPackId()), { recursive: true }); }
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key]!;
  Object.assign(env, { POCKYMOE_DESKTOP_E2E: '1', POCKYMOE_DESKTOP_USER_DATA: profile, POCKYMOE_DESKTOP_WEB_ORIGIN: origin, POCKYMOE_DESKTOP_RELAY_ORIGIN: origin });
  const packaged = process.env.POCKYMOE_PACKAGED_EXECUTABLE || process.env.POCKYMOE_DESKTOP_APP;
  app = await electron.launch({ ...(packaged ? { executablePath: packaged, args: [`--lang=${process.env.POCKYMOE_TEST_SYSTEM_LOCALE || 'en-US'}`, ...(process.env.POCKYMOE_DESKTOP_SCALE ? [`--force-device-scale-factor=${process.env.POCKYMOE_DESKTOP_SCALE}`] : [])] } : { args: [resolve('.'), `--lang=${process.env.POCKYMOE_TEST_SYSTEM_LOCALE || 'en-US'}`] }), env });
  await recordLifecycle(app, join(evidence, `lifecycle-${Date.now()}.jsonl`));
  await expect.poll(() => app.evaluate(() => '__pockymoeDesktopTest' in globalThis)).toBe(true);
  await app.evaluate(() => globalThis.__pockymoeDesktopTest.appearance.sync({ pack: 'classic', effective: 'light', accent: '#a57224', locale: 'en' }));
  await expect.poll(() => app.evaluate(() => '__pockymoeDesktopTest' in globalThis)).toBe(true);
  await expect.poll(() => app.windows().filter(window => window.url().includes('pet/index.html')).length, { timeout: 20_000 }).toBe(2);
  await expect.poll(() => app.windows().some(window => window.url().startsWith(origin))).toBe(true);
  page = app.windows().find(window => window.url().startsWith(origin))!;
  await page.waitForLoadState('domcontentloaded');
  // Match the real Web's post-mount command registration. An inline head script
  // can announce readiness before the initial navigation event clears it.
  await expect.poll(() => page.evaluate(() => (window as unknown as { fixtureReady?: boolean }).fixtureReady)).toBe(true);
  await expect.poll(() => page.evaluate(() => !!window.pockymoeHost)).toBe(true);
  await page.evaluate(() => window.pockymoeHost!.capabilities());
});
test.afterEach(async () => { await app?.close(); rmSync(profile, { recursive: true, force: true }); });
const pet = async (surface: 'sprite' | 'glass'): Promise<Page> => {
  for (const window of app.windows().filter(candidate => candidate.url().includes('pet/index.html'))) if (await window.evaluate(() => document.body.dataset.surface) === surface) return window;
  throw new Error(`No ${surface} window`);
};
const settings = (patch: Partial<DesktopSettings>): Promise<void> => app.evaluate((_e, value) => (globalThis as unknown as { __pockymoeDesktopTest: Testing }).__pockymoeDesktopTest.settings.set(value), patch);
// The next action comes from a different renderer. Await a same-frame IPC roundtrip
// so it cannot overtake a fire-and-forget activity update under runner load.
const sync = (items: ActivityItem[]): Promise<void> => page.evaluate(async value => { window.pockymoeHost!.activity.sync(value); await window.pockymoeHost!.capabilities(); }, snapshot(items));
const baseline = (): Promise<void> => page.evaluate(async value => { window.pockymoeHost!.activity.sync(value); await window.pockymoeHost!.capabilities(); }, snapshot([], { generatedAt: '2026-11-01T05:59:00.000Z', syncedDeviceIds: ['mac', 'pc'] }));
const finish = async (): Promise<void> => { await baseline(); await sync([item()]); await sync([item({ state: 'completed', unread: true })]); };
const movePetUnderPointer = (): Promise<void> => app.evaluate(({ BrowserWindow, screen }) => {
  const sprite = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('pet/index.html') && !window.getParentWindow())!;
  const bounds = sprite.getBounds();
  // Pin the input, not the native window: another test or the owner moving the
  // real pointer must not change the hover condition during this regression.
  screen.getCursorScreenPoint = () => ({ x: bounds.x + Math.round(bounds.width / 2), y: bounds.y + Math.round(bounds.height / 2) });
});
const glassBounds = (): Promise<{ y: number; visible: boolean; height: number }> => app.evaluate(({ BrowserWindow }) => {
  const glass = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('pet/index.html') && !!window.getParentWindow())!;
  return { ...glass.getBounds(), visible: glass.isVisible() };
});

test('a bubble stays solid and is not redrawn while the pointer is on it', async () => {
  await finish();
  const glass = await pet('glass');
  await expect(glass.locator('.bubble')).toBeVisible();
  await movePetUnderPointer();
  await expect(glass.locator('.controls')).toBeVisible();
  await glass.evaluate(() => document.fonts.ready);
  // Await the measurement IPC itself. Windows rounds logical window bounds to
  // physical pixels (and enforces native minimums), so outer bounds are not a
  // valid acknowledgement of an exact CSS height at fractional display scales.
  const measured = await glass.evaluate(async () => {
    const root = document.querySelector('#app')!.getBoundingClientRect();
    return (window as unknown as { rcDesktop: { pet: { action(value: unknown): Promise<{ ok: boolean }> } } }).rcDesktop.pet.action({ type: 'surfaceMeasure', width: Math.ceil(root.width), height: Math.ceil(root.height) });
  });
  expect(measured.ok).toBe(true);
  await glass.evaluate(() => { const w = window as unknown as { rewrites: number }; w.rewrites = 0; new MutationObserver(records => { w.rewrites += records.length; }).observe(document.querySelector('#app')!, { childList: true, subtree: true }); });
  const heights: number[] = [];
  for (let i = 0; i < 20; i++) { heights.push((await glassBounds()).y); await glass.waitForTimeout(100); }
  // Constant hover after the measured size is acknowledged must not redraw or drift.
  expect(await glass.evaluate(() => (window as unknown as { rewrites: number }).rewrites)).toBeLessThan(8);
  expect(new Set(heights).size).toBeLessThanOrEqual(2);
  // Past the old six-second fade.
  await glass.waitForTimeout(5000);
  expect(await glass.locator('.bubble').evaluate(element => Number(getComputedStyle(element).opacity))).toBe(1);
});
test('clicking the pet lists what is running and opens it', async () => {
  await baseline();
  await sync([item(), item({ key: 'pc:thread-2', deviceId: 'pc', deviceName: 'Windows PC', threadId: 'thread-2', title: '整理发布说明' }), item({ key: 'mac:done', threadId: 'done', title: '已完成的线程', state: 'completed', unread: true })]);
  const sprite = await pet('sprite'), glass = await pet('glass');
  await sprite.evaluate(() => (window as unknown as { rcDesktop: { pet: { action(value: unknown): Promise<unknown> } } }).rcDesktop.pet.action({ type: 'click' }));
  await expect(glass.locator('.running-row')).toHaveCount(2);
  await expect(glass.locator('.running-list')).not.toContainText('已完成的线程');
  await expect(glass.locator('.controls')).toBeVisible();
  await expect(sprite.locator('#app')).toHaveAttribute('data-mood', 'poked');
  const bounds = (): Promise<{ bounds: { y: number; height: number }; child: boolean }[]> => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.webContents.getURL().includes('pet/index.html')).map(window => ({ bounds: window.getBounds(), child: !!window.getParentWindow() })));
  await expect.poll(async () => { const all = await bounds(); return all.find(entry => entry.child)!.bounds.y - all.find(entry => !entry.child)!.bounds.y - all.find(entry => !entry.child)!.bounds.height; }).toBeGreaterThanOrEqual(0);
  for (const [pack, effective] of [['classic', 'light'], ['classic', 'dark'], ['plum-pocket', 'light'], ['plum-pocket', 'dark'], ['terminal', 'light'], ['terminal', 'dark']] as const) {
    await app.evaluate((_e, value) => (globalThis as unknown as { __pockymoeDesktopTest: Testing }).__pockymoeDesktopTest.appearance.sync(value), { pack, effective, accent: pack === 'terminal' ? '#31bd84' : pack === 'plum-pocket' ? '#8f5a9e' : '#ad782e', locale: 'zh-CN' });
    await glass.waitForTimeout(100);
    await glass.screenshot({ path: join(evidence, `running-${pack}-${effective}.png`), animations: 'disabled' });
  }
  await glass.locator('.running-row', { hasText: '整理发布说明' }).click();
  await expect.poll(() => page.evaluate(() => window.commands.map(command => JSON.stringify(command)).join())).toContain('/devices/pc/threads/thread-2');
});
test('with nothing running, the click says so', async () => {
  await baseline();
  const sprite = await pet('sprite'), glass = await pet('glass');
  await sprite.evaluate(() => (window as unknown as { rcDesktop: { pet: { action(value: unknown): Promise<unknown> } } }).rcDesktop.pet.action({ type: 'click' }));
  await expect(glass.locator('.running-list .empty')).toContainText('No threads are running');
});
test('working: the pet shows work while a thread runs', async () => {
  await baseline();
  await sync([item()]);
  await expect.poll(async () => (await pet('sprite')).locator('#app').getAttribute('data-mood'), { timeout: 12_000 }).toBe('running');
});
const speaker = { petVoice: true, petVoiceProvider: 'compatible' as const, petVoiceSpeed: 1, petVoiceSummary: true, petSummaryLanguage: 'zh-CN' as const };
const remoteVoice = (): Partial<DesktopSettings> => ({ ...speaker, petVoiceRemotes: { compatible: { url: `${origin}/v1`, model: 't', voice: '', style: '', extra: '' } } });
const openPreferences = async (): Promise<Page> => {
  await app.evaluate(() => (globalThis as unknown as { __pockymoeDesktopTest: Testing }).__pockymoeDesktopTest.windows.createLocal('preferences'));
  await expect.poll(() => app.windows().some(window => window.url().includes('preferences'))).toBe(true);
  const preferences = app.windows().find(window => window.url().includes('preferences'))!;
  await preferences.locator('[data-section="pet"]').click();
  // Discovery starts when this section mounts. Open its pickers only after their
  // data arrives; an open picker deliberately defers replacing its options.
  await preferences.evaluate(() => new Promise<void>(resolve => {
    const bridge = (window as unknown as { pockymoeDesktop: import('../src/shared/local').LocalBridge }).pockymoeDesktop;
    const ready = (state: import('../src/shared/local').LocalState): boolean => !!state.summary.muteTargets && (!state.settings.petVoiceSummary || state.summary.connections.length > 0);
    // Await the data broadcasts produced by the UI's actual requests. A separate
    // five-second polling deadline can expire before the query's own IPC deadline.
    const stop = bridge.onState(state => { if (ready(state)) { stop(); resolve(); } });
    void bridge.getState().then(state => { if (ready(state)) { stop(); resolve(); } });
  }));
  return preferences;
};
test('summary: picks a saved upstream and its model, and reads what the model said', async () => {
  await settings(remoteVoice());
  const preferences = await openPreferences();
  await preferences.locator('#summary-source').click();
  await preferences.getByRole('option', { name: 'Main · MacBook' }).click();
  await expect(preferences.locator('#summary-model')).toBeVisible();
  await preferences.locator('button#summary-model').click();
  await preferences.getByRole('option', { name: 'Large model' }).click();
  await expect(preferences.locator('button#summary-model')).toContainText('Large model');
  await preferences.locator('#summary-source').scrollIntoViewIfNeeded();
  await preferences.screenshot({ path: join(evidence, 'summary-settings.png'), animations: 'disabled' });
  await page.waitForTimeout(2700); // The sample from turning voice on is rate limited with alerts.
  speech = [];
  await finish();
  await expect.poll(() => speech).toEqual(['连接总结：白屏修好了。']);
  const command = await page.evaluate(() => (window.commands as { type: string }[]).find(entry => entry.type === 'completeWithConnection') as unknown as { deviceId: string; connectionId: string; model: string; user: string; system: string });
  expect(command).toMatchObject({ deviceId: 'mac', connectionId: 'c1', model: 'large' });
  expect(command.system).toContain('Simplified Chinese');
  expect(command.user).toContain('修一下登录白屏'); expect(command.user).toContain('回调读取了未加载的用户信息');
  expect(await page.evaluate(() => (window.commands as { type: string }[]).some(entry => entry.type === 'turnText'))).toBe(true);
});
test('summary: an open list stays open when the window regains focus, and failures are explained', async () => {
  await settings(remoteVoice());
  const preferences = await openPreferences();
  await preferences.locator('#summary-source').click();
  const listbox = preferences.getByRole('listbox');
  await expect(listbox).toBeVisible();
  for (let i = 0; i < 3; i++) { await preferences.evaluate(() => window.dispatchEvent(new Event('focus'))); await preferences.waitForTimeout(200); }
  await expect(listbox).toBeVisible();
  await preferences.getByRole('option', { name: 'Main · MacBook' }).click();
  await expect(preferences.locator('button#summary-model')).toBeVisible();
  // The fixture page stops answering with models: it says why, and the field can be typed in.
  await page.evaluate(() => { (window as unknown as { failModels: boolean }).failModels = true; });
  await preferences.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(preferences.locator('input#summary-model')).toBeVisible();
  await expect(preferences.locator('.voice-field:has(#summary-model) .inline-error')).toContainText('upstream refused');
});
test('summary: marks and explains an upstream on a device that needs updating', async () => {
  await settings(remoteVoice());
  const preferences = await openPreferences();
  await preferences.locator('#summary-source').click();
  const options = await preferences.getByRole('option').allTextContents();
  expect(options.findIndex(text => text.includes('Main · MacBook'))).toBeLessThan(options.findIndex(text => text.includes('Older · wsl · needs update')));
  await preferences.getByRole('option', { name: 'Older · wsl · needs update' }).click();
  await expect(preferences.locator('.setting-row:has(#summary-source) .inline-error')).toContainText('wsl runs Supervisor 0.13.41');
  await page.waitForTimeout(2700);
  speech = [];
  await finish();
  await expect.poll(() => speech).toEqual(['修复登录状态同步 finished']);
  await expect(preferences.locator('#summary-result')).toContainText("this device's Supervisor needs 0.13.43");
  // Choosing another upstream clears what the last attempt said about the old one.
  await preferences.locator('#summary-source').click();
  await preferences.getByRole('option', { name: 'Main · MacBook' }).click();
  await expect(preferences.locator('#summary-result')).toHaveText('');
});
test('summary: falls back to saying it finished when nothing is selected, and has no address field', async () => {
  await settings(remoteVoice());
  await page.waitForTimeout(2700);
  speech = [];
  await finish();
  await expect.poll(() => speech).toEqual(['修复登录状态同步 finished']);
  const preferences = await openPreferences();
  await expect(preferences.locator('#summary-result')).toContainText('Choose an upstream first');
  await expect(preferences.locator('#summary-url')).toHaveCount(0);
  await expect(preferences.locator('#summary-key')).toHaveCount(0);
  await preferences.locator('#open-upstreams').click();
  await expect.poll(() => page.evaluate(() => (window.commands as { type: string }[]).some(entry => entry.type === 'openUpstreams'))).toBe(true);
});
const lastCue = async (): Promise<string> => (await (await pet('sprite')).locator('#app').getAttribute('data-last-cue')) ?? '';
test('silencing: a device added in Preferences stops the voice but keeps the alert', async () => {
  await settings({ ...remoteVoice(), petVoiceSummary: false, petSound: true });
  const preferences = await openPreferences();
  await preferences.locator('#mute-kind').click();
  await preferences.getByRole('option', { name: 'Device', exact: true }).click();
  await preferences.locator('#mute-target').click();
  await preferences.getByRole('option', { name: 'MacBook Pro' }).click();
  await expect(preferences.locator('.mute-rule')).toContainText('MacBook Pro');
  await preferences.locator('.mute-rule').scrollIntoViewIfNeeded();
  await preferences.screenshot({ path: join(evidence, 'mutes.png'), animations: 'disabled' });
  await page.waitForTimeout(2700);
  speech = [];
  await finish();
  await expect((await pet('glass')).locator('.bubble')).toBeVisible();
  await expect.poll(lastCue).toContain('completed');
  await page.waitForTimeout(1500);
  expect(speech).toEqual([]);
  await preferences.locator('.mute-remove').click();
  await expect(preferences.locator('.mute-rule')).toHaveCount(0);
});
test('silencing: with alerts too, nothing shows for finished work but a request still does', async () => {
  await settings({ ...remoteVoice(), petVoiceSummary: false, petMuteAlerts: true, petMutes: [{ kind: 'thread', id: 'mac:thread-1', label: 't' }] });
  await page.waitForTimeout(2700);
  speech = [];
  await finish();
  await page.waitForTimeout(1500);
  expect(speech).toEqual([]);
  await expect((await pet('glass')).locator('.bubble')).toHaveCount(0);
  await sync([item({ state: 'needsInput', turnId: 'turn-2', request: { id: 'r1', kind: 'approval', summary: 'Allow?' } })]);
  await expect((await pet('glass')).locator('.bubble')).toBeVisible();
  await expect.poll(() => speech.length).toBe(1);
});
test('silencing: the activity panel can silence a conversation', async () => {
  await baseline();
  await sync([item()]);
  const sprite = await pet('sprite'), glass = await pet('glass');
  await sprite.evaluate(() => (window as unknown as { rcDesktop: { pet: { action(value: unknown): Promise<unknown> } } }).rcDesktop.pet.action({ type: 'toggleTray' }));
  const toggle = glass.locator('[data-action="toggleMute"]').first();
  await toggle.evaluate(element => (element as HTMLElement).click());
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await glass.locator('[data-action="toggleMute"]').first().evaluate(element => (element as HTMLElement).click());
  await expect(glass.locator('[data-action="toggleMute"]').first()).toHaveAttribute('aria-pressed', 'false');
});
test('a summary that works is not reported as failed when the voice cannot read it', async () => {
  await settings({ petVoice: true, petVoiceProvider: 'compatible', petVoiceRemotes: { compatible: { url: 'http://127.0.0.1:9/v1', model: 't', voice: '', style: '', extra: '' } }, petVoiceSummary: true, petSummaryConnection: { deviceId: 'mac', id: 'c1', name: 'Main · MacBook', model: '' } });
  const preferences = await openPreferences();
  await preferences.locator('#summary-test').click();
  await expect(preferences.locator('#summary-result')).toHaveText('连接总结：白屏修好了。');
  await expect(preferences.locator('#voice-error')).toContainText("Can't reach the voice service");
  await expect(preferences.locator('#toast.visible')).toHaveCount(0);
});
test('mini mode keeps the pet on screen, just smaller', async () => {
  const sprite = await pet('sprite');
  const size = (): Promise<{ height: number; hidden: boolean }> => sprite.locator('#character').evaluate(element => ({ height: element.getBoundingClientRect().height, hidden: (element as HTMLElement).hidden }));
  const before = await size();
  await settings({ petMini: true });
  await expect.poll(async () => (await size()).height).toBeLessThan(before.height);
  expect((await size()).hidden).toBe(false);
  await sprite.screenshot({ path: join(evidence, 'mini.png'), omitBackground: true });
  await settings({ petMini: false });
  await expect.poll(async () => (await size()).height).toBe(before.height);
});
test('docked: an alert brings the head out, and it tucks back when the alert is gone', async () => {
  const sprite = await pet('sprite');
  const act = (value: unknown): Promise<unknown> => sprite.evaluate(input => (window as unknown as { rcDesktop: { pet: { action(value: unknown): Promise<unknown> } } }).rcDesktop.pet.action(input), value);
  // Dock on whichever side the real pointer is not, since hovering brings her out.
  const geometry = await app.evaluate(({ screen, BrowserWindow }) => { const point = screen.getCursorScreenPoint(), area = screen.getPrimaryDisplay().workArea, bounds = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('pet/index.html') && !window.getParentWindow())!.getBounds(); return { point, area, bounds }; });
  const toRight = geometry.point.x < geometry.area.x + geometry.area.width / 2;
  const startX = geometry.bounds.x + 10, startY = geometry.bounds.y + 10, endX = toRight ? geometry.area.x + geometry.area.width + 40 : geometry.area.x - 40 - geometry.bounds.width;
  await act({ type: 'dragStart', x: startX, y: startY }); await act({ type: 'dragMove', x: startX + 30, y: startY }); await act({ type: 'dragEnd', x: startX + (endX - geometry.bounds.x), y: startY });
  const amount = async (): Promise<number> => Number(await sprite.locator('#app').getAttribute('data-dock-amount'));
  await expect.poll(amount, { timeout: 4000 }).toBe(1);
  await finish();
  await expect.poll(amount, { timeout: 2000 }).toBe(.6);
  await expect(sprite.locator('#character')).toHaveClass(/peeking/);
  await sprite.screenshot({ path: join(evidence, 'head-peek.png'), omitBackground: true });
  await act({ type: 'dismiss' });
  await expect.poll(amount, { timeout: 2000 }).toBe(1);
});
test('closing the panel leaves the main window where it was', async () => {
  const sprite = await pet('sprite');
  const act = (value: unknown): Promise<unknown> => sprite.evaluate(input => (window as unknown as { rcDesktop: { pet: { action(value: unknown): Promise<unknown> } } }).rcDesktop.pet.action(input), value);
  const focused = (): Promise<boolean> => app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.mainFocused());
  // Windows may immediately refocus the only eligible visible window after blur.
  // Give native focus a real destination while keeping the main window visible.
  const keeper = await app.evaluate(async ({ BrowserWindow }) => {
    const window = new BrowserWindow({ width: 300, height: 200, show: false, title: 'Focus fixture' });
    await window.loadURL('about:blank'); window.show(); window.focus(); return window.id;
  });
  await expect.poll(() => app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.isFocused(), keeper)).toBe(true);
  await expect.poll(focused).toBe(false);
  await act({ type: 'toggleTray' });
  // What a real click can do on macOS: the app comes forward with its main window.
  if (process.platform === 'darwin') await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('pet/index.html'))?.focus(); });
  await act({ type: 'close' });
  await expect.poll(focused).toBe(false);
});
test('clips: a pack with clips plays them and survives a click', async () => {
  test.skip(!clipPack, 'POCKYMOE_CLIP_PACK is not set');
  test.setTimeout(60_000);
  await settings({ petId: clipPackId() });
  await baseline();
  await sync([item()]);
  const sprite = await pet('sprite');
  await expect(sprite.locator('#app')).toHaveAttribute('data-mood', 'running', { timeout: 6000 });
  await expect(sprite.locator('#character')).toHaveClass(/clips/, { timeout: 10_000 });
  const sample = (): Promise<string> => sprite.evaluate(() => { const canvas = document.querySelector<HTMLCanvasElement>('#clip')!; const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data; let hash = 0, opaque = 0; for (let i = 0; i < data.length; i += 16) { hash = (hash * 31 + data[i]!) | 0; if (data[i + 3]! > 24) opaque++; } return `${hash}:${opaque > 500}`; });
  const seen = new Set<string>();
  for (let i = 0; i < 12; i++) { seen.add(await sample()); await sprite.waitForTimeout(150); }
  expect(seen.size).toBeGreaterThan(5);
  expect([...seen].every(value => value.endsWith('true'))).toBe(true);
  for (const name of ['a', 'b', 'c', 'd']) { await sprite.screenshot({ path: join(evidence, `clip-running-${name}.png`), omitBackground: true }); await sprite.waitForTimeout(1200); }
  await sprite.evaluate(() => (window as unknown as { rcDesktop: { pet: { action(value: unknown): Promise<unknown> } } }).rcDesktop.pet.action({ type: 'click' }));
  await expect(sprite.locator('#app')).toHaveAttribute('data-mood', 'poked');
  await sprite.waitForTimeout(1500);
  await sprite.screenshot({ path: join(evidence, 'clip-poked.png'), omitBackground: true });
  await expect(sprite.locator('#character')).toHaveClass(/clips/);
});

for (const surface of ['glass', 'sprite'] as const) test(`native close on ${surface} keeps a usable sprite`, async () => {
  await baseline(); await settings({ petVisible: true, petEdgeHide: false });
  const sprite = await pet('sprite'), glass = await pet('glass');
  const act = (value: unknown) => sprite.evaluate(input => (window as unknown as { rcDesktop: { pet: { action(value: unknown): Promise<unknown> } } }).rcDesktop.pet.action(input), value);
  await act({ type: 'toggleTray' }); await expect(glass.locator('.panel')).toBeVisible();
  await app.evaluate(({ BrowserWindow }, surface) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('pet/index.html') && !!window.getParentWindow() === (surface === 'glass'))!;
    window.close();
  }, surface);
  await expect(glass.locator('.panel')).toHaveCount(0);
  if (surface === 'sprite') {
    expect(await app.evaluate(() => globalThis.__pockymoeDesktopTest.settings.get().petVisible)).toBe(false);
    await settings({ petVisible: true });
  }
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.webContents.getURL().includes('pet/index.html')).length)).toBe(2);
  await act({ type: 'toggleTray' }); await expect(glass.locator('.panel')).toBeVisible();
  await expect(sprite.locator('#character')).toBeVisible();
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('pet/index.html') && !window.getParentWindow())!.isVisible())).toBe(true);
});

for (const surface of ['glass', 'sprite'] as const) test(`destroying ${surface} retires both pet windows`, async () => {
  const ids = await app.evaluate(({ BrowserWindow }, surface) => {
    const pets = BrowserWindow.getAllWindows().filter(window => window.webContents.getURL().includes('pet/index.html'));
    const ids = pets.map(window => window.id);
    pets.find(window => !!window.getParentWindow() === (surface === 'glass'))!.destroy();
    return ids;
  }, surface);
  // A dying window can remain in getAllWindows with null webContents. Track the
  // native IDs captured before destruction instead of dereferencing retired URLs.
  await expect.poll(() => app.evaluate(({ BrowserWindow }, ids) => ids.every(id => {
    const window = BrowserWindow.fromId(id); return !window || window.isDestroyed();
  }), ids)).toBe(true);
  await page.evaluate(() => window.pockymoeHost!.window.openPreferences('pet'));
  await expect.poll(() => app.windows().some(page => page.url().includes('view=preferences'))).toBe(true);
  const prefs = app.windows().find(page => page.url().includes('view=preferences'))!;
  await expect.poll(() => prefs.evaluate(async () => (await (window as unknown as { pockymoeDesktop: { getState(): Promise<{ petAvailable: boolean }> } }).pockymoeDesktop.getState()).petAvailable)).toBe(false);
});

test('empty panel omits reply row and settles without moving the sprite', async () => {
  await baseline(); await settings({ petVisible: true, petEdgeHide: false });
  const sprite = await pet('sprite'), glass = await pet('glass');
  const act = (value: unknown) => sprite.evaluate(input => (window as unknown as { rcDesktop: { pet: { action(value: unknown): Promise<unknown> } } }).rcDesktop.pet.action(input), value);
  await act({ type: 'toggleTray' });
  await expect(glass.locator('.empty')).toHaveText('All caught up');
  await expect(glass.locator('#chat-form')).toHaveCount(0);
  const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('pet/index.html') && !window.getParentWindow())!.getBounds());
  const height = (await glassBounds()).height;
  await sync([item()]); await expect(glass.locator('#chat-form')).toBeVisible();
  await page.evaluate(value => window.pockymoeHost!.activity.sync(value), snapshot([], { accountId: 'empty-panel-account', syncedDeviceIds: ['mac', 'pc'] }));
  await act({ type: 'toggleTray' });
  await expect(glass.locator('.empty')).toHaveText('All caught up');
  await expect(glass.locator('#chat-form')).toHaveCount(0);
  await expect.poll(async () => (await glassBounds()).height).toBe(height);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('pet/index.html') && !window.getParentWindow())!.getBounds())).toEqual(before);
});

test('agent alerts: picker, names and six theme appearances', async () => {
  await baseline();
  const preferences = await openPreferences(), glass = await pet('glass');
  await expect(preferences.locator('#petAgentAlerts')).toContainText('Alert and announce');
  await preferences.locator('#petAgentAlerts').click();
  await preferences.getByRole('option', { name: 'Alert without announcing', exact: true }).click();
  await expect.poll(() => app.evaluate(() => globalThis.__pockymoeDesktopTest.settings.get().petAgentAlerts)).toBe('silent');
  const a = item({ key: 'mac:agent-a', threadId: 'agent-a', rootThreadKey: 'mac:root', rootThreadTitle: 'A long conversation title with a meaningful ending', agentName: 'terminal' });
  await sync([a]); await sync([{ ...a, state: 'completed', unread: true }]);
  await expect(glass.locator('.bubble-title')).toContainText('.terminal');
  for (const pack of ['classic', 'plum-pocket', 'terminal'] as const) for (const effective of ['light', 'dark'] as const) {
    await app.evaluate((_e, value) => globalThis.__pockymoeDesktopTest.appearance.sync(value), { pack, effective, accent: '#8f5a9e', locale: 'zh-CN' });
    await glass.screenshot({ path: join(evidence, `agent-bubble-${pack}-${effective}.png`), animations: 'disabled' });
    await preferences.locator('#petAgentAlerts').scrollIntoViewIfNeeded();
    await expect(preferences.locator('#petAgentAlerts')).toContainText('只提醒，不播报');
    await preferences.screenshot({ path: join(evidence, `agent-setting-${pack}-${effective}.png`), animations: 'disabled' });
  }
  await preferences.locator('#petAgentAlerts').click();
  await preferences.getByRole('option', { name: '不提醒', exact: true }).click();
  await expect.poll(() => app.evaluate(() => globalThis.__pockymoeDesktopTest.settings.get().petAgentAlerts)).toBe('off');
  await settings({ petVisible: false }); await settings({ petVisible: true });
  const b = { ...a, key: 'mac:agent-b', threadId: 'agent-b', agentName: 'tests' };
  await sync([b]); await sync([{ ...b, state: 'failed', unread: true }]);
  await expect(glass.locator('.bubble')).toHaveCount(0);
  await sync([{ ...b, state: 'needsInput', request: { id: 'agent-input', kind: 'input', summary: 'Please choose' } }]);
  await expect(glass.locator('.bubble-title')).toContainText('.tests');
});

test('clips: speech uses the audio envelope on the fixed rest face and resumes the action', async () => {
  test.skip(!clipPack, 'POCKYMOE_CLIP_PACK is not set');
  const manifest = JSON.parse(readFileSync(join(clipPack!, 'pet.json'), 'utf8')) as { remoteCodex?: { talk?: unknown } };
  test.skip(!manifest.remoteCodex?.talk, 'Pack has no speech faces');
  await settings({ petId: clipPackId(), petEdgeHide: false }); await baseline(); await sync([item()]);
  const sprite = await pet('sprite');
  await expect(sprite.locator('#character')).toHaveClass(/clips/);
  const rate = 24000, count = rate * 3, audio = Buffer.alloc(44 + count * 2);
  audio.write('RIFF'); audio.writeUInt32LE(36 + count * 2, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(rate, 24); audio.writeUInt32LE(rate * 2, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) { const t = i / rate, amplitude = t < .3 || t > 2.3 ? 0 : t < 1.3 ? .045 : .3; audio.writeInt16LE(Math.round(Math.sin(i / rate * 2 * Math.PI * 220) * amplitude * 32767), 44 + i * 2); }
  await app.evaluate(({ BrowserWindow }, bytes) => {
    BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('pet/index.html') && !w.getParentWindow())!.webContents.send('rcDesktop:pet:speech', Uint8Array.from(bytes));
  }, [...audio]);
  const samples = await sprite.evaluate(async () => {
    const result: { face: string; body: string; visible: boolean; level: string | undefined; restBody: string }[] = [];
    const hash = (id: string, bodyOnly = false): string => { const c = document.querySelector<HTMLCanvasElement>(id)!; const data = c.getContext('2d')!.getImageData(0, bodyOnly ? Math.floor(c.height / 2) : 0, c.width, bodyOnly ? Math.floor(c.height / 2) : c.height).data; let hash = 0; for (let i = 0; i < data.length; i += 16) hash = (hash * 31 + data[i]!) | 0; return String(hash); };
    for (let i = 0; i < 100; i++) { result.push({ face: hash('#talk'), body: hash('#clip'), restBody: hash('#talk', true), visible: document.querySelector<HTMLElement>('#talk')!.style.display !== 'none', level: document.querySelector<HTMLElement>('#talk')!.dataset.level }); await new Promise(resolve => setTimeout(resolve, 35)); }
    return result;
  });
  const visible = samples.filter(s => s.visible);
  expect(visible.length).toBeGreaterThan(30);
  expect(new Set(visible.map(s => s.restBody)).size).toBe(1);
  expect(new Set(visible.map(s => s.level))).toEqual(new Set(['0', '1', '2']));
  expect(new Set(visible.map(s => s.face)).size).toBeGreaterThanOrEqual(3);
  expect(new Set(visible.map(s => s.body)).size).toBeGreaterThan(20);
  expect(samples.at(-1)?.visible).toBe(false);
  await expect(sprite.locator('#character')).not.toHaveClass(/talking/);
  await expect(sprite.locator('#character')).toHaveClass(/clips/);
});
