// The vendored account code asks for the password by dispatching
// ACCOUNT_UNLOCK_REQUEST on `window`; the app shows the unlock sheet and answers it.
import { ACCOUNT_UNLOCK_REQUEST, BROWSER_REMOVED, unlockAccount } from '@pockymoe/web/accountVaultState';
import type { UnlockedAccount, UnlockReason } from '@pockymoe/web/accountVault';
import type { UnlockCause } from '@pockymoe/web/unlockCause';
import { createStore } from '../state/store';

interface Pending { reason: UnlockReason; cause?: UnlockCause; resolve: (handle: UnlockedAccount) => void; reject: (error: unknown) => void }
export const unlockStore = createStore<{ pending: Pending[]; browserRemoved: boolean; unlockedAt: number }>({ pending: [], browserRemoved: false, unlockedAt: 0 });

const w = globalThis as unknown as { addEventListener(type: string, listener: (event: Event) => void): void };
w.addEventListener(ACCOUNT_UNLOCK_REQUEST, event => {
  const detail = (event as CustomEvent<Pending>).detail;
  unlockStore.set(s => ({ pending: [...s.pending, detail] }));
});
w.addEventListener(BROWSER_REMOVED, () => unlockStore.set({ browserRemoved: true }));

/** Unlocks with the password (or recovery code) and answers every waiting request. */
export async function submitUnlock(secret: string, recovery = false) {
  const handle = await unlockAccount(secret, recovery);
  const waiting = unlockStore.get().pending;
  unlockStore.set({ pending: [], browserRemoved: false, unlockedAt: Date.now() });
  waiting.forEach(p => p.resolve(handle));
  return handle;
}
export function cancelUnlock() {
  const waiting = unlockStore.get().pending;
  unlockStore.set({ pending: [] });
  const error = Object.assign(new Error('Unlock cancelled'), { code: 'accountUnlockRequired' });
  waiting.forEach(p => p.reject(error));
}
