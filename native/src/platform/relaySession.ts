// The relay session of a native client. The relay accepts its session token as
// `Authorization: Bearer` from explicit native clients (no cookies, no Origin header);
// browsers use an HttpOnly cookie instead. Login, registration, recovery and factor
// challenges answer with `{ token }`; this wrapper keeps it, so the vendored Web auth
// code runs unchanged on top of `fetch`.
export interface TokenStore { load(origin: string): Promise<string | null>; save(origin: string, token: string | null): Promise<void> }

const SESSION_PATHS = /^\/relay\/auth\/(login|register|recover|challenge|mobile\/exchange)$/;
let relayOrigin: string | null = null;
let token: string | null = null;
let store: TokenStore | null = null;
const listeners = new Set<(signedIn: boolean) => void>();

export function relaySessionToken() { return token; }
export function onRelaySessionChange(listener: (signedIn: boolean) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
async function setToken(next: string | null) {
  if (next === token) return;
  token = next;
  if (relayOrigin) await store?.save(relayOrigin, next);
  listeners.forEach(listener => listener(!!next));
}
/** Selects the relay this app talks to and restores its saved session. */
export async function useRelay(origin: string | null) {
  relayOrigin = origin; token = null;
  if (origin && store) token = await store.load(origin);
  listeners.forEach(listener => listener(!!token));
}
export async function clearRelaySession() { await setToken(null); }

export function installRelayFetch(tokens: TokenStore) {
  store = tokens;
  const raw = globalThis.fetch.bind(globalThis);
  const relayFetch: typeof fetch = async (input, init) => {
    // React Native's whatwg-fetch appends `_=<time>` to GET URLs with cache 'no-store'.
    // A sealed request authenticates its path, so the cache mode must not reach it.
    const { cache: _cache, ...rest } = init ?? {};
    const request = new Request(input as RequestInfo, rest);
    const url = new URL(request.url);
    if (!relayOrigin || url.origin !== relayOrigin) return raw(request);
    const headers = new Headers(request.headers);
    if (token && !headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
    // The second-factor step is bound to a short-lived HttpOnly cookie that login sets.
    const credentials = url.pathname === '/relay/auth/challenge' || url.pathname === '/relay/auth/login' ? 'include' : 'omit';
    const response = await raw(request.url, { method: request.method, headers, credentials,
      signal: request.signal, ...(body && body.byteLength ? { body } : body ? { body: '' } : {}) });
    if (__DEV__) console.log('[relay]', request.method, url.pathname, response.status, token ? 'bearer' : 'anon', response.status >= 400 ? await response.clone().text().then(t => t.slice(0, 200)).catch(() => '') : '');
    if (request.method === 'POST' && SESSION_PATHS.test(url.pathname) && response.ok) {
      const data = await response.clone().json().catch(() => null) as { token?: unknown } | null;
      if (typeof data?.token === 'string' && data.token) await setToken(data.token);
    }
    if (url.pathname === '/relay/auth/logout' && request.method === 'POST') await setToken(null);
    if (url.pathname === '/relay/auth/session' && response.status === 401) await setToken(null);
    return response;
  };
  globalThis.fetch = relayFetch;
}

/** RN's WebSocket takes headers as a third argument; the relay authenticates native sockets by bearer. */
export function relaySocketHeaders(url: string): Record<string, string> {
  const target = new URL(url.replace(/^ws/, 'http'));
  return relayOrigin && target.origin === relayOrigin && token ? { authorization: `Bearer ${token}` } : {};
}
