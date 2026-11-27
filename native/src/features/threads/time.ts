import { getLocale } from '../../i18n';
/** Short relative time for lists: "now", "5m", "3h", "2d", then a date. */
export function relativeTime(value: string | null | undefined, now = Date.now()) {
  if (!value) return '';
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return '';
  const s = Math.max(0, (now - at) / 1000);
  const zh = getLocale() === 'zh-CN';
  if (s < 60) return zh ? '刚刚' : 'now';
  if (s < 3600) return zh ? `${Math.floor(s / 60)} 分钟前` : `${Math.floor(s / 60)}m`;
  if (s < 86400) return zh ? `${Math.floor(s / 3600)} 小时前` : `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return zh ? `${Math.floor(s / 86400)} 天前` : `${Math.floor(s / 86400)}d`;
  const d = new Date(at);
  return zh ? `${d.getMonth() + 1}月${d.getDate()}日` : d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}
