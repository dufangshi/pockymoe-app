import * as SecureStore from 'expo-secure-store';
import type { TokenStore } from '../platform/relaySession';

// Session tokens live in the Keychain / Keystore, keyed by a hash of the origin.
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
function key(prefix: string, origin: string) {
  let h = 0; for (const ch of origin) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
  return `${prefix}.${(h >>> 0).toString(36)}.${origin.replace(/[^A-Za-z0-9]/g, '').slice(-40)}`;
}
export const relayTokens: TokenStore = {
  load: origin => SecureStore.getItemAsync(key('relay-session', origin), options),
  save: async (origin, token) => {
    if (token) await SecureStore.setItemAsync(key('relay-session', origin), token, options);
    else await SecureStore.deleteItemAsync(key('relay-session', origin), options);
  },
};
export const directTokens = {
  load: (url: string) => SecureStore.getItemAsync(key('direct-session', url), options),
  save: async (url: string, token: string | null) => {
    if (token) await SecureStore.setItemAsync(key('direct-session', url), token, options);
    else await SecureStore.deleteItemAsync(key('direct-session', url), options);
  },
};
