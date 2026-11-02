import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, UpdateService, type SignedUpdate } from '../src/main/updateCore';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const key = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const bytes = Buffer.from('persisted installer fixture');
let directory: string;
let services: UpdateService[];
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'pockymoe-update-restore-')); services = []; });
afterEach(async () => { services.forEach(service => service.dispose()); await Promise.all(services.map(service => service.settled())); await rm(directory, { recursive: true, force: true }); });
function entry(patch: Partial<SignedUpdate> = {}): SignedUpdate {
  const value = { version: '1.2.3', platform: 'win32-x64', fileName: 'Pockymoe-1.2.3-win-x64.exe', sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, signature: '', ...patch };
  value.signature = sign(null, Buffer.from(canonical(value)), privateKey).toString('base64');
  return value;
}
async function saved(value: SignedUpdate = entry()): Promise<void> {
  await writeFile(join(directory, '.ready.json'), JSON.stringify(value));
  await writeFile(join(directory, value.fileName), bytes);
}
function service() {
  const fetch = vi.fn().mockRejectedValue(new Error('not expected'));
  const install = vi.fn().mockResolvedValue(undefined);
  const updates = new UpdateService({ version: '1.2.2', platform: 'win32-x64', publicKey: key, directory, fetch, install, feed: 'https://fixture.invalid/latest', allowed: () => true, openExternal: vi.fn(), failureMessage: () => 'Fixture installation failed' });
  services.push(updates);
  return { updates, fetch, install };
}
it('restores readiness only after authenticating metadata and hashing the persisted installer', async () => {
  await saved();
  const { updates, fetch } = service(); await updates.settled();
  expect(updates.state()).toEqual({ status: 'ready', version: '1.2.3', releaseUrl: 'https://github.com/dufangshi/pockymoe-app/releases/tag/v1.2.3' });
  expect(fetch).not.toHaveBeenCalled();
});
it.each(['signature', 'platform', 'version', 'truncatedMetadata', 'tamperedFile', 'truncatedFile'])('ignores %s in persisted state without executing anything', async kind => {
  await saved();
  if (kind === 'signature') await writeFile(join(directory, '.ready.json'), JSON.stringify({ ...entry(), signature: Buffer.alloc(64).toString('base64') }));
  if (kind === 'platform') await writeFile(join(directory, '.ready.json'), JSON.stringify(entry({ platform: 'darwin-arm64' })));
  if (kind === 'version') await writeFile(join(directory, '.ready.json'), JSON.stringify(entry({ version: '1.2.1', fileName: 'Pockymoe-1.2.1-win-x64.exe' })));
  if (kind === 'truncatedMetadata') await writeFile(join(directory, '.ready.json'), '{');
  if (kind === 'tamperedFile') await writeFile(join(directory, entry().fileName), Buffer.alloc(bytes.length));
  if (kind === 'truncatedFile') await writeFile(join(directory, entry().fileName), bytes.subarray(0, 2));
  const { updates, install } = service(); await updates.settled(); await updates.install();
  expect(updates.state()).toEqual({ status: 'idle' }); expect(install).not.toHaveBeenCalled();
});
it('restores a rollback failure beside the ready icon and lets an explicit retry clear it', async () => {
  await saved(); await writeFile(join(directory, 'install-failed'), 'rollback');
  const { updates, install } = service(); await updates.settled();
  expect(updates.state()).toMatchObject({ status: 'error', version: '1.2.3', error: 'Fixture installation failed' });
  await updates.install(); expect(install).toHaveBeenCalledOnce();
  await expect(readFile(join(directory, 'install-failed'))).rejects.toThrow();
});
it('rechecks a restored artifact at the install boundary', async () => {
  await saved(); const { updates, install } = service(); await updates.settled();
  await writeFile(join(directory, entry().fileName), Buffer.alloc(bytes.length));
  await updates.install(); expect(install).not.toHaveBeenCalled();
  expect(updates.state()).toMatchObject({ status: 'error', error: 'Fixture installation failed' });
});
