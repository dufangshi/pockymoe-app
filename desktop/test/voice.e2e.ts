import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MODEL } from '../src/main/voice/model';

const evidence = process.env.POCKYMOE_DESKTOP_EVIDENCE || join(tmpdir(), 'pockymoe-voice-evidence');
/** Point this at an unpacked model to also exercise real synthesis in the utility process. */
const realModel = process.env.POCKYMOE_VOICE_MODEL;
interface Seen { method: string; url: string; auth: string | null; body: string }
let server: Server, origin: string, app: ElectronApplication, profile: string, seen: Seen[] = [];
function wav(): Buffer {
  const n = 2400, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
}
test.beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Fixture</title>'); return; }
      seen.push({ method: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization ?? null, body });
      if (req.url === '/v1/audio/voices') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ voices: ['S0', 'S1'], uploaded_voices: [] })); return; }
      if (req.url === '/v1/audio/speech' && !body.includes('"model":"broken"')) { res.setHeader('content-type', 'audio/wav'); res.end(wav()); return; }
      res.statusCode = 400; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: { message: 'model not loaded' } }));
    });
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture port missing');
  origin = `http://127.0.0.1:${address.port}`; mkdirSync(evidence, { recursive: true });
});
test.afterAll(async () => { await new Promise<void>(done => server.close(() => done())); });
test.beforeEach(async () => {
  seen = []; profile = mkdtempSync(join(tmpdir(), 'pockymoe-voice-'));
  if (realModel && test.info().title.startsWith('local')) { mkdirSync(join(profile, 'voice')); symlinkSync(realModel, join(profile, 'voice', MODEL.name)); }
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME']) if (process.env[key]) env[key] = process.env[key]!;
  Object.assign(env, { POCKYMOE_DESKTOP_E2E: '1', POCKYMOE_DESKTOP_USER_DATA: profile, POCKYMOE_DESKTOP_WEB_ORIGIN: origin, POCKYMOE_DESKTOP_RELAY_ORIGIN: origin });
  // POCKYMOE_DESKTOP_APP checks a packaged build, whose addon lives in app.asar.unpacked.
  const packaged = process.env.POCKYMOE_DESKTOP_APP;
  app = await electron.launch({ ...(packaged ? { executablePath: packaged, args: [] } : { args: [resolve('.')] }), env });
});
test.afterEach(async () => { await app?.close(); rmSync(profile, { recursive: true, force: true }); });
async function preferences(): Promise<Page> {
  await expect.poll(() => app.evaluate(() => '__pockymoeDesktopTest' in globalThis)).toBe(true);
  await app.evaluate(() => (globalThis as unknown as { __pockymoeDesktopTest: { windows: { createLocal(view: string): void } } }).__pockymoeDesktopTest.windows.createLocal('preferences'));
  await expect.poll(() => app.windows().some(page => page.url().includes('local/index.html') && page.url().includes('preferences'))).toBe(true);
  const page = app.windows().find(page => page.url().includes('preferences'))!;
  await page.locator('[data-section="pet"]').click();
  await page.locator('#petVoiceProvider').scrollIntoViewIfNeeded();
  return page;
}
const choose = async (page: Page, id: string, name: string): Promise<void> => { await page.locator(`#${id}`).click(); await page.getByRole('option', { name, exact: true }).click(); };
const fill = async (page: Page, id: string, value: string): Promise<void> => { await page.locator(`#${id}`).fill(value); await page.locator(`#${id}`).blur(); };
const lastSpeech = async (): Promise<string[]> => Promise.all(app.windows().filter(page => page.url().includes('pet/index.html')).map(page => page.evaluate(() => (document.querySelector('[data-last-speech]') as HTMLElement | null)?.dataset.lastSpeech ?? '')));

