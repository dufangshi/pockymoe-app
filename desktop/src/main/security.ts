export function relayOrigin(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('请输入有效的 Relay 地址');
  const url = new URL(value.trim());
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('Relay 地址只能包含协议、主机和端口');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('请使用 HTTPS；本机调试可使用 HTTP');
  return url.origin;
}
export function isRelayFrame(url: string, origin: string, isTop: boolean): boolean {
  try { return isTop && new URL(url).origin === origin; } catch { return false; }
}
export function externalUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try { const url = new URL(value); return ['http:', 'https:', 'mailto:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function threadPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096 || !value.startsWith('/') || value.startsWith('//') || (value.includes('\\') || [...value].some(char => char.charCodeAt(0) < 32))) throw new Error('Invalid thread path');
  return value;
}
export function deepLinkPath(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'remotecodex:' || url.username || url.password) return null;
    return threadPath(`${url.host ? `/${url.host}` : ''}${url.pathname}${url.search}${url.hash}`);
  } catch { return null; }
}
