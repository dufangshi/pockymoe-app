// The subset of IndexedDB that the vendored Web protocol code uses (accountStore,
// pendingEnrollmentStore, sharingTrustStore and relayTransportCrypto's identity pins),
// persisted through a small key-value backend. Values are structured data plus
// Uint8Array/ArrayBuffer and CryptoKey; private key material goes to the secure store
// (Keychain / Android Keystore), never into the database file.
//
// Semantics kept from IndexedDB: requests in a transaction run in order and fire
// `onsuccess` asynchronously; a request issued from a handler joins the same
// transaction; `oncomplete` fires once no request is pending. Writes reach the backend
// when they run, so a later transaction (or a restart) sees them.

export interface KvBackend {
  load(db: string): Promise<{ version: number; stores: Record<string, { keyPath?: string; rows: Map<string, string> }> }>;
  createStore(db: string, store: string, keyPath: string | undefined, version: number): Promise<void>;
  put(db: string, store: string, key: string, value: string): Promise<void>;
  delete(db: string, store: string, key: string): Promise<void>;
  clear(db: string, store: string): Promise<void>;
}

export interface KeyVault {
  /** Serializes a CryptoKey's material into the secure store and returns a reference. */
  save(key: CryptoKey): Promise<SavedKey>;
  load(saved: SavedKey): Promise<CryptoKey>;
  remove(ref: string): Promise<void>;
}
export interface SavedKey { ref: string; type: KeyType; algorithm: unknown; usages: KeyUsage[]; extractable: boolean }

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const TAG = '$pm';

function isCryptoKey(value: unknown): value is CryptoKey {
  return !!value && typeof value === 'object' && (value as { [Symbol.toStringTag]?: string })[Symbol.toStringTag] === 'CryptoKey';
}

async function encodeValue(value: unknown, vault: KeyVault, refs: string[]): Promise<Json> {
  if (value === undefined) return { [TAG]: 'undefined' };
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : { [TAG]: 'number', v: String(value) };
  if (value instanceof Uint8Array) return { [TAG]: 'u8', v: bytesToB64(value) };
  if (value instanceof ArrayBuffer) return { [TAG]: 'ab', v: bytesToB64(new Uint8Array(value)) };
  if (value instanceof Date) return { [TAG]: 'date', v: value.getTime() };
  if (isCryptoKey(value)) {
    const saved = await vault.save(value);
    refs.push(saved.ref);
    return { [TAG]: 'key', v: saved as unknown as Json };
  }
  if (Array.isArray(value)) return Promise.all(value.map(item => encodeValue(item, vault, refs)));
  if (typeof value === 'object') {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'function') throw new DOMException('Function values cannot be stored', 'DataCloneError');
      out[k] = await encodeValue(v, vault, refs);
    }
    return out;
  }
  throw new DOMException(`Cannot store ${typeof value}`, 'DataCloneError');
}

async function decodeValue(value: Json, vault: KeyVault): Promise<unknown> {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Promise.all(value.map(item => decodeValue(item, vault)));
  const tag = value[TAG];
  if (typeof tag === 'string') {
    switch (tag) {
      case 'undefined': return undefined;
      case 'number': return Number(value.v);
      case 'u8': return b64ToBytes(value.v as string);
      case 'ab': return b64ToBytes(value.v as string).buffer;
      case 'date': return new Date(value.v as number);
      case 'key': return vault.load(value.v as unknown as SavedKey);
    }
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const decoded = await decodeValue(v, vault);
    if (!(v && typeof v === 'object' && !Array.isArray(v) && (v as Record<string, Json>)[TAG] === 'undefined')) out[k] = decoded;
    else out[k] = undefined;
  }
  return out;
}

