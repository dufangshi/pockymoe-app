// Lab round trip against a real relay and relay-supervisor (scripts/lab/lab.sh):
// register an account with the vendored Web code, add a device, talk to it over the
// end-to-end encrypted transport, and seed threads for the app. Run with
//   LAB=<dir> npx vitest run --config vitest.lab.config.ts
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { installRelayFetch, useRelay, relaySessionToken } from '../../src/platform/relaySession';

const LAB = process.env.LAB!;
const RELAY = `http://localhost:${process.env.RELAY_PORT ?? 19201}`;
const tokens = new Map<string, string | null>();
installRelayFetch({ load: async o => tokens.get(o) ?? null, save: async (o, t) => { tokens.set(o, t); } });
const accountFile = join(LAB, 'account.json');

it('registers, adds a device, and reaches it encrypted', async () => {
  (globalThis as Record<string, unknown>).__POCKYMOE_ENV__ = {};
  const { setHostRelayOrigin } = await import('@pockymoe/web/relayOrigin');
  setHostRelayOrigin(RELAY);
  await useRelay(RELAY);
  const vault = await import('@pockymoe/web/accountVaultState');
  const auth = await import('@pockymoe/web/accountAuth');
  const transport = await import('@pockymoe/web/relayTransportCrypto');
  const statuses: unknown[] = [];
  transport.setTransportReporter(status => statuses.push(status));

  const saved = existsSync(accountFile) ? JSON.parse(readFileSync(accountFile, 'utf8')) : null;
  const account = saved ?? { username: `lab${randomBytes(3).toString('hex')}`, password: randomBytes(18).toString('base64url') };
  if (!saved) {
    const prepared = await vault.createVault(crypto.randomUUID(), account.password);
    const result = await auth.registerAccount({ email: `${account.username}@example.test`, username: account.username }, prepared);
    expect(result.pendingApproval ?? false).toBe(false);
    await vault.openVault(prepared.vault, account.password);
    await vault.registerBrowser('Lab seed', 'registration');
    account.userId = prepared.vault.userId;
    writeFileSync(accountFile, JSON.stringify(account), { mode: 0o600 });
  } else {
    const login = await auth.startAccountLogin(account.username, account.password);
    expect(login).toBeTruthy();
    const session = await (await fetch(`${RELAY}/relay/auth/session`, { credentials: 'include' })).json();
    await auth.setAccountSession(session.user.id, session.account ?? false);
    await auth.finishAccountLogin(session.user.id, session.user);
  }
  expect(relaySessionToken()).toBeTruthy();
  const browser = await vault.currentBrowser();
  expect(browser?.browserId).toBeTruthy();

  const devicesFile = join(LAB, 'devices.json');
  const devices: Record<string, { id: string; port: number }> = existsSync(devicesFile) ? JSON.parse(readFileSync(devicesFile, 'utf8')) : {};
  const running = (name: string) => { try { process.kill(Number(readFileSync(join(LAB, 'pids', name), 'utf8')), 0); return true; } catch { return false; } };
  for (const [name, port] of [['studio', Number(process.env.STUDIO_PORT ?? 19204)], ['laptop', Number(process.env.LAPTOP_PORT ?? 19205)]] as const) {
    if (devices[name] && !running(name)) {
      // A saved device whose process stopped: rotate its token and start it again.
      const rotated = await (await fetch(`${RELAY}/relay/devices/${devices[name]!.id}/token`, { method: 'POST' })).json();
      execFileSync(join(__dirname, '../../scripts/lab/lab.sh'), ['device', name, rotated.token ?? rotated.device?.token, String(port)], { env: { ...process.env, LAB } });
      continue;
    }
    if (devices[name]) continue;
    const created = await (await fetch(`${RELAY}/relay/devices`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name === 'studio' ? 'Studio Linux' : 'Travel laptop' }) })).json();
    execFileSync(join(__dirname, '../../scripts/lab/lab.sh'), ['device', name, created.token, String(port)], { env: { ...process.env, LAB } });
    devices[name] = { id: created.device.id, port };
    writeFileSync(devicesFile, JSON.stringify(devices), { mode: 0o600 });
  }
  const studio = devices.studio!.id;
  const call = async (method: string, path: string, body?: unknown) => {
    const { response } = await transport.exchange(new Request(`${RELAY}/relay/devices/${studio}/api${path}`, {
      method, credentials: 'include', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  };
  for (let i = 0; i < 60; i++) { if ((await call('GET', '/version').catch(() => ({ status: 0 }))).status === 200) break; await new Promise(r => setTimeout(r, 500)); }
  const version = await call('GET', '/version');
  expect(version.status).toBe(200);
  expect(statuses.some(s => (s as { state: string }).state === 'encrypted')).toBe(true);

  let workspaces = (await call('GET', '/workspaces')).data as Array<{ id: string; label: string }>;
  if (!workspaces.length) {
    const root = join(LAB, 'studio/ws');
    for (const label of ['pockymoe', 'prompt-queue', 'notes']) {
      execFileSync('mkdir', ['-p', join(root, label)]);
      execFileSync('git', ['init', '-q', join(root, label)]);
      writeFileSync(join(root, label, 'README.md'), `# ${label}\n\nLab workspace for the native client.\n`);
      expect((await call('POST', '/workspaces', { label, absPath: join(root, label) })).status).toBeLessThan(300);
    }
    workspaces = (await call('GET', '/workspaces')).data;
    const queue = workspaces.find(w => w.label === 'prompt-queue')!;
    for (const [title, prompt] of [['Split the prompt queue', 'Split prompt-queue.ts into a durable queue'], ['Say hello', 'hello there'],
      ['Explain the relay', 'Reply with exactly The relay forwards sealed requests; it never sees plaintext.']]) {
      const started = await call('POST', '/threads/start', { workspaceId: queue.id, model: 'fake', title });
      expect(started.status).toBeLessThan(300);
      const thread = started.data.thread?.id ?? started.data.id;
      expect((await call('POST', `/threads/${thread}/prompt`, { prompt })).status).toBeLessThan(300);
    }
  }
  expect(workspaces.length).toBeGreaterThan(0);
}, 120_000);
