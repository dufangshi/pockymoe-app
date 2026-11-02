import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
let server: Server, origin: string, app: ElectronApplication, profile: string, page: Page;
let llm: { body: string; auth: string | null }[] = [], speech: string[] = [], llmFails = false;
function wav(): Buffer {
  const n = 480, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
const FIXTURE = `<!doctype html><meta charset="utf-8"><title>Fixture</title><script>window.commands=[];window.pockymoeHost?.onCommand(command=>{window.commands.push(command);
  const data=command.type==='turnText'?{request:'修一下登录白屏',answer:'白屏已修好，原因是回调读取了未加载的用户信息。'}:command.type==='listConnections'?[{deviceId:'mac',deviceName:'MacBook',id:'c1',name:'Main',protocol:'openai_chat',model:'small'}]:command.type==='completeWithConnection'?{text:'连接总结：白屏修好了。'}:undefined;
  window.pockymoeHost.commandResult(command.id,{ok:true,...(data?{data}:{})});});</script>`;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end(FIXTURE); return; }
      if (req.url === '/v1/chat/completions') {
        llm.push({ body, auth: req.headers.authorization ?? null }); res.setHeader('content-type', 'application/json');
        if (llmFails) { res.statusCode = 500; res.end(JSON.stringify({ error: { message: 'upstream down' } })); return; }
        res.end(JSON.stringify({ choices: [{ message: { content: '**白屏修好了**，部署前端就能生效。' } }] })); return;
      }
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
  llm = []; speech = []; llmFails = false; profile = mkdtempSync(join(tmpdir(), 'pockymoe-pet-work-'));
  if (clipPack && test.info().title.startsWith('clips')) { mkdirSync(join(profile, 'pets')); cpSync(clipPack, join(profile, 'pets', 'bailong'), { recursive: true }); }
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME']) if (process.env[key]) env[key] = process.env[key]!;
  Object.assign(env, { POCKYMOE_DESKTOP_E2E: '1', POCKYMOE_DESKTOP_USER_DATA: profile, POCKYMOE_DESKTOP_WEB_ORIGIN: origin, POCKYMOE_DESKTOP_RELAY_ORIGIN: origin });
  const packaged = process.env.POCKYMOE_DESKTOP_APP;
  app = await electron.launch({ ...(packaged ? { executablePath: packaged, args: [] } : { args: [resolve('.')] }), env });
  await expect.poll(() => app.evaluate(() => '__pockymoeDesktopTest' in globalThis)).toBe(true);
  await expect.poll(() => app.windows().filter(window => window.url().includes('pet/index.html')).length, { timeout: 20_000 }).toBe(2);
  await expect.poll(() => app.windows().some(window => window.url().startsWith(origin))).toBe(true);
  page = app.windows().find(window => window.url().startsWith(origin))!;
  await page.waitForLoadState('domcontentloaded');
  await expect.poll(() => page.evaluate(() => !!window.pockymoeHost)).toBe(true);
});
test.afterEach(async () => { await app?.close(); rmSync(profile, { recursive: true, force: true }); });
const pet = async (surface: 'sprite' | 'glass'): Promise<Page> => {
  for (const window of app.windows().filter(candidate => candidate.url().includes('pet/index.html'))) if (await window.evaluate(() => document.body.dataset.surface) === surface) return window;
  throw new Error(`No ${surface} window`);
};
const settings = (patch: Partial<DesktopSettings>): Promise<void> => app.evaluate((_e, value) => (globalThis as unknown as { __pockymoeDesktopTest: Testing }).__pockymoeDesktopTest.settings.set(value), patch);
const sync = (items: ActivityItem[]): Promise<void> => page.evaluate(value => window.pockymoeHost!.activity.sync(value), snapshot(items));
const baseline = (): Promise<void> => page.evaluate(value => window.pockymoeHost!.activity.sync(value), snapshot([], { generatedAt: '2026-11-01T05:59:00.000Z', syncedDeviceIds: ['mac', 'pc'] }));
const finish = async (): Promise<void> => { await baseline(); await sync([item()]); await sync([item({ state: 'completed', unread: true })]); };
const movePetUnderPointer = (): Promise<void> => app.evaluate(({ BrowserWindow, screen }) => {
  const sprite = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('pet/index.html') && !window.getParentWindow())!;
  const point = screen.getCursorScreenPoint(), bounds = sprite.getBounds();
  sprite.setBounds({ ...bounds, x: point.x - Math.round(bounds.width / 2), y: point.y - Math.round(bounds.height / 2) });
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
  await glass.waitForTimeout(600);
  await glass.evaluate(() => { const w = window as unknown as { rewrites: number }; w.rewrites = 0; new MutationObserver(records => { w.rewrites += records.length; }).observe(document.querySelector('#app')!, { childList: true, subtree: true }); });
  const heights: number[] = [];
  for (let i = 0; i < 20; i++) { heights.push((await glassBounds()).y); await glass.waitForTimeout(100); }
  expect(await glass.evaluate(() => (window as unknown as { rewrites: number }).rewrites)).toBe(0);
  expect(new Set(heights).size).toBe(1);
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
  await expect.poll(async () => (await pet('sprite')).locator('#app').getAttribute('data-mood'), { timeout: 5000 }).toBe('running');
});
test('summary: reads what the model said about the turn, with a custom upstream', async () => {
  await settings({ petVoice: true, petVoiceProvider: 'compatible', petVoiceRemotes: { compatible: { url: `${origin}/v1`, model: 't', voice: '', style: '', extra: '' } }, petVoiceSummary: true, petSummaryCustom: { url: `${origin}/v1`, model: 'small' }, petSummaryLanguage: 'zh-CN' });
  await page.waitForTimeout(2700); // The sample from turning voice on is rate limited with alerts.
  speech = [];
  await finish();
  await expect.poll(() => speech).toEqual(['白屏修好了，部署前端就能生效。']);
  const request = JSON.parse(llm[0]!.body) as { model: string; messages: { content: string }[] };
  expect(request.model).toBe('small');
  expect(request.messages[0]!.content).toContain('Simplified Chinese');
  expect(request.messages[1]!.content).toContain('修一下登录白屏'); expect(request.messages[1]!.content).toContain('回调读取了未加载的用户信息');
  expect(await page.evaluate(() => (window.commands as { type: string }[]).some(command => command.type === 'turnText'))).toBe(true);
});
test('summary: falls back to saying it finished when the upstream fails, and shows why', async () => {
  await settings({ petVoice: true, petVoiceProvider: 'compatible', petVoiceRemotes: { compatible: { url: `${origin}/v1`, model: 't', voice: '', style: '', extra: '' } }, petVoiceSummary: true, petSummaryCustom: { url: `${origin}/v1`, model: 'small' } });
  await page.waitForTimeout(2700);
  speech = []; llmFails = true;
  await finish();
  await expect.poll(() => speech).toEqual(['修复登录状态同步 finished']);
  await app.evaluate(() => (globalThis as unknown as { __pockymoeDesktopTest: Testing }).__pockymoeDesktopTest.windows.createLocal('preferences'));
  await expect.poll(() => app.windows().some(window => window.url().includes('preferences'))).toBe(true);
  const preferences = app.windows().find(window => window.url().includes('preferences'))!;
  await preferences.locator('[data-section="pet"]').click();
  await expect(preferences.locator('#summary-result')).toContainText('HTTP 500 · upstream down');
});
test('summary: a saved upstream runs on its device and is listed in Preferences', async () => {
  await settings({ petVoice: true, petVoiceProvider: 'compatible', petVoiceRemotes: { compatible: { url: `${origin}/v1`, model: 't', voice: '', style: '', extra: '' } }, petVoiceSummary: true });
  await app.evaluate(() => (globalThis as unknown as { __pockymoeDesktopTest: Testing }).__pockymoeDesktopTest.windows.createLocal('preferences'));
  await expect.poll(() => app.windows().some(window => window.url().includes('preferences'))).toBe(true);
  const preferences = app.windows().find(window => window.url().includes('preferences'))!;
  await preferences.locator('[data-section="pet"]').click();
  await preferences.locator('#summary-source').click();
  await preferences.getByRole('option', { name: 'Main · MacBook' }).click();
  await expect(preferences.locator('#summary-model')).toBeVisible();
  await preferences.locator('#summary-source').scrollIntoViewIfNeeded();
  await preferences.screenshot({ path: join(evidence, 'summary-settings.png'), animations: 'disabled' });
  await page.waitForTimeout(2700);
  speech = [];
  await finish();
  await expect.poll(() => speech).toEqual(['连接总结：白屏修好了。']);
  expect(llm).toHaveLength(0);
  const command = await page.evaluate(() => (window.commands as { type: string }[]).find(entry => entry.type === 'completeWithConnection') as unknown as { deviceId: string; connectionId: string });
  expect(command).toMatchObject({ deviceId: 'mac', connectionId: 'c1' });
});
test('clips: a pack with clips plays them and survives a click', async () => {
  test.skip(!clipPack, 'POCKYMOE_CLIP_PACK is not set');
  test.setTimeout(60_000);
  await settings({ petId: 'bailong' });
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