test('remote service: fetches voices, previews, plays, and shows a server error', async () => {
  const page = await preferences();
  await choose(page, 'petVoiceProvider', 'OpenAI');
  await expect(page.locator('#voice-url')).toHaveValue('https://api.openai.com/v1');
  await choose(page, 'petVoiceProvider', 'OpenAI-compatible service');
  await page.locator('#voice-list').waitFor();
  await fill(page, 'voice-url', `${origin}/v1/`);
  await expect(page.locator('#voice-url')).toHaveValue(`${origin}/v1`);
  await fill(page, 'voice-model-name', 'BreezeBlue/Breeze-TTS-2');
  await fill(page, 'voice-style', 'warm voice');
  await page.locator('#voice-list').click();
  await page.locator('#voice-name-list').click();
  await page.getByRole('option', { name: 'S1' }).click();
  await expect(page.locator('#voice-name')).toHaveValue('S1');
  await expect(page.locator('.voice-note')).toContainText('sent to this service');
  await page.screenshot({ path: join(evidence, 'voice-remote.png'), animations: 'disabled' });
  await page.locator('#voice-preview').click();
  await expect.poll(lastSpeech).toContain(String(wav().length));
  const speech = seen.find(request => request.url === '/v1/audio/speech')!;
  expect(JSON.parse(speech.body)).toMatchObject({ model: 'BreezeBlue/Breeze-TTS-2', voice: 'S1', instructions: 'warm voice', response_format: 'wav' });
  expect(speech.auth).toBeNull();
  await fill(page, 'voice-model-name', 'broken');
  await page.locator('#voice-preview').click();
  await expect(page.locator('#voice-error')).toContainText('HTTP 400 · model not loaded');
});
test('remote service: the page can neither read nor change it', async () => {
  const page = await preferences();
  await choose(page, 'petVoiceProvider', 'OpenAI-compatible service');
  await fill(page, 'voice-url', `${origin}/v1`);
  const main = app.windows().find(candidate => candidate.url().startsWith(origin))!;
  const seenByPage = await main.evaluate(async () => JSON.stringify(await (window as unknown as { pockymoeHost: { settings: { get(): Promise<unknown> } } }).pockymoeHost.settings.get()));
  expect(seenByPage).not.toContain('voice-url'); expect(seenByPage).not.toContain('/v1'); expect(seenByPage).not.toContain('petVoiceProvider');
  const refused = await main.evaluate(async () => { try { await (window as unknown as { pockymoeHost: { settings: { set(patch: unknown): Promise<unknown> } } }).pockymoeHost.settings.set({ petVoiceProvider: 'openai' }); return false; } catch { return true; } });
  expect(refused).toBe(true);
});
test('local model: offers the download with its size before anything is fetched', async () => {
  test.skip(!!realModel);
  const page = await preferences();
  await expect(page.locator('#voice-model-status')).toContainText('147 MB');
  await expect(page.locator('#voice-preview')).toBeDisabled();
  expect(existsSync(join(profile, 'voice'))).toBe(false);
  for (const [pack, effective] of [['classic', 'light'], ['classic', 'dark'], ['plum-pocket', 'light'], ['plum-pocket', 'dark'], ['terminal', 'light'], ['terminal', 'dark']] as const) {
    await app.evaluate((_e, value) => (globalThis as unknown as { __pockymoeDesktopTest: { appearance: { sync(value: unknown): void } } }).__pockymoeDesktopTest.appearance.sync(value), { pack, effective, accent: pack === 'terminal' ? '#31bd84' : pack === 'plum-pocket' ? '#8f5a9e' : '#ad782e', locale: 'zh-CN' });
    await page.locator('#petVoiceProvider').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(evidence, `voice-local-${pack}-${effective}.png`), animations: 'disabled' });
  }
});
test('local model: synthesizes real speech in the utility process', async () => {
  test.skip(!realModel, 'POCKYMOE_VOICE_MODEL is not set');
  test.setTimeout(90_000);
  const page = await preferences();
  await expect(page.locator('#voice-model-status')).toContainText('Ready');
  await choose(page, 'petVoiceSpeaker', 'Chinese male · 009');
  await page.locator('#voice-preview').click();
  await expect(page.locator('#voice-preview')).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator('#voice-error')).toHaveText('');
  await expect.poll(async () => Math.max(0, ...(await lastSpeech()).map(Number)), { timeout: 10_000 }).toBeGreaterThan(24000);
});
test('local model: downloads, verifies and speaks from the real release', async () => {
  test.skip(!process.env.POCKYMOE_VOICE_DOWNLOAD, 'POCKYMOE_VOICE_DOWNLOAD is not set; this fetches 147 MB');
  test.setTimeout(600_000);
  const page = await preferences();
  await page.locator('#voice-model[data-command="download"]').click();
  await expect(page.locator('#voice-model-status')).toContainText('Ready', { timeout: 560_000 });
  expect(existsSync(join(profile, 'voice', `${MODEL.name}.tar.bz2.partial`))).toBe(false);
  await page.locator('#voice-preview').click();
  await expect.poll(async () => Math.max(0, ...(await lastSpeech()).map(Number)), { timeout: 30_000 }).toBeGreaterThan(24000);
});
