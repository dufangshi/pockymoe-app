// The turn head's numbers, ported from the shared UI (components/timeline/tokenFormatting.tsx,
// TurnModels.tsx at 747524d). Those modules also hold DOM components, so
// they are not vendored; these functions are kept identical.

/** "$0.050", "$1.2", "<$0.001": a turn's cost, compact. */
export function formatCompactUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '$0';
  if (value >= 100) return `$${Math.round(value)}`;
  if (value >= 10) return `$${String(value.toFixed(1)).replace(/\.0$/, '')}`;
  if (value >= 1) return `$${String(value.toFixed(2)).replace(/0$/, '').replace(/\.$/, '')}`;
  if (value >= 0.1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  if (value >= 0.001) return `$${value.toFixed(4)}`;
  return '<$0.001';
}

/** "18K", "1.2M": a token count, compact. */
export function formatCompactTokenCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0';
  const unit = (n: number, d: number, s: string) => `${String((n >= d * 10 ? Math.round(n / d) : n / d).toFixed(1)).replace(/\.0$/, '')}${s}`;
  if (value >= 1_000_000_000) return unit(value, 1_000_000_000, 'B');
  if (value >= 1_000_000) return unit(value, 1_000_000, 'M');
  if (value >= 1_000) return unit(value, 1_000, 'K');
  return String(Math.round(value));
}

/** "claude-opus-5-5" reads "opus 5.5" and "gpt-6-astra" "6 astra": the vendor part goes, a
 *  date stamp goes, and numbered parts join into a version. */
export function shortModelName(model: string) {
  const parts = model.split('-').filter(Boolean);
  if (parts.length < 2) return model;
  const words: string[] = [];
  for (const part of parts.slice(1)) {
    if (/^\d{8}$/.test(part)) continue;
    const previous = words.at(-1);
    if (previous && /^\d+(\.\d+)*$/.test(part) && /^\d+(\.\d+)*$/.test(previous)) words[words.length - 1] = `${previous}.${part}`;
    else words.push(part);
  }
  return words.length ? words.join(' ') : model;
}

/** The file family colours of attachment tiles (attachments.css); `other` is the text grey. */
export const FILE_FAMILY_COLOR: Record<string, string> = {
  pdf: '#e5484d', image: '#3b8fe0', archive: '#d0921d', code: '#2b9e6a', text: '#6b7c8c', sheet: '#1f9254', doc: '#3e63dd', audio: '#9b55d0', video: '#d0457a', other: '#6b7c8c',
};
