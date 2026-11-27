// The relay account: sign in, register, restore, sign out. The cryptography and
// the vault protocol are the vendored Web modules; this file only sequences them
// the way the Web's portal page does and keeps the app's state.
import type { RelayUserDto } from '@pockymoe/shared';
import { setHostRelayOrigin } from '@pockymoe/web/relayOrigin';
import { cancelAccountLogin, finishAccountLogin, registerAccount, setAccountSession, startAccountLogin, startAccountRecovery } from '@pockymoe/web/accountAuth';
import { createVault, currentBrowser, logoutAccount, openVault, registerBrowser, safetyCode, currentAccount } from '@pockymoe/web/accountVaultState';
import { clearAllTransportKeys } from '@pockymoe/web/relayTransportCrypto';
import { clearRelaySession, relaySessionToken, useRelay } from '../platform/relaySession';
import { relayApi } from '../protocol/api';
import { prefs } from '../platform/prefs';
import { createStore } from '../state/store';

export type AccountPhase = 'none' | 'checking' | 'signedOut' | 'challenge' | 'ready' | 'offline' | 'setupOnWeb' | 'pendingApproval';
export interface AccountState {
  phase: AccountPhase;
  origin: string | null;
  user: RelayUserDto | null;
  /** This app holds a certified request-signing key for the account. */
  hasBrowserKey: boolean;
  safetyCode: string | null;
  registrationEnabled: boolean;
  error: string | null;
}
export const accountStore = createStore<AccountState>({ phase: 'none', origin: null, user: null, hasBrowserKey: false, safetyCode: null, registrationEnabled: false, error: null });

const RELAY_KEY = 'pockymoe-native.relay-origin';
export const savedRelayOrigin = () => prefs.get(RELAY_KEY);

export function normalizeOrigin(input: string) {
  const trimmed = input.trim().replace(/\/+$/, '');
  const url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  return url.origin;
}

async function selectRelay(origin: string) {
  setHostRelayOrigin(origin);
  if (accountStore.get().origin !== origin) clearAllTransportKeys();
  await useRelay(origin);
  accountStore.set({ origin });
}

async function adoptSession(): Promise<void> {
  const session = await relayApi.session();
  if (__DEV__) console.log('[account] session', session.authenticated, !!relaySessionToken());
  accountStore.set({ registrationEnabled: !!session.registrationEnabled });
  if (!session.authenticated || !session.user) { accountStore.set({ phase: 'signedOut', user: null }); return; }
  await setAccountSession(session.user.id, (session as { account?: Parameters<typeof setAccountSession>[1] }).account ?? false);
  const flow = await finishAccountLogin(session.user.id, session.user);
  const account = await currentAccount();
  accountStore.set({
    user: session.user, phase: flow.setup ? 'setupOnWeb' : 'ready', error: null,
    hasBrowserKey: !!await currentBrowser().catch(() => null),
    safetyCode: account ? await safetyCode(account.accountKeyId) : null,
  });
}

/** Startup: reuse the saved relay and its session, if any. */
export async function restoreAccount() {
  const origin = savedRelayOrigin();
  if (!origin) { accountStore.set({ phase: 'none' }); return; }
  accountStore.set({ phase: 'checking' });
  try {
    await selectRelay(origin);
    if (!relaySessionToken()) {
      const session = await relayApi.session().catch(() => null);
      accountStore.set({ phase: 'signedOut', registrationEnabled: !!session?.registrationEnabled });
      return;
    }
    await adoptSession();
  } catch (error) {
    if (__DEV__) console.log('[account] restore failed', (error as Error)?.stack ?? error);
    accountStore.set({ phase: 'offline', error: String((error as Error)?.message ?? error) });
  }
}

/** Checks that an address answers as a Pockymoe relay before anything is sent to it. */
export async function probeRelay(input: string) {
  const origin = normalizeOrigin(input);
  const response = await fetch(`${origin}/relay/auth/session`, { credentials: 'omit', cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const session = await response.json() as { registrationEnabled?: boolean; authenticated?: boolean };
  if (typeof session.authenticated !== 'boolean') throw new Error('not a relay');
  return { origin, registrationEnabled: !!session.registrationEnabled };
}

export async function chooseRelay(origin: string, registrationEnabled: boolean) {
  await selectRelay(origin);
  prefs.set(RELAY_KEY, origin);
  accountStore.set({ phase: 'signedOut', registrationEnabled, error: null });
}

/** A sign-in starts without the previous session: a relay that no longer knows the stored
 *  bearer token answers 401 to the login itself, which read as a wrong password. */
async function freshSession() { if (relaySessionToken()) await clearRelaySession(); }

export async function signIn(identifier: string, password: string) {
  await freshSession();
  const result = await startAccountLogin(identifier.trim(), password);
  if (result.challengeRequired) { accountStore.set({ phase: 'challenge' }); return 'challenge' as const; }
  await adoptSession();
  return 'done' as const;
}

export async function completeChallenge(code: string) {
  const { relayUrl } = await import('@pockymoe/web/relayOrigin');
  const response = await fetch(relayUrl('relay/auth/challenge'), { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: code.replace(/\s/g, ''), rememberBrowser: true }) });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(data?.message ?? `HTTP ${response.status}`);
  }
  await adoptSession();
}

export async function signInWithRecovery(identifier: string, code: string) {
  await freshSession();
  await startAccountRecovery(identifier.trim(), code);
  await adoptSession();
}

export async function register(input: { email: string; username: string; password: string; inviteCode?: string }) {
  const prepared = await createVault(globalThis.crypto.randomUUID(), input.password);
  const result = await registerAccount({ email: input.email.trim(), username: input.username.trim(),
    ...(input.inviteCode?.trim() ? { registrationPassword: input.inviteCode.trim() } : {}) }, prepared);
  if (result.pendingApproval) { accountStore.set({ phase: 'pendingApproval' }); return { recoveryCode: prepared.recoveryCode, pending: true }; }
  await openVault(prepared.vault, input.password);
  await registerBrowser(undefined, 'registration');
  return { recoveryCode: prepared.recoveryCode, pending: false };
}
/** After the recovery code was confirmed. */
export async function finishRegistration() { await adoptSession(); }

export async function signOut() {
  cancelAccountLogin();
  await relayApi.logout();
  await logoutAccount().catch(() => undefined);
  clearAllTransportKeys();
  await clearRelaySession();
  accountStore.set({ phase: 'signedOut', user: null, hasBrowserKey: false, safetyCode: null });
}

export async function forgetRelay() {
  await signOut().catch(() => undefined);
  prefs.set(RELAY_KEY, null);
  await useRelay(null);
  accountStore.set({ phase: 'none', origin: null });
}

/** Re-certifies this app's request key (asks for the password through the unlock sheet). */
export async function ensureBrowserKey() {
  await registerBrowser(undefined, 'native-app');
  accountStore.set({ hasBrowserKey: true });
}
