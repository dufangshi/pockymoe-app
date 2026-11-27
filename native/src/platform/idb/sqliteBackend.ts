import * as SQLite from 'expo-sqlite';
import type { KvBackend } from './miniIdb';

// One file for every emulated IndexedDB database: `kv` rows and `stores` metadata.
let db: SQLite.SQLiteDatabase | undefined;
function open() {
  if (!db) {
    db = SQLite.openDatabaseSync('pockymoe-idb.sqlite');
    db.execSync(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS stores (db TEXT NOT NULL, store TEXT NOT NULL, key_path TEXT, version INTEGER NOT NULL, PRIMARY KEY (db, store));
      CREATE TABLE IF NOT EXISTS kv (db TEXT NOT NULL, store TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (db, store, key));`);
  }
  return db;
}

export const sqliteBackend: KvBackend = {
  async load(name) {
    const d = open();
    const stores: Awaited<ReturnType<KvBackend['load']>>['stores'] = {};
    let version = 0;
    for (const row of d.getAllSync<{ store: string; key_path: string | null; version: number }>('SELECT store, key_path, version FROM stores WHERE db = ?', name)) {
      stores[row.store] = { ...(row.key_path ? { keyPath: row.key_path } : {}), rows: new Map() };
      version = Math.max(version, row.version);
    }
    for (const row of d.getAllSync<{ store: string; key: string; value: string }>('SELECT store, key, value FROM kv WHERE db = ?', name))
      stores[row.store]?.rows.set(row.key, row.value);
    return { version, stores };
  },
  async createStore(name, store, keyPath, version) {
    open().runSync('INSERT OR REPLACE INTO stores (db, store, key_path, version) VALUES (?, ?, ?, ?)', name, store, keyPath ?? null, version);
  },
  async put(name, store, key, value) {
    open().runSync('INSERT OR REPLACE INTO kv (db, store, key, value) VALUES (?, ?, ?, ?)', name, store, key, value);
  },
  async delete(name, store, key) {
    open().runSync('DELETE FROM kv WHERE db = ? AND store = ? AND key = ?', name, store, key);
  },
  async clear(name, store) {
    open().runSync('DELETE FROM kv WHERE db = ? AND store = ?', name, store);
  },
};
