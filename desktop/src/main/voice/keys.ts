import { readJson, writeJson } from '../store';

export interface KeyCrypto { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string }
/**
 * Keys are kept per service origin, so changing the address cannot send a saved key anywhere
 * else, and they stay out of settings.json, which the Web page can read.
 */
export class VoiceKeys {
  private keys: Record<string, string>;
  // A denied/unreadable origin stays unavailable for this launch. Repeated
  // alerts/previews must not reopen the same Keychain prompt or claim it is saved.
  private unavailable = new Set<string>();
  constructor(private path: string, private crypto: KeyCrypto) {
    const stored = readJson(path);
    this.keys = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored as Record<string, string> : {};
  }
  has(origin: string): boolean { return Object.hasOwn(this.keys, origin) && !this.unavailable.has(origin); }
  get(origin: string): string | null {
    if (!this.has(origin)) return null;
    try {
      if (!this.crypto.isEncryptionAvailable()) throw new Error('keychainUnavailable');
      return this.crypto.decryptString(Buffer.from(this.keys[origin]!, 'base64'));
    } catch { this.unavailable.add(origin); return null; }
  }
  set(origin: string, key: string): void {
    if (!this.crypto.isEncryptionAvailable()) throw new Error('keychainUnavailable');
    this.keys[origin] = this.crypto.encryptString(key).toString('base64');
    writeJson(this.path, this.keys);
    this.unavailable.delete(origin);
  }
  clear(origin: string): void { delete this.keys[origin]; writeJson(this.path, this.keys); this.unavailable.delete(origin); }
}
