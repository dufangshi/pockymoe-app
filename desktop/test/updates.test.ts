import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, isNewerVersion, parseVersion, signedUpdate, UpdateService, type SignedUpdate, type UpdateDependencies } from '../src/main/updateCore';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const key = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const bytes = Buffer.from('a verified installer fixture');
let directory: string;
let services: UpdateService[];
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'pockymoe-update-unit-')); services = []; });
afterEach(async () => { services.forEach(service => service.dispose()); await Promise.all(services.map(service => service.settled())); await rm(directory, { recursive: true, force: true }); });
function entry(patch: Partial<SignedUpdate> = {}): SignedUpdate {
  const value = { version: '0.3.0', platform: 'win32-x64', fileName: 'Pockymoe-0.3.0-win-x64.exe', sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, signature: '', ...patch };
  value.signature = sign(null, Buffer.from(canonical(value)), privateKey).toString('base64'); return value;
}
const body = (e = entry()) => `<!-- pockymoe-updates-v1\n${JSON.stringify([e])}\n-->`;
function release(e = entry(), patch = {}) { return { tag_name: 'v0.3.0', prerelease: false, draft: false, body: body(e), assets: [{ name: e.fileName, size: e.size, browser_download_url: `https://github.com/dufangshi/pockymoe-app/releases/download/v0.3.0/${e.fileName}` }], ...patch }; }
function service(options: Partial<UpdateDependencies> = {}) {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(release()), { headers: { etag: 'fixture' } })).mockImplementation(async () => new Response(bytes));
  const install = vi.fn().mockResolvedValue(undefined);
  const result = new UpdateService({ version: '0.2.0', platform: 'win32-x64', directory, publicKey: key, feed: 'https://api.github.com/repos/dufangshi/pockymoe-app/releases/latest', fetch, install, allowed: () => true, openExternal: vi.fn(), ...options });
  services.push(result); return { updates: result, fetch, install };
}
it('compares numeric versions; rejects prereleases and malformed tags', () => {
  expect(isNewerVersion('v0.2.10', '0.2.9')).toBe(true); expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true);
  expect(isNewerVersion('0.2.0', '0.2.0')).toBe(false); expect(isNewerVersion('0.1.9', '0.2.0')).toBe(false);
  for (const tag of ['1.0.0-rc.1', '1.0.0+build', '01.2.3', '1.2', 'bad', 'v1.2.3/extra']) expect(parseVersion(tag)).toBeNull();
});
it('authenticates exact version, platform, filename, size and hash', () => {
  expect(signedUpdate(body(), '0.3.0', 'win32-x64', key)).toEqual(entry());
  for (const patch of [{ version: '0.4.0' }, { platform: 'darwin-arm64' }, { fileName: '../bad.exe' }, { size: -1 }, { sha256: 'bad' }]) expect(signedUpdate(body(entry(patch)), '0.3.0', 'win32-x64', key)).toBeNull();
  const wrongKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
  expect(signedUpdate(body(), '0.3.0', 'win32-x64', wrongKey)).toBeNull();
  expect(signedUpdate(body().replace('0.3.0', '0.4.0'), '0.4.0', 'win32-x64', key)).toBeNull();
});
it('reveals ready only after verified download and rechecks file before install', async () => {
  const { updates, install } = service(); const states: string[] = []; updates.onChange(state => states.push(state.status));
  expect(await updates.check()).toBe('downloading'); await updates.settled(); expect(states).toEqual(['downloading', 'ready']);
  expect(await readFile(join(directory, entry().fileName))).toEqual(bytes); await updates.install(); expect(install).toHaveBeenCalledOnce();
});
it('does not execute a tampered cached installer', async () => {
  const { updates, install } = service(); await updates.check(); await updates.settled(); await writeFile(join(directory, entry().fileName), Buffer.alloc(bytes.length));
  await updates.install(); expect(install).not.toHaveBeenCalled(); expect(updates.state().status).toBe('error');
});
it.each(['rateLimit', 'requestFailure', 'prerelease', 'rollback'])('keeps %s silent', async kind => {
  const fetch = vi.fn();
  if (kind === 'rateLimit') fetch.mockResolvedValue(new Response(null, { status: 403 }));
  else if (kind === 'requestFailure') fetch.mockRejectedValue(new Error('offline'));
  else fetch.mockResolvedValue(new Response(JSON.stringify(release(entry(), kind === 'prerelease' ? { prerelease: true } : { tag_name: 'v0.1.0' }))));
  const { updates, install } = service({ fetch }); await updates.check(); await updates.settled(); expect(updates.state()).toEqual({ status: 'idle' }); expect(install).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce();
});
it.each(['tampered', 'truncated', 'interrupted'])('rejects %s downloads', async kind => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(release())));
  if (kind === 'interrupted') fetch.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 3)); controller.error(new Error('disconnect')); } })));
  else fetch.mockResolvedValueOnce(new Response(kind === 'tampered' ? Buffer.alloc(bytes.length) : bytes.subarray(0, 3)));
  const { updates, install } = service({ fetch }); await updates.check(); await updates.settled(); expect(updates.state().status).toBe('idle'); await updates.install(); expect(install).not.toHaveBeenCalled(); await expect(readFile(join(directory, entry().fileName))).rejects.toThrow();
});
it('uses ETag, handles 304 and never downgrades a ready update', async () => {
  const { updates, fetch } = service(); await updates.check(); await updates.settled(); fetch.mockResolvedValueOnce(new Response(null, { status: 304 })); expect(await updates.check()).toBe('ready');
  expect(fetch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ headers: expect.objectContaining({ 'If-None-Match': 'fixture' }) }));
  fetch.mockResolvedValueOnce(new Response(JSON.stringify(release(entry(), { tag_name: 'v0.2.9' })))); expect(await updates.check()).toBe('ready'); expect(updates.state().version).toBe('0.3.0');
});
it('offers manual download only for missing/bad release signatures', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(release(entry(), { body: '' })))); const { updates } = service({ fetch }); expect(await updates.check()).toBe('manual'); expect(updates.state()).toMatchObject({ status: 'idle', version: '0.3.0' }); expect(fetch).toHaveBeenCalledOnce();
});
it('respects setup gating and cleans old downloads after success', async () => {
  const blocked = service({ allowed: () => false }); await blocked.updates.check(); expect(blocked.fetch).not.toHaveBeenCalled();
  await writeFile(join(directory, 'old.part'), 'old'); const { updates } = service(); await updates.check(); await updates.settled(); await expect(readFile(join(directory, 'old.part'))).rejects.toThrow();
});
