import { describe, expect, it } from 'vitest';
import { discoverOrigins, type Fetcher } from '../src/main/discovery';
const web = 'https://app.example.test', relay = 'https://relay.example.test';
const fixture = (routes: Record<string, [string, number?, Record<string, string>?]>): Fetcher => async (url, init) => {
  expect(init?.credentials).toBe('omit'); expect(init?.redirect).toBe('manual');
  const route = routes[url]; return new Response(route?.[0] || '', { status: route?.[1] || 404, headers: route?.[2] });
};
describe('origin discovery', () => {
  it('reads the Pages build metadata and validates the separate relay health', async () => {
    expect(await discoverOrigins(web, fixture({ [`${web}/`]: ['<html><script type="module"></script></html>', 200], [`${web}/STATIC_HOSTING.txt`]: [`Relay API origin: ${relay}\n`, 200], [`${relay}/healthz`]: ['{"status":"ok"}', 200] }))).toEqual({ webOrigin: web, relayOrigin: relay });
  });
  it('discovers an API-only relay through its configured Web redirect and CSP', async () => {
    const routes: Record<string, [string, number?, Record<string, string>?]> = {
      [`${relay}/`]: ['', 307, { location: web }],
      [`${web}/`]: [`<html><meta http-equiv="Content-Security-Policy" content="connect-src 'self' ${relay} wss://relay.example.test;"></html>`, 200],
      [`${relay}/healthz`]: ['{"status":"ok"}', 200]
    };
    expect(await discoverOrigins(relay, fixture(routes))).toEqual({ webOrigin: web, relayOrigin: relay });
  });
  it('keeps a same-origin local relay working', async () => {
    const local = 'http://127.0.0.1:18999';
    expect(await discoverOrigins(local, fixture({ [`${local}/`]: ['<html>Pockymoe</html>', 200], [`${local}/healthz`]: ['{"status":"ok"}', 200] }))).toEqual({ webOrigin: local, relayOrigin: local });
  });
  it('rejects malformed metadata and insecure redirects instead of guessing', async () => {
    await expect(discoverOrigins(web, fixture({ [`${web}/`]: ['<html></html>', 200], [`${web}/STATIC_HOSTING.txt`]: ['Relay API origin: http://remote.example.test', 200] }))).rejects.toThrow();
    await expect(discoverOrigins(web, fixture({ [`${web}/`]: ['', 302, { location: 'file:///tmp/a' }] }))).rejects.toThrow();
    await expect(discoverOrigins(web, fixture({ [`${web}/`]: ['<html></html>', 200] }))).rejects.toThrow('高级');
  });
});
