// Web APIs the vendored protocol code expects, provided before any other module loads.
// Crypto is native (react-native-quick-crypto, OpenSSL), not JavaScript.
import 'react-native-url-polyfill/auto';
import { install } from 'react-native-quick-crypto';
import { ReadableStream } from 'web-streams-polyfill';
import { Event as ShimEvent, EventTarget as ShimEventTarget } from 'event-target-shim';

install();

const g = globalThis as Record<string, unknown>;
if (typeof g.ReadableStream === 'undefined') g.ReadableStream = ReadableStream;
if (typeof g.EventTarget === 'undefined') g.EventTarget = ShimEventTarget;
if (typeof g.Event === 'undefined') g.Event = ShimEvent;
if (typeof g.CustomEvent === 'undefined') {
  class CustomEvent<T = unknown> extends (g.Event as typeof ShimEvent) {
    readonly detail: T;
    constructor(type: string, init?: { detail?: T }) { super(type); this.detail = init?.detail as T; }
  }
  g.CustomEvent = CustomEvent;
}

// The vendored account code listens on `window` for logout and revocation events and
// dispatches unlock requests there. React Native has a `window` global without events.
const bus = new (g.EventTarget as typeof ShimEventTarget)();
const w = (g.window ?? g) as Record<string, unknown>;
if (typeof w.addEventListener !== 'function') {
  w.addEventListener = bus.addEventListener.bind(bus);
  w.removeEventListener = bus.removeEventListener.bind(bus);
  w.dispatchEvent = bus.dispatchEvent.bind(bus);
}

// Build-time environment for vendored Vite code (`import.meta.env`, see babel/import-meta-env.cjs).
g.__POCKYMOE_ENV__ = g.__POCKYMOE_ENV__ ?? {};
if (typeof g.DOMException === 'undefined') {
  class DOMException extends Error { constructor(message = '', readonly name = 'Error') { super(message); } }
  g.DOMException = DOMException;
}
// Vendored Web code reads the page location (tour routes, relative URLs). The app has no
// page: a fixed origin that is never a relay or device address.
if (!(w as { location?: unknown }).location) {
  const location = { origin: 'http://localhost', href: 'http://localhost/', protocol: 'http:', host: 'localhost', hostname: 'localhost', port: '', pathname: '/', search: '', hash: '' };
  (w as Record<string, unknown>).location = location;
  if (!g.location) g.location = location;
}
// Hermes has no Intl.PluralRules. The app speaks English and Chinese: English has
// one/other for cardinals, Chinese only other.
const intl = (g.Intl ?? (g.Intl = {})) as Record<string, unknown>;
if (typeof intl.PluralRules !== 'function') {
  class PluralRules {
    private readonly zh: boolean;
    constructor(locale?: string | string[]) { const tag = Array.isArray(locale) ? locale[0] : locale; this.zh = /^zh/i.test(tag ?? ''); }
    select(n: number) { return !this.zh && Math.abs(n) === 1 ? 'one' : 'other'; }
    resolvedOptions() { return { locale: this.zh ? 'zh-CN' : 'en', type: 'cardinal' }; }
    static supportedLocalesOf(locales: string[]) { return locales; }
  }
  intl.PluralRules = PluralRules;
}
