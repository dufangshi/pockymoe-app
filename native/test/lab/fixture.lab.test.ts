// Drives the fake runtime's fixture events on a lab thread (approvals, questions, a
// held turn), so the app shows them live:  FIXTURE=approval THREAD=<id> LAB=… vitest …
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { installRelayFetch, useRelay } from '../../src/platform/relaySession';

const LAB = process.env.LAB!, RELAY = `http://localhost:${process.env.RELAY_PORT ?? 19201}`;
const tokens = new Map<string, string | null>();
installRelayFetch({ load: async o => tokens.get(o) ?? null, save: async (o, t) => { tokens.set(o, t); } });

it('sends a fixture event', async () => {
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
  const device = JSON.parse(readFileSync(join(LAB, 'devices.json'), 'utf8'))[process.env.DEVICE ?? 'studio'].id;
  // THREAD_TITLE picks the thread by title instead of THREAD (an id).
  let threadId = process.env.THREAD;
  if (!threadId && process.env.THREAD_TITLE) {
    const { response: list } = await transport.exchange(new Request(`${RELAY}/relay/devices/${device}/api/threads`, { method: 'GET' }));
    threadId = ((await list.json()) as Array<{ id: string; title: string }>).find(th => th.title === process.env.THREAD_TITLE)?.id;
    expect(threadId).toBeTruthy();
  }
  const body = { threadId, type: process.env.FIXTURE ?? 'approval', ...(process.env.TEXT ? { text: process.env.TEXT } : {}) };
  const path = process.env.PROMPT ? `/api/threads/${threadId}/prompt` : '/api/e2e/events';
  const { response } = await transport.exchange(new Request(`${RELAY}/relay/devices/${device}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(process.env.PROMPT ? { prompt: process.env.PROMPT } : body) }));
  console.log(response.status, (await response.text()).slice(0, 300));
  expect(response.status).toBeLessThan(300);
}, 60_000);