function keyRefs(json: string): string[] {
  const refs: string[] = [];
  const walk = (value: Json) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value[TAG] === 'key') { refs.push((value.v as { ref: string }).ref); return; }
    Object.values(value).forEach(walk);
  };
  walk(JSON.parse(json) as Json);
  return refs;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function bytesToB64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2]! + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]! +
      (b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!) + (c === undefined ? '=' : B64[c & 63]!);
  }
  return out;
}
export function b64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let bits = 0, value = 0, index = 0;
  for (const ch of clean) {
    value = (value << 6) | B64.indexOf(ch); bits += 6;
    if (bits >= 8) { bits -= 8; out[index++] = (value >> bits) & 255; }
  }
  return out;
}

// ---- Key ranges ------------------------------------------------------------------

export class MiniKeyRange {
  constructor(readonly lower: string | undefined, readonly upper: string | undefined,
    readonly lowerOpen = false, readonly upperOpen = false) {}
  static bound(lower: string, upper: string, lowerOpen = false, upperOpen = false) { return new MiniKeyRange(lower, upper, lowerOpen, upperOpen); }
  static only(value: string) { return new MiniKeyRange(value, value); }
  static lowerBound(lower: string, open = false) { return new MiniKeyRange(lower, undefined, open); }
  static upperBound(upper: string, open = false) { return new MiniKeyRange(undefined, upper, false, open); }
  includes(key: string) {
    if (this.lower !== undefined && (this.lowerOpen ? key <= this.lower : key < this.lower)) return false;
    if (this.upper !== undefined && (this.upperOpen ? key >= this.upper : key > this.upper)) return false;
    return true;
  }
}

// ---- Requests and transactions -----------------------------------------------------

type Handler = ((this: unknown, event: { target: unknown }) => void) | null;

export class MiniRequest<T = unknown> {
  result: T = undefined as T;
  error: DOMException | null = null;
  readyState: 'pending' | 'done' = 'pending';
  onsuccess: Handler = null;
  onerror: Handler = null;
  onupgradeneeded: Handler = null;
  onblocked: Handler = null;
  constructor(readonly source: unknown = null, readonly transaction: MiniTransaction | null = null) {}
  succeed(result: T) { this.result = result; this.readyState = 'done'; this.onsuccess?.call(this, { target: this }); }
  fail(error: DOMException) { this.error = error; this.readyState = 'done'; this.onerror?.call(this, { target: this }); }
}

interface StoreState { keyPath?: string; rows: Map<string, string> }
interface DbState { name: string; version: number; stores: Map<string, StoreState> }

export class MiniTransaction {
  oncomplete: Handler = null;
  onerror: Handler = null;
  onabort: Handler = null;
  error: DOMException | null = null;
  private queue: Array<() => Promise<void>> = [];
  private running = false;
  private finished = false;
  constructor(readonly db: MiniDatabase, readonly storeNames: string[], readonly mode: IDBTransactionMode) {
    setTimeout(() => this.pump(), 0);
  }
  objectStore(name: string) {
    if (!this.storeNames.includes(name)) throw new DOMException(`No store ${name} in this transaction`, 'NotFoundError');
    return new MiniObjectStore(this, name);
  }
  get objectStoreNames() { return this.storeNames; }
  abort() { this.fail(new DOMException('Transaction aborted', 'AbortError')); }
  enqueue(job: () => Promise<void>) {
    if (this.finished) throw new DOMException('Transaction is finished', 'TransactionInactiveError');
    this.queue.push(job);
    if (!this.running) setTimeout(() => this.pump(), 0);
  }
  private async pump() {
    if (this.running || this.finished) return;
    this.running = true;
    try {
      while (this.queue.length && !this.finished) await this.queue.shift()!();
    } catch (error) {
      this.fail(error instanceof DOMException ? error : new DOMException(String((error as Error)?.message ?? error), 'UnknownError'));
    } finally { this.running = false; }
    if (this.finished) return;
    // A handler may queue more work after its request settled; give it a turn first.
    setTimeout(() => {
      if (this.finished || this.running) return;
      if (this.queue.length) { void this.pump(); return; }
      this.finished = true;
      this.oncomplete?.call(this, { target: this });
    }, 0);
  }
  private fail(error: DOMException) {
    if (this.finished) return;
    this.finished = true; this.error = error; this.queue = [];
    this.onerror?.call(this, { target: this });
    this.onabort?.call(this, { target: this });
  }
}

