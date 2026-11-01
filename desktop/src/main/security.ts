import { t } from '../shared/i18n';
export function relayOrigin(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error(t('请输入有效的 Pockymoe 地址'));
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error(t('请输入有效的 Pockymoe 地址')); }
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error(t('地址只能包含协议、主机和端口'));
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error(t('请使用 HTTPS；本机调试可使用 HTTP'));
  return url.origin;
}
export function isWebFrame(url: string, origin: string, isTop: boolean): boolean {
  try { return isTop && new URL(url).origin === origin; } catch { return false; }
}
/** A step of the relay's Google or GitHub sign-in, which must finish in the app's own session. */
export function isSignInUrl(url: string, relayOrigin: string): boolean {
  try {
    const u = new URL(url);
    if (u.origin === relayOrigin) return /^\/relay\/auth\/oauth\/[^/]+\/start$/.test(u.pathname);
    return u.protocol === 'https:' && (u.hostname === 'accounts.google.com' || (u.hostname === 'github.com' && u.pathname.startsWith('/login')));
  } catch { return false; }
}
export function externalUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try { const url = new URL(value); return ['http:', 'https:', 'mailto:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function threadPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096 || !value.startsWith('/') || value.startsWith('//') || (value.includes('\\') || [...value].some(char => char.charCodeAt(0) < 32))) throw new Error(t('线程路径无效'));
  return value;
}
export function deepLinkPath(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['pockymoe:', 'remotecodex:'].includes(url.protocol) || url.username || url.password) return null;
    return threadPath(`${url.host ? `/${url.host}` : ''}${url.pathname}${url.search}${url.hash}`);
  } catch { return null; }
}
