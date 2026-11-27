// A prompt with a photo and a file through the relay's sealed transport, built the way the
// app builds it (Web placeholders, multipart bytes): the Supervisor stores both under
// .temp/threads/<thread>/ and rewrites the placeholders into their paths.
//   THREAD=<idle lab thread> LAB=… npx vitest run --config vitest.lab.config.mts test/lab/attachments.lab.test.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { installRelayFetch, useRelay } from '../../src/platform/relaySession';
import { multipart } from '../../src/protocol/multipart';
import { attachmentPlaceholder, promptMatchKey } from '../../src/features/thread/placeholder';

const LAB = process.env.LAB!, RELAY = `http://localhost:${process.env.RELAY_PORT ?? 19201}`;
const tokens = new Map<string, string | null>();
installRelayFetch({ load: async o => tokens.get(o) ?? null, save: async (o, t) => { tokens.set(o, t); } });
// 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

it.skipIf(!process.env.THREAD)('sends a photo and a file with a prompt', async () => {
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
  const thread = process.env.THREAD!;
  const call = async (path: string, init: RequestInit = {}) => (await transport.exchange(new Request(`${RELAY}/relay/devices/${device}${path}`, init))).response;

  writeFileSync('/tmp/pockymoe-lab-dot.png', PNG);
  writeFileSync('/tmp/pockymoe-lab-notes.txt', 'lab notes\n');
  const photo = attachmentPlaceholder('photo', 'dot.png', new Set());
  const file = attachmentPlaceholder('file', 'notes.txt', new Set([photo]));
  const prompt = `Attachment round trip ${Date.now()}\n${photo} ${file}`;
  const manifest = [
    { clientId: 'p1', kind: 'photo', originalName: 'dot.png', placeholder: photo },
    { clientId: 'f1', kind: 'file', originalName: 'notes.txt', placeholder: file },
  ];
  const { body, contentType } = await multipart([['prompt', prompt], ['clientRequestId', crypto.randomUUID()], ['attachmentManifest', JSON.stringify(manifest)]], [
    { field: 'attachments', name: 'dot.png', type: 'image/png', uri: '/tmp/pockymoe-lab-dot.png' },
    { field: 'attachments', name: 'notes.txt', type: 'text/plain', uri: '/tmp/pockymoe-lab-notes.txt' },
  ]);
  const sent = await call(`/api/threads/${thread}/prompt`, { method: 'POST', body, headers: { 'content-type': contentType } });
  expect(sent.status, await sent.clone().text()).toBe(200);

  let stored: string | undefined;
  // A turn queues behind a running one; the fake runtime takes up to half a minute a turn.
  for (let i = 0; i < 120 && !stored; i++) {
    const detail = await (await call(`/api/threads/${thread}?limit=2`)).json();
    stored = detail.turns.flatMap((t: { items: { kind: string; text: string }[] }) => t.items).filter((it: { kind: string }) => it.kind === 'userMessage')
      .map((it: { text: string }) => it.text).find((text: string) => promptMatchKey(text) === promptMatchKey(prompt));
    if (!stored) await new Promise(r => setTimeout(r, 1000));
  }
  // Stored names keep the original name and gain a short hash.
  const photoPath = new RegExp(`\\[PHOTO (\\./\\.temp/threads/${thread}/dot[^\\]]*\\.png)\\]`).exec(stored ?? '')?.[1];
  expect(photoPath).toBeTruthy();
  expect(stored).toMatch(new RegExp(`\\[FILE \\./\\.temp/threads/${thread}/notes[^\\]]*\\.txt\\]`));
  const image = await call(`/api/threads/${thread}/assets/image?${new URLSearchParams({ path: photoPath! })}`);
  expect(image.status).toBe(200);
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array(PNG));
}, 200_000);
