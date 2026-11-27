// Brings the lab's relay devices back after their processes stopped (a host restart): signs
// in, rotates each device token (POST /relay/devices/{id}/token) and starts the device again
// with scripts/lab/lab.sh. Tokens are never printed.
//   LAB=<dir> RELAY_PORT=… npx vitest run --config vitest.lab.config.mts test/lab/restartDevices.lab.test.ts
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { installRelayFetch, useRelay } from '../../src/platform/relaySession';

const LAB = process.env.LAB!;
const RELAY = `http://localhost:${process.env.RELAY_PORT ?? 19201}`;
const tokens = new Map<string, string | null>();
installRelayFetch({ load: async o => tokens.get(o) ?? null, save: async (o, t) => { tokens.set(o, t); } });

it('rotates device tokens and restarts the devices', async () => {
  (globalThis as Record<string, unknown>).__POCKYMOE_ENV__ = {};
  const { setHostRelayOrigin } = await import('@pockymoe/web/relayOrigin');
  setHostRelayOrigin(RELAY); await useRelay(RELAY);
  const auth = await import('@pockymoe/web/accountAuth');
  const account = JSON.parse(readFileSync(join(LAB, 'account.json'), 'utf8'));
  await auth.startAccountLogin(account.username, account.password);
  const session = await (await fetch(`${RELAY}/relay/auth/session`)).json();
  await auth.setAccountSession(session.user.id, session.account ?? false);
  await auth.finishAccountLogin(session.user.id, session.user);
  const devices: Record<string, { id: string; port: number }> = JSON.parse(readFileSync(join(LAB, 'devices.json'), 'utf8'));
  for (const [name, device] of Object.entries(devices)) {
    const response = await fetch(`${RELAY}/relay/devices/${device.id}/token`, { method: 'POST', credentials: 'include' });
    expect(response.status).toBeLessThan(300);
    const body = await response.json() as { token?: string };
    expect(body.token).toBeTruthy();
    execFileSync(join(__dirname, '../../scripts/lab/lab.sh'), ['device', name, body.token!, String(device.port)], { env: { ...process.env, LAB } });
  }
}, 60_000);
