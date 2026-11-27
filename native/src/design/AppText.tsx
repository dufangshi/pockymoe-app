import { Text, type TextProps, type TextStyle } from 'react-native';
import { useTheme, type Colors } from './theme';

export type Variant = 'display' | 'title' | 'headline' | 'body' | 'callout' | 'subhead' | 'footnote' | 'caption' | 'mono' | 'monoSmall';
type Tone = 'fg' | 'soft' | 'muted' | 'primary' | 'accent' | 'danger' | 'warning' | 'success' | 'onPrimary';
const SIZES: Record<Variant, { size: number; line: number; weight: 'regular' | 'medium' | 'semibold' | 'bold' | 'display' | 'mono' }> = {
  display: { size: 28, line: 34, weight: 'display' },
  title: { size: 20, line: 26, weight: 'bold' },
  headline: { size: 16, line: 22, weight: 'semibold' },
  body: { size: 15, line: 22, weight: 'regular' },
  callout: { size: 14, line: 20, weight: 'regular' },
  subhead: { size: 13, line: 18, weight: 'medium' },
  footnote: { size: 12, line: 16, weight: 'regular' },
  caption: { size: 11, line: 14, weight: 'medium' },
  mono: { size: 13, line: 19, weight: 'mono' },
  monoSmall: { size: 12, line: 17, weight: 'mono' },
};
const toneColor = (c: Colors, tone: Tone) => ({ fg: c.fg, soft: c.fgSoft, muted: c.fgMuted, primary: c.primary, accent: c.accentStrong, danger: c.danger,
  warning: c.warning, success: c.success, onPrimary: c.primaryFg }[tone]);

export interface AppTextProps extends TextProps {
  variant?: Variant; tone?: Tone; weight?: 'regular' | 'medium' | 'semibold' | 'bold'; color?: string; center?: boolean;
}
/** Text in the theme's font and scale. Dynamic Type is honoured up to 1.8×. */
export function AppText({ variant = 'body', tone = 'fg', weight, color, center, style, maxFontSizeMultiplier = 1.8, ...rest }: AppTextProps) {
  const t = useTheme();
  const spec = SIZES[variant];
  const family = spec.weight === 'mono' ? t.font.mono : t.font[weight ?? (spec.weight === 'display' ? 'display' as const : spec.weight)];
  const base: TextStyle = { fontFamily: family, fontSize: spec.size, lineHeight: spec.line, color: color ?? toneColor(t.c, tone),
    ...(center ? { textAlign: 'center' } : {}), ...(t.terminal && variant === 'display' ? { fontSize: 22, lineHeight: 28 } : {}) };
  return <Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[base, style]} {...rest} />;
}
