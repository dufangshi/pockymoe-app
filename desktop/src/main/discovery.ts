import { t } from '../shared/i18n';
import { relayOrigin as origin } from './security';
export interface OriginPair { webOrigin: string; relayOrigin: string }
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
const MAX_BYTES = 2 * 1024 * 1024;
async function read(fetcher: Fetcher, url: string): Promise<{ text: string; url: string; type: string } | null> {
  try {
    for (let redirects = 0; redirects < 4; redirects++) {
      const response = await fetcher(url, { credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(3500) });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = new URL(response.headers.get('location') || '', url);
        origin(next.origin); if (next.username || next.password) return null;
        url = next.href; continue;
      }
      if (!response.ok || Number(response.headers.get('content-length')) > MAX_BYTES) return null;
      const reader = response.body?.getReader(); if (!reader) return null;
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length; if (size > MAX_BYTES) { await reader.cancel(); return null; } chunks.push(value);
      }
      return { text: Buffer.concat(chunks).toString('utf8'), url, type: response.headers.get('content-type') || '' };
    }
  } catch { /* Discovery failure is reported once, beside the connection form. */ }
  return null;
}
async function healthy(fetcher: Fetcher, base: string): Promise<boolean> {
  const result = await read(fetcher, `${base}/healthz`);
  try { return !!result && JSON.parse(result.text).status === 'ok'; } catch { return false; }
}
/** Pages staticHosting.ts publishes VITE_POCKYMOE_RELAY_ORIGIN in this text file
 * and the HTML meta CSP. API-only relay roots redirect to POCKYMOE_WEB_ORIGIN. */
export async function discoverOrigins(input: string, fetcher: Fetcher = fetch, relayOverride?: string): Promise<OriginPair> {
  const entered = origin(input);
  const page = await read(fetcher, `${entered}/`);
  if (!page || !/<(?:html|script|head)\b/i.test(page.text) || !/Pockymoe/i.test(page.text)) throw new Error(t('无法连接此 Pockymoe 地址，请检查后重试。'));
  const webOrigin = origin(new URL(page.url).origin);
  if (relayOverride) {
    const relay = origin(relayOverride);
    if (!await healthy(fetcher, relay)) throw new Error(t('无法连接此 Relay 地址，请检查后重试。'));
    return { webOrigin, relayOrigin: relay };
  }
  // A typed API root is authoritative when it redirects to the Web.
  if (webOrigin !== entered && await healthy(fetcher, entered)) return { webOrigin, relayOrigin: entered };
  if (webOrigin === entered && await healthy(fetcher, entered)) return { webOrigin, relayOrigin: entered };
  const metadata = await read(fetcher, `${webOrigin}/STATIC_HOSTING.txt`);
  const configured = metadata?.text.match(/^Relay API origin:\s*(https?:\/\/[^\s]+)\s*$/m)?.[1];
  const candidates = new Set<string>();
  if (configured) candidates.add(origin(configured));
  // The generated CSP's connect-src contains the API origin and its WebSocket.
  for (const tag of page.text.match(/<meta\b[^>]+>/gi) || []) {
    if (!/http-equiv\s*=\s*["']Content-Security-Policy["']/i.test(tag)) continue;
    const csp = tag.match(/content\s*=\s*"([^"]*)"/i)?.[1] || tag.match(/content\s*=\s*'([^']*)'/i)?.[1] || '';
    const connect = csp.match(/(?:^|;)\s*connect-src\s+([^;]+)/i)?.[1] || '';
    for (const token of connect.split(/\s+/)) if (/^https?:\/\//.test(token)) { try { candidates.add(origin(token)); } catch { /* Ignore non-origin CSP sources. */ } }
  }
  if (webOrigin !== entered) candidates.add(entered);
  candidates.add(webOrigin);
  for (const relay of [...candidates].slice(0, 6)) if (await healthy(fetcher, relay)) return { webOrigin, relayOrigin: relay };
  throw new Error(t('无法发现 Relay，请检查地址或填写高级设置。'));
}
