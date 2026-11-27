// "1.3K", "12K", "2.5M": a token count, compact (the shared UI's formatCompactTokenCount).
export function formatCompactTokens(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0';
  for (const [size, unit] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']] as const) {
    if (value >= size) {
      const scaled = value >= size * 10 ? Math.round(value / size) : value / size;
      return `${scaled.toFixed(1).replace(/\.0$/, '')}${unit}`;
    }
  }
  return String(Math.round(value));
}
