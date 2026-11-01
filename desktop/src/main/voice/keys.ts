import { readJson, writeJson } from '../store';

export interface KeyCrypto { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string }
/**
 * Keys are kept per service origin, so changing the address cannot send a saved key anywhere
 * else, and they stay out of settings.json, which the Web page can read.
 */
export class VoiceKeys {
  private keys: Record<string, string>;
  constructor(private path: string, private crypto: KeyCrypto) {
    const stored = readJson(path);
    this.keys = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored as Record<string, string> : {};
  }
  has(origin: string): boolean { return Object.hasOwn(this.keys, origin); }
  get(origin: string): string | null {
    if (!this.has(origin) || !this.crypto.isEncryptionAvailable()) return null;
    try { return this.crypto.decryptString(Buffer.from(this.keys[origin]!, 'base64')); } catch { return null; }
  }
  set(origin: string, key: string): void {
    if (!this.crypto.isEncryptionAvailable()) throw new Error('keychainUnavailable');
    this.keys[origin] = this.crypto.encryptString(key).toString('base64');
    writeJson(this.path, this.keys);
  }
  clear(origin: string): void { delete this.keys[origin]; writeJson(this.path, this.keys); }
}
