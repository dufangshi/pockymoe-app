import { getLocale, translate } from '../../i18n';

/**
 * One way to write a length of time everywhere a thread shows one (turn head,
 * work line, work segments, progress hints, thread map tips): "39m 24s" in
 * English, "39 分 24 秒" in Chinese. Hours drop the seconds. Token counts use
 * upper-case K/M/B (tokenFormatting), so a lower-case "m" only ever means minutes.
 */
export function formatDurationSeconds(totalSeconds: number, { pad = true }: { pad?: boolean } = {}) {
  const total = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  // English pads the smaller unit so a ticking clock keeps its width; Chinese reads better unpadded.
  const two = (value: number) => (pad && !getLocale().startsWith('zh') ? String(value).padStart(2, '0') : String(value));
  if (hours > 0) return translate('chat.durationHours', { hours, minutes: two(minutes) });
  if (minutes > 0) return translate('chat.durationMinutes', { minutes, seconds: two(seconds) });
  return translate('chat.durationSeconds', { seconds });
}

export function formatDurationMs(ms: number, options?: { pad?: boolean }) {
  return formatDurationSeconds(Math.round(ms / 1000), options);
}
