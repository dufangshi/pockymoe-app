import { describe, expect, it } from 'vitest';
import { createMiniIndexedDb, MiniKeyRange } from '../../src/platform/idb/miniIdb';
import { memoryBackend, memoryVault } from '../node/memoryIdb';
import { installRelayFetch, relaySessionToken, useRelay } from '../../src/platform/relaySession';

const req = <T,>(r: { onsuccess: unknown; onerror: unknown; result: T; error: unknown }) => new Promise<T>((done, fail) => { r.onsuccess = () => done(r.result); r.onerror = () => fail(r.error); });

describe('mini IndexedDB', () => {
  it('upgrades, writes in order, completes, counts ranges and walks cursors', async () => {
    const idb = createMiniIndexedDb(memoryBackend().backend, memoryVault().vault);
    const open = idb.open('db', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('s');
    const db = await req(open);
    const tx = db.transaction('s', 'readwrite');
    const store = tx.objectStore('s');
    store.put({ n: 1, bytes: new Uint8Array([1, 2]) }, 'a:1'); store.put({ n: 2 }, 'a:2'); store.put({ n: 3 }, 'b:1');
    const get = store.get('a:1');
    get.onsuccess = () => { store.put({ n: (get.result as { n: number }).n + 10 }, 'a:3'); }; // a request from a handler joins the transaction
    await new Promise<void>(done => { tx.oncomplete = () => done(); });
    const read = db.transaction('s').objectStore('s');
    expect(await req(read.count(MiniKeyRange.bound('a:', 'a:\uffff')))).toBe(3);
    expect(await req(read.get('a:3'))).toEqual({ n: 11 });
    expect((await req(read.get('a:1')) as { bytes: Uint8Array }).bytes).toEqual(new Uint8Array([1, 2]));
    const keys: string[] = [];
    const cursor = db.transaction('s').objectStore('s').openCursor();
    await new Promise<void>(done => { cursor.onsuccess = () => { const c = cursor.result; if (!c) { done(); return; } keys.push(c.key); c.continue(); }; });
    expect(keys).toEqual(['a:1', 'a:2', 'a:3', 'b:1']);
    await expect(req(db.transaction('s', 'readwrite').objectStore('s').add({}, 'a:1') as never)).rejects.toBeDefined();
  });
  it('refuses writes in a read-only transaction', async () => {
    const idb = createMiniIndexedDb(memoryBackend().backend, memoryVault().vault);
    const open = idb.open('db2', 1); open.onupgradeneeded = () => open.result.createObjectStore('s');
    const db = await req(open);
    expect(() => db.transaction('s').objectStore('s').put(1, 'k')).toThrow();
  });
});

describe('relay session transport', () => {
  it('keeps the login token, sends it as Bearer, never adds a cache-buster', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    globalThis.fetch = (async (input: RequestInfo, init?: RequestInit) => {
      const r = new Request(input, init);
      seen.push({ url: r.url, auth: r.headers.get('authorization') });
      return new Response(r.url.endsWith('/relay/auth/login') ? JSON.stringify({ token: 'tok' }) : '{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const saved = new Map<string, string | null>();
    installRelayFetch({ load: async o => saved.get(o) ?? null, save: async (o, t) => { saved.set(o, t); } });
    await useRelay('https://relay.test');
    await fetch('https://relay.test/relay/auth/login', { method: 'POST', body: '{}' });
    expect(relaySessionToken()).toBe('tok');
    expect(saved.get('https://relay.test')).toBe('tok');
    await fetch('https://relay.test/relay/devices/d/api/x', { cache: 'no-store' });
    expect(seen.at(-1)).toEqual({ url: 'https://relay.test/relay/devices/d/api/x', auth: 'Bearer tok' });
    await fetch('https://elsewhere.test/a');
    expect(seen.at(-1)!.auth).toBeNull();
    await fetch('https://relay.test/relay/auth/logout', { method: 'POST' });
    expect(relaySessionToken()).toBeNull();
  });
});