class MiniCursor {
  constructor(private readonly advance: () => void, readonly key: string, readonly primaryKey: string, readonly value: unknown) {}
  continue() { this.advance(); }
}

export class MiniObjectStore {
  constructor(readonly transaction: MiniTransaction, readonly name: string) {}
  private get state() { return this.transaction.db.state.stores.get(this.name)!; }
  get keyPath() { return this.state.keyPath ?? null; }
  private get env() { return this.transaction.db.env; }
  private request<T>(run: (request: MiniRequest<T>) => Promise<void>, write = false) {
    if (write && this.transaction.mode === 'readonly') throw new DOMException('Read-only transaction', 'ReadOnlyError');
    const request = new MiniRequest<T>(this, this.transaction);
    // A failed request fires its own onerror, then aborts the transaction (IndexedDB semantics).
    this.transaction.enqueue(async () => {
      try { await run(request); }
      catch (error) {
        const failure = error instanceof DOMException ? error : new DOMException(String((error as Error)?.message ?? error), 'UnknownError');
        request.fail(failure); throw failure;
      }
    });
    return request;
  }
  private keyFor(value: unknown, key?: IDBValidKey) {
    const keyPath = this.state.keyPath;
    const resolved = keyPath ? (value as Record<string, unknown>)?.[keyPath] : key;
    if (typeof resolved !== 'string') throw new DOMException('Only string keys are supported', 'DataError');
    return resolved;
  }
  private async read(key: string) {
    const json = this.state.rows.get(key);
    return json === undefined ? undefined : decodeValue(JSON.parse(json) as Json, this.env.vault);
  }
  private async write(key: string, value: unknown) {
    const refs: string[] = [];
    const json = JSON.stringify(await encodeValue(value, this.env.vault, refs));
    const previous = this.state.rows.get(key);
    this.state.rows.set(key, json);
    await this.env.backend.put(this.transaction.db.name, this.name, key, json);
    if (previous) for (const ref of keyRefs(previous)) if (!refs.includes(ref)) await this.env.vault.remove(ref);
  }
  private async remove(key: string) {
    const previous = this.state.rows.get(key);
    if (previous === undefined) return;
    this.state.rows.delete(key);
    await this.env.backend.delete(this.transaction.db.name, this.name, key);
    for (const ref of keyRefs(previous)) await this.env.vault.remove(ref);
  }
  private keys(range?: MiniKeyRange | string) {
    const all = [...this.state.rows.keys()].sort();
    if (range === undefined) return all;
    return all.filter(key => typeof range === 'string' ? key === range : range.includes(key));
  }
  get(key: string) { return this.request<unknown>(async request => request.succeed(await this.read(key))); }
  getAll(range?: MiniKeyRange) {
    return this.request<unknown[]>(async request => request.succeed(await Promise.all(this.keys(range).map(key => this.read(key)))));
  }
  getAllKeys(range?: MiniKeyRange) { return this.request<string[]>(async request => request.succeed(this.keys(range))); }
  count(range?: MiniKeyRange | string) { return this.request<number>(async request => request.succeed(this.keys(range).length)); }
  put(value: unknown, key?: IDBValidKey) {
    const resolved = this.keyFor(value, key);
    return this.request<string>(async request => { await this.write(resolved, value); request.succeed(resolved); }, true);
  }
  add(value: unknown, key?: IDBValidKey) {
    const resolved = this.keyFor(value, key);
    return this.request<string>(async request => {
      if (this.state.rows.has(resolved)) throw new DOMException('Key already exists', 'ConstraintError');
      await this.write(resolved, value); request.succeed(resolved);
    }, true);
  }
  delete(key: string | MiniKeyRange) {
    return this.request<undefined>(async request => {
      for (const k of this.keys(key)) await this.remove(k);
      request.succeed(undefined);
    }, true);
  }
  clear() {
    return this.request<undefined>(async request => {
      for (const k of this.keys()) await this.remove(k);
      await this.env.backend.clear(this.transaction.db.name, this.name);
      request.succeed(undefined);
    }, true);
  }
  openCursor(range?: MiniKeyRange) {
    const request = new MiniRequest<MiniCursor | null>(this, this.transaction);
    const keys = this.keys(range);
    let index = 0;
    const step = () => this.transaction.enqueue(async () => {
      if (index >= keys.length) { request.succeed(null); return; }
      const key = keys[index++]!;
      request.succeed(new MiniCursor(step, key, key, await this.read(key)));
    });
    step();
    return request;
  }
}

