// WCAG contrast of the text and control colours in every preset and mode. Body text and
// text on filled buttons need 4.5:1; muted/secondary text, status marks and control
// borders need 3:1 (WCAG 1.4.11 non-text contrast and large/secondary text).
import { describe, expect, it } from 'vitest';
import { makeTheme, PRESETS } from '../../src/design/theme';
import { contrast, parseColor } from '../../src/design/contrast';

describe.each(PRESETS.flatMap(p => (['light', 'dark'] as const).map(m => [p, m] as const)))('%s %s', (preset, mode) => {
  const { c } = makeTheme(preset, mode);
  const pairs: [string, string, string, number][] = [];
  // (name, foreground, background key, minimum ratio)
  for (const surface of ['bg', 'panel', 'surface', 'sheet'] as const) {
    pairs.push(['fg', c.fg, surface, 4.5], ['fgSoft', c.fgSoft, surface, 4.5], ['fgMuted', c.fgMuted, surface, 3]);
    pairs.push(['accentStrong (links)', c.accentStrong, surface, 4.5], ['danger text', c.danger, surface, 4.5]);
    pairs.push(['running mark', c.running, surface, 3], ['waiting mark', c.waiting, surface, 3], ['failed mark', c.failed, surface, 3], ['online mark', c.online, surface, 3]);
  }
  pairs.push(['primaryFg', c.primaryFg, 'primarySolid', 4.5], ['white', '#ffffff', 'dangerSolid', 4.5]);
  pairs.push(['warning', c.warning, 'warningBg', 4.5], ['info', c.info, 'infoBg', 4.5], ['danger', c.danger, 'dangerBg', 4.5]);
  it.each(pairs.map(([n, f, b, m]) => [n, b, f, m] as const))('%s on %s (%s)', (_name, bgKey, fg, min) => {
    const bg = (c as Record<string, string>)[bgKey] ?? bgKey;
    const resolvedBg = bg === 'transparent' ? c.bg : bg.startsWith('rgba') ? `#${parseColor(bg, parseColor(c.bg)).map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}` : bg;
    expect(contrast(fg, resolvedBg)).toBeGreaterThanOrEqual(min);
  });
});
