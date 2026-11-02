import { createHash } from 'node:crypto';

const WINDOWS_ID_LIMIT = 64;
/** Windows refuses longer notification and group ids, and ours join two UUIDs. The hash stays stable, so a repeat still replaces its toast. */
export function nativeNotificationId(id: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32' || id.length <= WINDOWS_ID_LIMIT) return id;
  return `pm-${createHash('sha256').update(id).digest('hex').slice(0, 40)}`;
}
const xml = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
export function toastXml(token: string, title: string, context: string, body: string, buttons: string[], icon: string, silent = false): string {
  const target = `pockymoe://notification/${token}`;
  return `<toast launch="${target}/open" activationType="protocol"><visual><binding template="ToastGeneric"><image placement="appLogoOverride" src="${xml(icon)}"/><text>${xml(title)}</text><text>${xml([context, body].filter(Boolean).join(' · '))}</text></binding></visual><actions>${buttons.map((label, index) => `<action content="${xml(label)}" arguments="${target}/${index}" activationType="protocol"/>`).join('')}</actions>${silent ? '<audio silent="true"/>' : ''}</toast>`;
}
export function toastActivation(url: string): { token: string; action: string } | null {
  try {
    const parsed = new URL(url), match = /^\/([a-f0-9-]{36})\/(open|[0-2])$/.exec(parsed.pathname);
    return parsed.protocol === 'pockymoe:' && parsed.hostname === 'notification' && !parsed.search && !parsed.hash && match ? { token: match[1], action: match[2] } : null;
  } catch { return null; }
}
