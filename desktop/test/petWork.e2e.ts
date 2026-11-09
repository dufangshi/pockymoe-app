import { openPetPanel } from './petPanel';
import { PNG } from 'pngjs';
import { recordLifecycle } from './lifecycle';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { cpSync, existsSync, writeFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
let speechSamples = 480;
function wav(): Buffer {
  const n = speechSamples, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const FIXTURE = `<!doctype html><meta charset="utf-8"><title>Fixture</title><script>window.commands=[];window.fixtureReady=false;const installFixture=window.installFixture=()=>{window.stopFixture?.();window.stopFixture=window.pockymoeHost?.onCommand(command=>{window.commands.push(command);
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
  speech = []; speechSamples = 480; profile = mkdtempSync(join(tmpdir(), 'pockymoe-pet-work-'));
  if (test.info().title.startsWith('imported pet')) {
    const pack = join(profile, 'pets', 'delete-me'); cpSync(resolve('assets/pets/moe'), pack, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(pack, 'pet.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(join(pack, 'pet.json'), JSON.stringify({ ...manifest, id: 'delete-me', displayName: 'Delete me' }));
  }
  if (clipPack && test.info().title.startsWith('clips')) { mkdirSync(join(profile, 'pets')); cpSync(clipPack, join(profile, 'pets', clipPackId()), { recursive: true }); }
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'DISPLAY', 'XAUTHORITY', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key]!;
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
  await expect.poll(() => app.windows().some(candidate => !candidate.isClosed() && candidate.url().startsWith(origin)), { message: 'The live fixture window must survive navigation' }).toBe(true);
  page = app.windows().find(candidate => !candidate.isClosed() && candidate.url().startsWith(origin))!;
  await page.waitForLoadState('domcontentloaded');
  // fixtureReady is only a renderer flag: a late main navigation reset can clear
  // Windows.ready after the inline listener registered. Re-register idempotently
  // after load, then roundtrip the same-frame IPC before discovery can queue.
  await page.evaluate(async () => { (window as unknown as { installFixture(): void }).installFixture(); await window.pockymoeHost!.capabilities(); });
  await app.evaluate(() => (globalThis as unknown as { __pockymoeDesktopTest: Testing }).__pockymoeDesktopTest.windows.createLocal('preferences'));
  await expect.poll(() => app.windows().some(window => window.url().includes('preferences'))).toBe(true);
  const preferences = app.windows().find(window => window.url().includes('preferences'))!;
  await preferences.locator('[data-section="pet"]').click();
  // Discovery starts when this section mounts. Open its pickers only after their
  // data arrives; an open picker deliberately defers replacing its options.
  await expect.poll(() => preferences.evaluate(async () => {
    const bridge = (window as unknown as { pockymoeDesktop: import('../src/shared/local').LocalBridge }).pockymoeDesktop;
    const state = await bridge.getState();
    return { muteTargets: !!state.summary.muteTargets, connections: !state.settings.petVoiceSummary || state.summary.connections.length > 0 };
  }), { timeout: 20_000, message: 'Fixture discovery must answer after the command-ready handshake' }).toEqual({ muteTargets: true, connections: true });
  return preferences;
};
const announce = async (resultSummary?: string): Promise<Page> => {
  await settings(remoteVoice());
  await pet('sprite').then(sprite => sprite.waitForTimeout(2700)); // The sample from turning voice on is rate limited with alerts.
  speech = [];
  await baseline(); await sync([item()]); await sync([item({ state: 'completed', unread: true, resultSummary })]);
  await expect.poll(() => speech.length).toBe(1);
  return pet('glass');
};
const spriteBounds = (): Promise<{ y: number }> => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('pet/index.html') && !window.getParentWindow())!.getBounds());
test('speech bubble: names the thread above the pet while it is read, and opens on hover', async () => {
  speechSamples = 24000 * 60;
  const glass = await announce('Fixed the callback that read the user before it had loaded.'), bubble = glass.locator('.bubble.speech');
  await expect(bubble.locator('.bubble-line .bubble-title')).toBeVisible();
  await expect(bubble.locator('.speech-wave.playing')).toBeVisible();
  // It stands in for the same thread's pill rather than repeating it.
  await expect(glass.locator('.bubble')).toHaveCount(1);
  await expect(bubble.locator('.speech-detail')).toBeHidden();
  await expect.poll(async () => { const g = await glassBounds(), s = await spriteBounds(); return g.visible && g.y + g.height <= s.y; }).toBe(true);
  const closed = await glassBounds();
  for (const pack of ['classic', 'plum-pocket', 'terminal'] as const) for (const effective of ['light', 'dark'] as const) {
    await app.evaluate((_e, value) => globalThis.__pockymoeDesktopTest.appearance.sync(value), { pack, effective, accent: '#8f5a9e', locale: 'zh-CN' });
    await glass.mouse.move(0, 0);
    await expect(bubble.locator('.speech-detail')).toBeHidden();
    await glass.screenshot({ path: join(evidence, `speech-bubble-${pack}-${effective}.png`), animations: 'disabled' });
    await bubble.hover();
    await expect(bubble.locator('.speech-text')).toHaveText(speech[0]!);
    await expect(bubble.locator('.speech-result')).toContainText('Fixed the callback');
    await expect(bubble.locator('.speech-meta')).toContainText('MacBook');
    await expect(bubble.locator('.speech-foot button')).toHaveCount(2);
    await expect.poll(async () => { const size = await glass.evaluate(() => { const r = document.querySelector('#app')!.getBoundingClientRect(); return { fits: r.height <= innerHeight + 1 && r.width <= innerWidth + 1 }; }); return size.fits; }).toBe(true);
    await glass.screenshot({ path: join(evidence, `speech-bubble-${pack}-${effective}-open.png`), animations: 'disabled' });
  }
  // Growing keeps the side: the bubble's bottom edge stays over her head, next to the pointer.
  const open = await glassBounds();
  expect(open.height).toBeGreaterThan(closed.height);
  expect(open.y + open.height).toBeLessThanOrEqual((await spriteBounds()).y);
  await bubble.locator('.speech-foot button[data-action="open"]').click();
  await expect.poll(() => page.evaluate(() => window.commands.map(command => JSON.stringify(command)).join())).toContain(`/devices/${item().deviceId}/threads/${item().threadId}`);
  await expect(bubble).toHaveCount(0);
});
test('imported pet: can be deleted where packs are imported, after confirming, and a bundled pet cannot', async () => {
  await settings({ petId: 'delete-me' });
  await app.evaluate(({ dialog }) => { const g = globalThis as unknown as { dialogs: Electron.MessageBoxOptions[]; dialogResponse: number }; g.dialogs = []; g.dialogResponse = 0; dialog.showMessageBox = (async (options: Electron.MessageBoxOptions) => { g.dialogs.push(options); return { response: g.dialogResponse, checkboxChecked: false }; }) as typeof dialog.showMessageBox; });
  const preferences = await openPreferences(), remove = preferences.locator('#delete-pet');
  await expect(remove).toBeVisible();
  for (const pack of ['classic', 'plum-pocket', 'terminal'] as const) for (const effective of ['light', 'dark'] as const) {
    await app.evaluate((_e, value) => globalThis.__pockymoeDesktopTest.appearance.sync(value), { pack, effective, accent: '#8f5a9e', locale: 'zh-CN' });
    await preferences.locator('.pet-picker-row').screenshot({ path: join(evidence, `delete-pet-${pack}-${effective}.png`), animations: 'disabled' });
  }
  const packFile = join(profile, 'pets', 'delete-me', 'pet.json');
  // Cancel keeps everything.
  await remove.click();
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { dialogs: Electron.MessageBoxOptions[] }).dialogs.length)).toBe(1);
  expect(await app.evaluate(() => (globalThis as unknown as { dialogs: Electron.MessageBoxOptions[] }).dialogs[0]!.message)).toContain('Delete me');
  await preferences.waitForTimeout(300);
  expect(existsSync(packFile)).toBe(true);
  expect(await app.evaluate(() => globalThis.__pockymoeDesktopTest.settings.get().petId)).toBe('delete-me');
  // Confirming removes it, and the pet falls back to the bundled one.
  await app.evaluate(() => { (globalThis as unknown as { dialogResponse: number }).dialogResponse = 1; });
  await remove.click();
  await expect.poll(() => existsSync(packFile)).toBe(false);
  await expect.poll(() => app.evaluate(() => globalThis.__pockymoeDesktopTest.settings.get().petId)).toBe('moe');
  await expect(preferences.locator('#delete-pet')).toHaveCount(0);
  await expect((await pet('sprite')).locator('#character')).toBeVisible();
});
test('speech bubble: a request stays where it is while another thread is read', async () => {
  speechSamples = 24000 * 60;
  await settings(remoteVoice());
  const sprite = await pet('sprite'), glass = await pet('glass');
  await sprite.waitForTimeout(2700);
  const request = item({ key: 'mac:waiting', threadId: 'waiting', title: 'Waiting for you', state: 'needsInput', request: { id: 'r1', kind: 'approval', summary: 'Allow the command?' } as ActivityItem['request'] });
  await baseline(); await sync([request]);
  const approve = glass.locator('.bubble.sticky [data-action="approve"]');
  await expect(approve).toBeVisible();
  // Its own announcement only marks the bubble, with no second line naming the same thread.
  await expect(glass.locator('.bubble.sticky .speech-wave.playing')).toBeVisible();
  await expect(glass.locator('.bubble.speech')).toHaveCount(0);
  const position = async (): Promise<{ x: number; y: number }> => { const g = await glassBounds() as { x?: number; y: number }, box = (await approve.boundingBox())!; return { x: Math.round((g.x ?? 0) + box.x), y: Math.round(g.y + box.y) }; };
  await expect.poll(async () => (await glassBounds()).visible).toBe(true);
  const before = await position();
  await sprite.waitForTimeout(2700);
  await sync([request, item({ state: 'completed', unread: true })]);
  await expect(glass.locator('.bubble.speech')).toBeVisible();
  await expect.poll(position).toEqual(before);
  await glass.screenshot({ path: join(evidence, 'speech-bubble-with-request.png'), animations: 'disabled' });
});
test('speech bubble: after the audio ends it lingers, then gives way to the pill', async () => {
  const glass = await announce();
  await expect(glass.locator('.bubble.speech')).toBeVisible();
  await expect(glass.locator('.speech-wave.playing')).toHaveCount(0);
  await expect(glass.locator('.bubble.speech')).toHaveCount(0, { timeout: 8000 });
  await expect(glass.locator('.bubble .bubble-title')).toBeVisible();
});
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
test('preferences discovery reannounces fixture readiness after a late navigation reset', async () => {
  await settings(remoteVoice());
  await app.evaluate(({ BrowserWindow }) => {
    const relay = BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('pet/index.html'))!;
    // Reproduce the host-side reset without destroying the loaded fixture listener.
    relay.webContents.emit('did-start-navigation', {}, relay.webContents.getURL(), false, true);
  });
  const preferences = await openPreferences();
  await expect(preferences.locator('#summary-source')).toBeVisible();
  await preferences.locator('#summary-source').click();
  await expect(preferences.getByRole('option', { name: 'Main · MacBook' })).toBeVisible();
});
test('panel opening waits for delayed glass state instead of toggling it closed', async () => {
  await baseline();
  const glass = await pet('glass'), sprite = await pet('sprite');
  await app.evaluate(({ BrowserWindow }) => {
    const glass = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/pet/') && !!w.getParentWindow())!;
    const send = glass.webContents.send.bind(glass.webContents), queue: (() => void)[] = [];
    const replay = { hold: true, queue, modes: [] as string[], flush() { replay.hold = false; for (const send of queue.splice(0)) send(); } };
    Object.assign(globalThis, { panelReplay: replay });
    glass.webContents.send = (channel, ...args) => {
      if (channel === 'rcDesktop:pet:state' && replay.hold) { replay.modes.push((args[0] as { mode: string }).mode); queue.push(() => { if (!glass.isDestroyed()) send(channel, ...args); }); }
      else send(channel, ...args);
    };
  });
  await glass.evaluate(() => {
    Object.assign(window, { panelDeliveredModes: [] as string[] });
    (window as unknown as { rcDesktop: { pet: { onState(listener: (state: { mode: string }) => void): unknown } } }).rcDesktop.pet.onState(state => { (window as unknown as { panelDeliveredModes: string[] }).panelDeliveredModes.push(state.mode); });
  });
  const toggle = () => sprite.evaluate(() => (window as unknown as { rcDesktop: { pet: { action(value: unknown): Promise<unknown> } } }).rcDesktop.pet.action({ type: 'toggleTray' }));
  // Reproduce the old acceptance fixture: main has opened, glass DOM is stale,
  // and a second toggle closes main again. This is the captured controls state.
  await toggle(); expect(await glass.locator('.panel').count()).toBe(0); await toggle();
  await app.evaluate(() => (globalThis as unknown as { panelReplay: { flush(): void } }).panelReplay.flush());
  await expect.poll(() => glass.evaluate(() => (window as unknown as { panelDeliveredModes: string[] }).panelDeliveredModes.at(-1))).toBe('controls');
  await expect(glass.locator('.panel')).toHaveCount(0);
  const oldModes = await app.evaluate(() => (globalThis as unknown as { panelReplay: { modes: string[] } }).panelReplay.modes);
  expect(oldModes).toContain('panel'); expect(oldModes.at(-1)).toBe('controls');
  // Same delayed renderer, corrected helper: exactly one open, then wait.
  await app.evaluate(() => { (globalThis as unknown as { panelReplay: { hold: boolean } }).panelReplay.hold = true; });
  const opened = openPetPanel(app);
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { panelReplay: { queue: unknown[] } }).panelReplay.queue.length)).toBeGreaterThan(0);
  expect(await glass.locator('.panel').count()).toBe(0);
  await app.evaluate(() => (globalThis as unknown as { panelReplay: { flush(): void } }).panelReplay.flush());
  await opened; await glass.waitForTimeout(200); await expect(glass.locator('.panel')).toBeVisible();
  writeFileSync(join(evidence, 'panel-delayed-render-regression.json'), JSON.stringify({ oldModes, corrected: 'one toggle then await glass panel', visible: true }));
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
  await settings({ petId: clipPackId(), petEdgeHide: false, petSize: 'L' }); await baseline(); await sync([item()]);
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
    for (let i = 0; i < 100; i++) { result.push({ face: hash('#talk'), body: hash('#clip'), restBody: hash('#talk', true), visible: document.querySelector<HTMLElement>('#talk')!.style.display !== 'none' && document.querySelector('#character')!.classList.contains('talking'), level: document.querySelector<HTMLElement>('#talk')!.dataset.level }); await new Promise(resolve => setTimeout(resolve, 35)); }
    return result;
  });
  const backing = await sprite.locator('#talk').evaluate(c => ({ width: (c as HTMLCanvasElement).width, height: (c as HTMLCanvasElement).height, cssWidth: document.querySelector('#character')!.clientWidth, cssHeight: document.querySelector('#character')!.clientHeight, dpr: devicePixelRatio }));
  expect(backing.width).toBe(Math.round(backing.cssWidth * backing.dpr)); expect(backing.height).toBe(Math.round(backing.cssHeight * backing.dpr));
  writeFileSync(join(evidence, 'speech-samples.json'), JSON.stringify(samples));
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

test('compact surfaces: four 28px rows keep metadata adjacent and open the remaining activities', async () => {
  await baseline(); await settings({ petEdgeHide: false });
  const items = Array.from({ length: 6 }, (_, i) => item({ key: `mac:compact-${i}`, threadId: `compact-${i}`, title: `A deliberately long conversation title with a meaningful ending ${i}`, deviceName: 'Studio' }));
  await sync(items);
  const sprite = await pet('sprite'), glass = await pet('glass');
  await sprite.evaluate(() => (window as unknown as { rcDesktop: { pet: { action(value: unknown): Promise<unknown> } } }).rcDesktop.pet.action({ type: 'click' }));
  await expect(glass.locator('.running-row')).toHaveCount(4);
  await expect(glass.locator('.running-more')).toHaveText('2 more');
  const measured = await glass.evaluate(() => {
    const rect = (s: string) => document.querySelector(s)!.getBoundingClientRect().toJSON();
    return { root: rect('#app'), row: rect('.running-row'), title: rect('.running-title'), device: rect('.running-device'), more: rect('.running-more'), control: rect('.controls button'), status: rect('.running-row .pockymoe-status-mark') };
  });
  expect(measured.root.width).toBeLessThanOrEqual(280); expect(measured.row.height).toBe(28); expect(measured.more.height).toBe(22); expect(measured.control.height).toBe(28); expect(measured.status.width).toBe(10);
  expect(measured.device.x - measured.title.right).toBeLessThanOrEqual(6.5);
  await glass.locator('.running-more').click();
  await expect(glass.locator('.task-row')).toHaveCount(6);
});

test('compact surfaces: a three-line bubble reveals full text on existing keyboard focus without moving the pet', async () => {
  await baseline(); await settings({ petEdgeHide: false });
  const summary = '确认桌面更新后的状态同步、键盘导航和窗口焦点，保留现有未发送的草稿与工作记录。'.repeat(3);
  await sync([item()]);
  await sync([item({ state: 'needsInput', request: { id: 'compact-summary', kind: 'approval', summary } })]);
  const glass = await pet('glass');
  await expect(glass.locator('.request-summary')).toBeVisible();
  const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('pet/index.html') && !w.getParentWindow())!.getBounds());
  const clipped = await glass.locator('.request-summary').evaluate(e => ({ height: e.clientHeight, full: e.scrollHeight }));
  expect(clipped.height).toBeLessThanOrEqual(34); expect(clipped.full).toBeGreaterThan(clipped.height);
  await glass.locator('.bubble-title').focus();
  await expect(glass.getByRole('tooltip')).toHaveText(summary.trim());
  await expect(glass.locator('.bubble-title')).toBeFocused();
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('pet/index.html') && !w.getParentWindow())!.getBounds())).toEqual(before);
});

test('compact surfaces: Windows pet tint model keeps text above 4.5 on white and black', async () => {
  await finish(); const glass = await pet('glass');
  await glass.evaluate(() => { document.documentElement.dataset.platform = 'win32'; });
  await glass.mouse.move(500, 500);
  const results: { pack: string; effective: string; tint: number; minContrast: number }[] = [];
  for (const pack of ['classic', 'plum-pocket', 'terminal']) for (const effective of ['light', 'dark'] as const) {
    await app.evaluate((_e, value) => globalThis.__pockymoeDesktopTest.appearance.sync(value), { pack, effective, accent: '#ad782e' });
    for (const tint of [85, 95, 100]) {
      await glass.evaluate(solid => { document.documentElement.dataset.glassFallback = String(solid); }, tint === 100);
      if (tint === 95) await glass.locator('.glass').hover(); else await glass.mouse.move(500, 500);
      await expect.poll(() => glass.locator('.glass').evaluate((element, expectedTint) => {
        const c = document.createElement('canvas').getContext('2d')!;
        c.fillStyle = getComputedStyle(element).backgroundColor; c.fillRect(0, 0, 1, 1);
        return Math.abs(c.getImageData(0, 0, 1, 1).data[3]! - expectedTint / 100 * 255);
      }, tint)).toBeLessThanOrEqual(1);
      const minContrast = await glass.evaluate(() => {
        const surface = document.querySelector<HTMLElement>('.glass')!;
        const style = getComputedStyle(surface), canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const c = canvas.getContext('2d')!;
        const rgb = (color: string, backdrop: string) => { c.clearRect(0, 0, 1, 1); c.fillStyle = backdrop; c.fillRect(0, 0, 1, 1); c.fillStyle = color; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); };
        const lum = (rgb: number[]) => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i]!, 0);
        let min = Infinity;
        for (const backdrop of ['#fff', '#000']) {
          const bg = lum(rgb(style.backgroundColor, backdrop));
          for (const color of [style.color, getComputedStyle(document.querySelector('.bubble-device')!).color]) { const fg = lum(rgb(color, backdrop)); min = Math.min(min, (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05)); }
        }
        return min;
      });
      const alpha = await glass.locator('.glass').evaluate(e => { const c = document.createElement('canvas').getContext('2d')!; c.fillStyle = getComputedStyle(e).backgroundColor; c.fillRect(0, 0, 1, 1); return c.getImageData(0, 0, 1, 1).data[3]!; });
      expect(Math.abs(alpha - tint / 100 * 255)).toBeLessThanOrEqual(1);
      results.push({ pack, effective, tint, minContrast }); expect(minContrast).toBeGreaterThanOrEqual(4.5);
    }
  }
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(evidence, 'pet-tint-contrast-model.json'), JSON.stringify({ kind: 'CSS sRGB alpha model; native Acrylic unverified', results }, null, 2));
});

test('compact surfaces: native Windows CI acrylic contrast when desktop capture is available', async () => {
  test.skip(process.platform !== 'win32' || !process.env.CI, 'Native Acrylic requires an interactive Windows CI desktop');
  test.setTimeout(60_000);
  await finish(); await movePetUnderPointer();
  const glass = await pet('glass'); await expect(glass.locator('.bubble')).toBeVisible();
  const backdropId = await app.evaluate(async ({ BrowserWindow }) => {
    const glass = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('pet/index.html') && !!w.getParentWindow())!;
    const b = glass.getBounds(), w = new BrowserWindow({ x: b.x - 24, y: b.y - 24, width: b.width + 48, height: b.height + 48, frame: false, backgroundColor: '#fff' });
    await w.loadURL('data:text/html,<body style="margin:0;background:white">'); w.show(); glass.showInactive(); return w.id;
  });
  const { writeFile } = await import('node:fs/promises');
  const measurements: { pack: string; effective: string; backdrop: string; contrast: number; nativeBackground: number[]; clearBackdrop: number[] }[] = [];
  let unavailable = '';
  try {
    for (const pack of ['classic', 'plum-pocket', 'terminal']) for (const effective of ['light', 'dark'] as const) for (const backdrop of ['white', 'black']) {
      await app.evaluate((_e, value) => globalThis.__pockymoeDesktopTest.appearance.sync(value), { pack, effective, accent: '#ad782e' });
      await app.evaluate(async ({ BrowserWindow }, value) => {
        const w = BrowserWindow.fromId(value.id)!;
        const glass = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('pet/index.html') && !!w.getParentWindow())!;
        const b = glass.getBounds(); w.setBounds({ x: b.x - 24, y: b.y - 24, width: b.width + 48, height: b.height + 48 });
        await w.webContents.executeJavaScript(`document.body.style.background=${JSON.stringify(value.backdrop)}`); w.show(); glass.showInactive();
      }, { id: backdropId, backdrop });
      // DWM material recomposition follows the page paint, rather than its IPC acknowledgement.
      await glass.waitForTimeout(250);
      const native = await app.evaluate(async ({ BrowserWindow, screen, desktopCapturer }) => {
        const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('pet/index.html') && !!w.getParentWindow())!, bounds = w.getBounds(), display = screen.getDisplayMatching(bounds);
        try {
          const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.bounds.width * display.scaleFactor), height: Math.round(display.bounds.height * display.scaleFactor) } });
          const source = sources.find(s => s.display_id === String(display.id));
          return { bounds, display: display.bounds, image: source && !source.thumbnail.isEmpty() ? source.thumbnail.toPNG().toString('base64') : null };
        } catch { return { bounds, display: display.bounds, image: null }; }
      });
      if (!native.image) { unavailable = 'Desktop capture unavailable'; break; }
      const image = PNG.sync.read(Buffer.from(native.image, 'base64')), sx = image.width / native.display.width, sy = image.height / native.display.height;
      const pixel = (x: number, y: number): number[] => {
        const px = Math.round((x - native.display.x) * sx), py = Math.round((y - native.display.y) * sy);
        if (px < 0 || py < 0 || px >= image.width || py >= image.height) return [];
        return [...image.data.subarray((py * image.width + px) * 4, (py * image.width + px) * 4 + 3)];
      };
      const clear = pixel(native.bounds.x - 20, native.bounds.y + 14), expected = backdrop === 'white' ? 255 : 0;
      if (clear.length !== 3 || clear.some(v => Math.abs(v - expected) > 4)) { unavailable = 'Captured desktop does not show the controlled backdrop'; break; }
      const colors = await glass.evaluate(() => {
        const c = document.createElement('canvas').getContext('2d')!;
        return [getComputedStyle(document.querySelector('.glass')!).color, getComputedStyle(document.querySelector('.bubble-device')!).color].map(color => { c.clearRect(0, 0, 1, 1); c.fillStyle = color; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); });
      });
      const luminance = (rgb: number[]) => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i]!, 0);
      const nativeBackground = pixel(native.bounds.x + 5, native.bounds.y + 14);
      if (nativeBackground.length !== 3) { unavailable = 'Native coordinates do not map inside the captured display'; break; }
      const bg = luminance(nativeBackground);
      const contrast = Math.min(...colors.map(color => { const fg = luminance(color); return (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05); }));
      measurements.push({ pack, effective, backdrop, contrast, nativeBackground, clearBackdrop: clear });
      const left = Math.max(0, Math.floor((native.bounds.x - native.display.x) * sx)), top = Math.max(0, Math.floor((native.bounds.y - native.display.y) * sy));
      if (left >= image.width || top >= image.height) { unavailable = 'Native crop lies outside the captured display'; break; }
      const crop = new PNG({ width: Math.min(image.width - left, Math.ceil(native.bounds.width * sx)), height: Math.min(image.height - top, Math.ceil(native.bounds.height * sy)) });
      PNG.bitblt(image, crop, left, top, crop.width, crop.height, 0, 0);
      await writeFile(join(evidence, `pet-native-acrylic-${pack}-${effective}-${backdrop}.png`), PNG.sync.write(crop));
      expect(contrast).toBeGreaterThanOrEqual(4.5);
    }
  } finally {
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), backdropId);
    await writeFile(join(evidence, 'pet-native-acrylic-contrast.json'), JSON.stringify({ kind: 'Native Windows composited desktop background, CSS foreground colors', status: unavailable || measurements.length !== 12 ? 'unverified' : 'measured', reason: unavailable, measurements }, null, 2));
  }
  test.skip(!!unavailable, unavailable);
});

test('review: compact statuses retain the running ring and waiting bubble at 10px', async () => {
  await baseline(); await settings({ petEdgeHide: false }); await sync([item()]);
  const sprite = await pet('sprite'), glass = await pet('glass');
  const act = (value: unknown) => sprite.evaluate(value => (window as unknown as { rcDesktop: { pet: { action(value: unknown): Promise<unknown> } } }).rcDesktop.pet.action(value), value);
  await act({ type: 'click' });
  const running = glass.locator('.running-row .pockymoe-status-mark[data-status="running"]');
  await expect(running).toHaveCSS('width', '10px'); await expect(running.locator('circle')).toHaveCount(2); await expect(running.locator('.status-mark-orbit')).toHaveCount(1);
  await act({ type: 'close' });
  await sync([item({ state: 'needsInput', request: { id: 'review-mark', kind: 'approval', summary: 'Review the result' } })]);
  const waiting = glass.locator('.bubble-line .pockymoe-status-mark[data-status="waiting"]');
  await expect(waiting).toHaveCSS('width', '10px'); await expect(waiting.locator('path')).toHaveCount(1); await expect(waiting.locator('circle')).toHaveCount(0);
  await expect(waiting).toHaveAttribute('aria-label', 'Waiting for you');
});

test('clips: slender side peeks crop the body and hit only the visible head', async () => {
  test.skip(!clipPack, 'POCKYMOE_CLIP_PACK is not set');
  const manifest = JSON.parse(readFileSync(join(clipPack!, 'pet.json'), 'utf8')) as { remoteCodex?: { faceBox?: number[]; peek?: unknown } };
  const face = manifest.remoteCodex?.faceBox;
  test.skip(!face || face[3]! - face[1]! >= .28, 'Requires a slender pack face box');
  await settings({ petId: clipPackId(), petEdgeHide: true }); await baseline();
  const sprite = await pet('sprite');
  await expect(sprite.locator('#character')).toHaveClass(/clips/);
  await app.evaluate(({ BrowserWindow, screen }) => {
    screen.getCursorScreenPoint = () => ({ x: -10000, y: -10000 });
    const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('pet/index.html') && !w.getParentWindow())!;
    const original = w.setIgnoreMouseEvents.bind(w);
    Object.assign(globalThis, { reviewIgnored: true });
    w.setIgnoreMouseEvents = (value, options) => { Object.assign(globalThis, { reviewIgnored: value }); original(value, options); };
  });
  const ignored = () => app.evaluate(() => (globalThis as unknown as { reviewIgnored: boolean }).reviewIgnored);
  const act = (value: unknown) => sprite.evaluate(value => (window as unknown as { rcDesktop: { pet: { action(value: unknown): Promise<unknown> } } }).rcDesktop.pet.action(value), value);
  for (const edge of ['left', 'right'] as const) {
    const { bounds, area } = await app.evaluate(({ BrowserWindow, screen }) => ({ bounds: BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('pet/index.html') && !w.getParentWindow())!.getBounds(), area: screen.getPrimaryDisplay().workArea }));
    // Stay inside this display: overshooting can legitimately select a neighboring monitor.
    const x = edge === 'left' ? area.x : area.x + area.width - bounds.width, y = area.y + 120;
    await act({ type: 'dragStart', x: bounds.x, y: bounds.y }); await act({ type: 'dragMove', x, y }); await act({ type: 'dragEnd', x, y });
    await expect(sprite.locator('#app')).toHaveAttribute('data-edge', edge); await expect(sprite.locator('#app')).toHaveAttribute('data-dock-amount', '1');
    // Wait for the existing slide to settle before measuring painted pixels.
    await sprite.waitForTimeout(250);
    const transform = await sprite.locator('#character').evaluate(e => new DOMMatrix(getComputedStyle(e).transform).b);
    if (manifest.remoteCodex?.peek) expect(transform).toBe(0);
    else expect(edge === 'left' ? transform : -transform).toBeGreaterThan(.2);
    const png = PNG.sync.read(await sprite.screenshot({ omitBackground: true, scale: 'css' }));
    const opaque: { x: number; y: number }[] = []; let belowHead = 0;
    for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) if (png.data[(y * png.width + x) * 4 + 3]! > 200) { opaque.push({ x, y }); if (y > png.height / 2) belowHead++; }
    expect(opaque.length).toBeGreaterThan(30);
    if (manifest.remoteCodex?.peek) {
      // Long hair is intentionally below the face. It must end naturally inside
      // the fixed viewport, not disappear into its bottom edge.
      expect(Math.max(...opaque.map(p => p.y))).toBeLessThan(png.height - 4);
      expect(Math.min(...opaque.map(p => p.y))).toBeGreaterThan(0);
    } else expect(belowHead).toBe(0);
    const head = opaque[Math.floor(opaque.length / 2)]!;
    await sprite.mouse.move(head.x + .5, head.y + .5); await expect.poll(ignored).toBe(false);
    await sprite.mouse.move(5, png.height * .75); await expect.poll(ignored).toBe(true);
    if (edge === 'right') {
      await sprite.mouse.click(head.x + .5, head.y + .5);
      await expect(sprite.locator('#app')).toHaveAttribute('data-mood', 'poked');
    }
  }
});


test('clips: top and bottom hold a real rest frame at full backing resolution', async () => {
  test.skip(!clipPack, 'POCKYMOE_CLIP_PACK is not set');
  const manifest = JSON.parse(readFileSync(join(clipPack!, 'pet.json'), 'utf8')) as { remoteCodex: { clips: { idle: { path: string; role?: string }[] } } };
  const rest = manifest.remoteCodex.clips.idle.find(c => !c.role)!.path;
  await settings({ petId: clipPackId(), petEdgeHide: true, petSize: 'L' }); await baseline();
  const sprite = await pet('sprite'); await expect(sprite.locator('#character')).toHaveClass(/clips/);
  await app.evaluate(({ screen }) => { screen.getCursorScreenPoint = () => ({ x: -10000, y: -10000 }); });
  await sprite.evaluate(() => {
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    Object.assign(window, { dockClipDraws: [] as string[] });
    const wrapped = function (this: CanvasRenderingContext2D, ...args: unknown[]): void {
      if (this.canvas.id === 'clip') (window as unknown as { dockClipDraws: string[] }).dockClipDraws.push(args[0] instanceof VideoFrame ? 'video-frame' : args[0] instanceof ImageBitmap ? 'bitmap-frame' : 'other');
      Reflect.apply(draw, this, args);
    };
    CanvasRenderingContext2D.prototype.drawImage = wrapped as typeof draw;
  });
  for (const edge of ['top', 'bottom'] as const) {
    const { bounds, area } = await app.evaluate(({ BrowserWindow, screen }) => ({ bounds: BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('pet/index.html') && !w.getParentWindow())!.getBounds(), area: screen.getPrimaryDisplay().workArea }));
    const x = area.x + Math.round(area.width / 2), y = edge === 'top' ? area.y : area.y + area.height - bounds.height;
    const action = (value: unknown) => sprite.evaluate(value => (window as unknown as { rcDesktop: { pet: { action(value: unknown): Promise<unknown> } } }).rcDesktop.pet.action(value), value);
    await action({ type: 'dragStart', x: bounds.x, y: bounds.y }); await action({ type: 'dragMove', x, y }); await action({ type: 'dragEnd', x, y });
    await expect(sprite.locator('#app')).toHaveAttribute('data-edge', edge); await expect(sprite.locator('#app')).toHaveAttribute('data-dock-amount', '1');
    await expect(sprite.locator('#clip')).toHaveAttribute('data-clip-path', rest);
    await expect(sprite.locator('#clip')).toHaveAttribute('data-media-frame', '0');
    const canvas = await sprite.locator('#clip').evaluate(c => ({ backing: [(c as HTMLCanvasElement).width, (c as HTMLCanvasElement).height], expected: [Math.round(c.clientWidth * devicePixelRatio), Math.round(c.clientHeight * devicePixelRatio)], visibility: getComputedStyle(c).visibility, atlas: getComputedStyle(document.querySelector('#sprite')!).display, draws: (window as unknown as { dockClipDraws: string[] }).dockClipDraws }));
    expect(canvas.backing).toEqual(canvas.expected); expect(canvas.visibility).toBe('visible'); expect(canvas.atlas).toBe('none');
    expect(canvas.draws.some(kind => kind === 'video-frame' || kind === 'bitmap-frame')).toBe(true);
    // A held frame must resize too; no animation tick will choose another index.
    for (const petSize of ['M', 'L'] as const) {
      await settings({ petSize });
      await expect.poll(() => sprite.locator('#clip').evaluate(c => (c as HTMLCanvasElement).width === Math.round(c.clientWidth * devicePixelRatio) && (c as HTMLCanvasElement).height === Math.round(c.clientHeight * devicePixelRatio))).toBe(true);
      await expect(sprite.locator('#clip')).toHaveAttribute('data-media-frame', '0');
    }
  }
});

test('clips: dedicated peek handoff fades out before fading in in both directions', async () => {
  test.skip(!clipPack, 'POCKYMOE_CLIP_PACK is not set');
  test.skip(!JSON.parse(readFileSync(join(clipPack!, 'pet.json'), 'utf8')).remoteCodex?.peek, 'Pack has no dedicated peek');
  await settings({ petId: clipPackId(), petEdgeHide: false }); await baseline();
  const sprite = await pet('sprite'); await expect(sprite.locator('#character')).toHaveClass(/clips/);
  await app.evaluate(({ screen }) => { screen.getCursorScreenPoint = () => ({ x: -10000, y: -10000 }); });
  const { bounds, area } = await app.evaluate(({ BrowserWindow, screen }) => ({ bounds: BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('pet/index.html') && !w.getParentWindow())!.getBounds(), area: screen.getPrimaryDisplay().workArea }));
  const action = (value: unknown) => sprite.evaluate(value => (window as unknown as { rcDesktop: { pet: { action(value: unknown): Promise<unknown> } } }).rcDesktop.pet.action(value), value);
  const x = area.x + area.width - bounds.width, y = area.y + 120;
  await action({ type: 'dragStart', x: bounds.x, y: bounds.y }); await action({ type: 'dragMove', x, y }); await action({ type: 'dragEnd', x, y });
  for (const tucked of [true, false]) {
    const samples = await sprite.evaluate(async tucked => {
      const result: { body: number; peek: number }[] = [];
      await (window as unknown as { rcDesktop: { pet: { action(value: unknown): Promise<unknown> } } }).rcDesktop.pet.action({ type: 'setEdgeHide', value: tucked });
      while (document.querySelector('#character')!.classList.contains('art-tucked') !== tucked) await new Promise<void>(r => requestAnimationFrame(() => r()));
      const start = performance.now(); while (performance.now() - start < 500) { result.push({ body: Number(getComputedStyle(document.querySelector('#clip')!).opacity), peek: Number(getComputedStyle(document.querySelector('#peek-art')!).opacity) }); await new Promise<void>(r => requestAnimationFrame(() => r())); }
      return result;
    }, tucked);
    expect(samples.some(s => s.body > .01 && s.peek > .01)).toBe(false);
    expect(samples.at(-1)).toEqual({ body: tucked ? 0 : 1, peek: tucked ? 1 : 0 });
    expect(samples.some(s => s.body > 0 && s.body < 1 || s.peek > 0 && s.peek < 1)).toBe(true);
  }
});
