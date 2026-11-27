// The mini IndexedDB over memory, with Node's KeyObject standing in for the secure store.
import { KeyObject, webcrypto } from 'node:crypto';
import { createMiniIndexedDb, MiniKeyRange, type KvBackend, type KeyVault, type SavedKey } from '../../src/platform/idb/miniIdb';

export function memoryBackend() {
  const dbs = new Map<string, { version: number; stores: Map<string, { keyPath?: string; rows: Map<string, string> }> }>();
  const db = (name: string) => { let d = dbs.get(name); if (!d) dbs.set(name, d = { version: 0, stores: new Map() }); return d; };
  const backend: KvBackend = {
    async load(name) {
      const d = db(name);
      return { version: d.version, stores: Object.fromEntries([...d.stores].map(([k, s]) => [k, { ...(s.keyPath ? { keyPath: s.keyPath } : {}), rows: new Map(s.rows) }])) };
    },
    async createStore(name, store, keyPath, version) { const d = db(name); d.version = version; d.stores.set(store, { ...(keyPath ? { keyPath } : {}), rows: new Map() }); },
    async put(name, store, key, value) { db(name).stores.get(store)!.rows.set(key, value); },
    async delete(name, store, key) { db(name).stores.get(store)!.rows.delete(key); },
    async clear(name, store) { db(name).stores.get(store)!.rows.clear(); },
  };
  return { backend, dbs };
}

export function memoryVault() {
  const secrets = new Map<string, Uint8Array>();
  const vault: KeyVault = {
    async save(key) {
      const object = KeyObject.from(key as webcrypto.CryptoKey);
      const der = object.export({ format: 'der', type: key.type === 'private' ? 'pkcs8' : 'spki' });
      const ref = `pmk.${webcrypto.randomUUID()}`;
      secrets.set(ref, new Uint8Array(der));
      return { ref, type: key.type, algorithm: key.algorithm, usages: [...key.usages], extractable: key.extractable };
    },
    async load(saved: SavedKey) {
      const der = secrets.get(saved.ref) as Uint8Array<ArrayBuffer> | undefined;
      if (!der) throw new Error('missing key');
      return webcrypto.subtle.importKey(saved.type === 'private' ? 'pkcs8' : 'spki', der, saved.algorithm as EcKeyImportParams, saved.extractable, saved.usages) as Promise<CryptoKey>;
    },
    async remove(ref) { secrets.delete(ref); },
  };
  return { vault, secrets };
}

export function installMemoryIdb() {
  const backend = memoryBackend(), vault = memoryVault();
  const g = globalThis as Record<string, unknown>;
  g.indexedDB = createMiniIndexedDb(backend.backend, vault.vault);
  g.IDBKeyRange = MiniKeyRange;
  return { ...backend, ...vault, reload() { g.indexedDB = createMiniIndexedDb(backend.backend, vault.vault); } };
}
