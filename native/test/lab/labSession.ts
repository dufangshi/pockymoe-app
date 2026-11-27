// Signs the lab account in with the vendored Web code and returns a relay device's API, as
// the app builds it. Lab credentials only (LAB/account.json); never a real relay.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installRelayFetch, useRelay } from '../../src/platform/relaySession';

export const LAB = process.env.LAB!;
export const RELAY = `http://localhost:${process.env.RELAY_PORT ?? 19201}`;
const tokens = new Map<string, string | null>();
installRelayFetch({ load: async o => tokens.get(o) ?? null, save: async (o, t) => { tokens.set(o, t); } });

export async function labDevice(name = process.env.DEVICE ?? 'studio') {
  // DIRECT=<url>: the lab's direct (local mode) Supervisor instead of a relay device.
  if (process.env.DIRECT) {
    const { DeviceApi } = await import('../../src/protocol/api');
    return { deviceId: null, api: new DeviceApi({ kind: 'direct', baseUrl: process.env.DIRECT, token: null }) };
  }
  (globalThis as Record<string, unknown>).__POCKYMOE_ENV__ = {};
  const { setHostRelayOrigin } = await import('@pockymoe/web/relayOrigin');
  setHostRelayOrigin(RELAY); await useRelay(RELAY);
  const auth = await import('@pockymoe/web/accountAuth');
  const account = JSON.parse(readFileSync(join(LAB, 'account.json'), 'utf8'));
  await auth.startAccountLogin(account.username, account.password);
  const session = await (await fetch(`${RELAY}/relay/auth/session`)).json();
  await auth.setAccountSession(session.user.id, session.account ?? false);
  await auth.finishAccountLogin(session.user.id, session.user);
  const deviceId: string = JSON.parse(readFileSync(join(LAB, 'devices.json'), 'utf8'))[name].id;
  // Loaded after the fetch wrapper is installed, as in the app (index.ts installs it first).
  const { DeviceApi } = await import('../../src/protocol/api');
  return { deviceId, api: new DeviceApi({ kind: 'relay', deviceId }) };
}

export const waitFor = async <T>(read: () => Promise<T | null | undefined | false>, what: string, seconds = 90): Promise<T> => {
  for (let i = 0; i < seconds * 2; i++) { const value = await read(); if (value) return value; await new Promise(r => setTimeout(r, 500)); }
  throw new Error(`timed out waiting for ${what}`);
};
