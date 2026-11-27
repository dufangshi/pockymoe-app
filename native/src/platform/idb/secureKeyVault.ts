import * as SecureStore from 'expo-secure-store';
import { bytesToB64, b64ToBytes, type KeyVault, type SavedKey } from './miniIdb';

// CryptoKeys that the Web keeps as non-extractable IndexedDB values (the browser's
// request-signing key). The key material lives in the Keychain (iOS, this device only)
// or in EncryptedSharedPreferences under an Android Keystore key, and is re-imported
// non-extractable on read. quick-crypto's CryptoKey exposes its KeyObject, so storage
// can serialize it without making the key extractable to app code.
type QuickKey = CryptoKey & { keyObject: { export(options: { format: 'der'; type: string }): Uint8Array } };
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const secureKeyVault: KeyVault = {
  async save(key) {
    const k = key as QuickKey;
    const der = k.keyObject.export({ format: 'der', type: key.type === 'private' ? 'pkcs8' : 'spki' });
    const ref = `pmk.${crypto.randomUUID()}`;
    await SecureStore.setItemAsync(ref, bytesToB64(new Uint8Array(der)), options);
    return { ref, type: key.type, algorithm: key.algorithm, usages: [...key.usages], extractable: key.extractable };
  },
  async load(saved: SavedKey) {
    const b64 = await SecureStore.getItemAsync(saved.ref, options);
    if (!b64) throw new DOMException('Stored key material is missing', 'NotFoundError');
    const der = b64ToBytes(b64) as Uint8Array<ArrayBuffer>;
    return crypto.subtle.importKey(saved.type === 'private' ? 'pkcs8' : 'spki', der, saved.algorithm as EcKeyImportParams, saved.extractable, saved.usages);
  },
  async remove(ref) { await SecureStore.deleteItemAsync(ref, options); },
};