interface Env { backend: KvBackend; vault: KeyVault }

export class MiniDatabase {
  closed = false;
  constructor(readonly env: Env, readonly state: DbState, private readonly upgrading: { version: number } | null) {}
  get name() { return this.state.name; }
  get version() { return this.state.version; }
  get objectStoreNames() {
    const names = [...this.state.stores.keys()];
    return Object.assign(names, { contains: (name: string) => names.includes(name) });
  }
  createObjectStore(name: string, options: { keyPath?: string } = {}) {
    if (!this.upgrading) throw new DOMException('Stores are created during upgrades only', 'InvalidStateError');
    if (this.state.stores.has(name)) throw new DOMException(`Store ${name} exists`, 'ConstraintError');
    this.state.stores.set(name, { ...(options.keyPath ? { keyPath: options.keyPath } : {}), rows: new Map() });
    void this.env.backend.createStore(this.name, name, options.keyPath, this.upgrading.version);
    return null;
  }
  transaction(names: string | string[], mode: IDBTransactionMode = 'readonly') {
    if (this.closed) throw new DOMException('Database is closed', 'InvalidStateError');
    const list = Array.isArray(names) ? names : [names];
    for (const name of list) if (!this.state.stores.has(name)) throw new DOMException(`No store ${name}`, 'NotFoundError');
    return new MiniTransaction(this, list, mode);
  }
  close() { this.closed = true; }
}

/** A `indexedDB` lookalike. Databases are loaded once and cached in memory. */
export function createMiniIndexedDb(backend: KvBackend, vault: KeyVault) {
  const env: Env = { backend, vault };
  const loaded = new Map<string, Promise<DbState>>();
  const load = (name: string) => {
    let state = loaded.get(name);
    if (!state) {
      state = backend.load(name).then(data => ({ name, version: data.version,
        stores: new Map(Object.entries(data.stores).map(([store, s]) => [store, { ...(s.keyPath ? { keyPath: s.keyPath } : {}), rows: s.rows }])) }));
      loaded.set(name, state);
    }
    return state;
  };
  return {
    open(name: string, version = 1) {
      const request = new MiniRequest<MiniDatabase>();
      load(name).then(state => {
        if (version < state.version) { request.fail(new DOMException('Requested version is older', 'VersionError')); return; }
        if (version > state.version) {
          const upgrading = new MiniDatabase(env, state, { version });
          request.result = upgrading;
          request.onupgradeneeded?.call(request, { target: request });
          state.version = version;
        }
        request.succeed(new MiniDatabase(env, state, null));
      }, error => request.fail(new DOMException(String(error?.message ?? error), 'UnknownError')));
      return request;
    },
    deleteDatabase(name: string) {
      const request = new MiniRequest<undefined>();
      loaded.delete(name);
      void load(name).then(async state => {
        for (const store of state.stores.keys()) await backend.clear(name, store);
        request.succeed(undefined);
      });
      return request;
    },
  };
}
