// Seeds a long thread for performance checks: LONG=150 LAB=… vitest --config vitest.lab.config.mts test/lab/long.lab.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { installRelayFetch, useRelay } from '../../src/platform/relaySession';

const LAB = process.env.LAB!, RELAY = `http://localhost:${process.env.RELAY_PORT ?? 19201}`;
const tokens = new Map<string, string | null>();
installRelayFetch({ load: async o => tokens.get(o) ?? null, save: async (o, t) => { tokens.set(o, t); } });

it('seeds a long thread', async () => {
  (globalThis as Record<string, unknown>).__POCKYMOE_ENV__ = {};
  const { setHostRelayOrigin } = await import('@pockymoe/web/relayOrigin');
  setHostRelayOrigin(RELAY); await useRelay(RELAY);
  const auth = await import('@pockymoe/web/accountAuth');
  const transport = await import('@pockymoe/web/relayTransportCrypto');
  const account = JSON.parse(readFileSync(join(LAB, 'account.json'), 'utf8'));
  await auth.startAccountLogin(account.username, account.password);
  const session = await (await fetch(`${RELAY}/relay/auth/session`)).json();
  await auth.setAccountSession(session.user.id, session.account ?? false);
  await auth.finishAccountLogin(session.user.id, session.user);
  const device = JSON.parse(readFileSync(join(LAB, 'devices.json'), 'utf8')).studio.id;
  const call = async (method: string, path: string, body?: unknown) => {
    const { response } = await transport.exchange(new Request(`${RELAY}/relay/devices/${device}/api${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }));
    const text = await response.text(); return text ? JSON.parse(text) : null;
  };
  const ws = (await call('GET', '/workspaces')).find((w: { label: string }) => w.label === 'notes');
  const thread = await call('POST', '/threads/start', { workspaceId: ws.id, provider: 'codex', model: 'ios-e2e-stream', title: 'Long transcript', approvalMode: 'yolo' });
  const id = thread.thread?.id ?? thread.id;
  const n = Number(process.env.LONG ?? 150);
  for (let i = 1; i <= n; i++) {
    const prompt = i % 10 === 0 ? 'Split prompt-queue.ts into a durable queue' : `Reply with exactly ## Step ${i}\n\nChecked **${i}** items; see \`src/step-${i}.ts\`. All good.`;
    await call('POST', `/threads/${id}/prompt`, { prompt });
    for (let k = 0; k < 200; k++) { const t = await call('GET', `/threads/${id}?view=summary&limit=1`); if (t.thread.status !== 'running' && !t.thread.activeTurnId) break; await new Promise(r => setTimeout(r, 150)); }
  }
  console.log('long thread', id);
  expect(id).toBeTruthy();
}, 1_800_000);
