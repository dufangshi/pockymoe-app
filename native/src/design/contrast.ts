// WCAG contrast and the one adjustment the themes make: a colour that falls short on its
// background is darkened (light surfaces) or lightened (dark surfaces) in small steps,
// keeping its hue, until it reaches the ratio. Packs keep their palette everywhere else.
function channel(v: number) { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
export function parseColor(color: string, over: number[] = [255, 255, 255]): number[] {
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1]!.slice(i, i + 2), 16));
  const short = color.match(/^#([0-9a-f]{3})$/i);
  if (short) return [0, 1, 2].map(i => parseInt(short[1]![i]!.repeat(2), 16));
  const rgba = color.match(/rgba?\(([^)]+)\)/);
  if (!rgba) return over;
  const [r, g, b, a = 1] = rgba[1]!.split(',').map(Number) as number[];
  return [r!, g!, b!].map((c, i) => c * a + over[i]! * (1 - a));
}
const luminance = (rgb: number[]) => 0.2126 * channel(rgb[0]!) + 0.7152 * channel(rgb[1]!) + 0.0722 * channel(rgb[2]!);
const toHex = (rgb: number[]) => `#${rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

export function contrast(fg: string, bg: string) {
  const back = parseColor(bg);
  const a = luminance(parseColor(fg, back)), b = luminance(back);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** `fg` itself when it already reads on every background; otherwise the nearest shade that does. */
export function ensureContrast(fg: string, backgrounds: string[], min: number) {
  if (backgrounds.every(bg => contrast(fg, bg) >= min)) return fg;
  const darkBack = luminance(parseColor(backgrounds[0]!)) < 0.2;
  const start = parseColor(fg);
  const target = darkBack ? [255, 255, 255] : [0, 0, 0];
  for (let step = 1; step <= 50; step++) {
    const mix = step / 50;
    const candidate = toHex(start.map((c, i) => c + (target[i]! - c) * mix));
    if (backgrounds.every(bg => contrast(candidate, bg) >= min)) return candidate;
  }
  return toHex(target);
}

/** A fill under `text`: darkened (or lightened) until the text reads at `min`. */
export function ensureFill(fill: string, text: string, min: number) {
  if (contrast(text, fill) >= min) return fill;
  const towards = luminance(parseColor(text)) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  const start = parseColor(fill);
  for (let step = 1; step <= 50; step++) {
    const candidate = toHex(start.map((c, i) => c + (towards[i]! - c) * (step / 50)));
    if (contrast(text, candidate) >= min) return candidate;
  }
  return toHex(towards);
}

/** `a` mixed with `b` (0 = a, 1 = b), over `under` where either is translucent. */
export function mixColor(a: string, b: string, amount: number, under = '#ffffff') {
  const base = parseColor(under);
  const x = parseColor(a, base), y = parseColor(b, base);
  return toHex(x.map((v, i) => v + (y[i]! - v) * amount));
}
/** `color` at `alpha` opacity, as rgba(). */
export function withAlpha(color: string, alpha: number) {
  const [r, g, b] = parseColor(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
