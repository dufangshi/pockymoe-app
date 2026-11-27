import { createMiniIndexedDb, MiniKeyRange } from './miniIdb';
import { secureKeyVault } from './secureKeyVault';
import { sqliteBackend } from './sqliteBackend';

const g = globalThis as Record<string, unknown>;
if (!g.indexedDB) {
  g.indexedDB = createMiniIndexedDb(sqliteBackend, secureKeyVault);
  g.IDBKeyRange = MiniKeyRange;
}
