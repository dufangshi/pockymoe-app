import { describe, expect, it } from 'vitest';
import { deepLinkPath, externalUrl, isSignInUrl, isWebFrame, relayOrigin, threadPath } from '../src/main/security';
import { validateSettings } from '../src/main/store';
describe('origin and navigation guard', () => {
  it('recognizes only sign-in steps as belonging in the sign-in window', () => {
    const relay = 'https://app.example.com';
    for (const url of [`${relay}/relay/auth/oauth/google/start?x=1`, `${relay}/relay/auth/oauth/github/start`, 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x', 'https://github.com/login/oauth/authorize?client_id=x']) expect(isSignInUrl(url, relay)).toBe(true);
    for (const url of [`${relay}/relay/account`, `https://app.example.com.attacker.test/relay/auth/oauth/google/start`, 'https://github.com/dufangshi/pockymoe', 'http://accounts.google.com/', 'https://accounts.google.com.attacker.test/', 'not a url']) expect(isSignInUrl(url, relay)).toBe(false);
  });
  it('allows exact origins only in the top frame', () => {
    const origin = 'https://app.example.com';
    expect(isWebFrame(`${origin}/devices`, origin, true)).toBe(true);
    for (const url of ['https://app.example.com.attacker.test', 'http://app.example.com', 'https://app.example.com:444', 'file:///tmp/test', 'not a url']) expect(isWebFrame(url, origin, true)).toBe(false);
    expect(isWebFrame(origin, origin, false)).toBe(false);
  });
  it('accepts HTTPS or loopback HTTP origins without credentials, paths or queries', () => {
    expect(relayOrigin('https://app.example.com/')).toBe('https://app.example.com');
    expect(relayOrigin('http://127.0.0.1:43210')).toBe('http://127.0.0.1:43210');
    expect(relayOrigin('http://localhost:43210')).toBe('http://localhost:43210');
    expect(relayOrigin('http://[::1]:43210')).toBe('http://[::1]:43210');
    for (const url of ['http://example.com', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com?x=1', 'https://example.com#x', 'file:///tmp/a']) expect(() => relayOrigin(url)).toThrow();
  });
  it('restricts external protocols and internal paths', () => {
    expect(externalUrl('mailto:hello@example.com')).toBe('mailto:hello@example.com');
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'remotecodex://devices', 'https://a:b@example.com']) expect(externalUrl(url)).toBeNull();
    for (const path of ['//attacker.test', '/\\attacker.test', 'https://example.com', '/a\n']) expect(() => threadPath(path)).toThrow();
    expect(deepLinkPath('pockymoe://devices/mac/threads/thread-1')).toBe('/devices/mac/threads/thread-1');
    expect(deepLinkPath('remotecodex:///devices/mac')).toBe('/devices/mac');
  });
  it('strictly validates settings patches', () => {
    expect(validateSettings({ petMini: true, snoozeUntil: null })).toEqual({ petMini: true, snoozeUntil: null });
    for (const patch of [{ petMini: 1 }, { unknown: true }, { alertMode: 'everything' }, { petId: '../bad' }]) expect(() => validateSettings(patch)).toThrow();
  });
});
