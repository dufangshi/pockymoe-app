import type { ComponentType, ReactNode } from 'react';
import { ActivityIndicator, useWindowDimensions, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import type { LucideProps } from 'lucide-react-native';
import { Press } from './Press';
import { AppText } from './AppText';
import { useTheme } from './theme';

type Kind = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerOutline';
export interface ButtonProps {
  label: string; onPress?: () => void; kind?: Kind; icon?: ComponentType<LucideProps>; busy?: boolean; disabled?: boolean;
  size?: 'md' | 'sm'; style?: StyleProp<ViewStyle>; accessibilityHint?: string; trailing?: ReactNode; testID?: string;
}
/** One button look per kind. Labels never wrap (§9); busy keeps the width. */
export function Button({ label, onPress, kind = 'secondary', icon: Icon, busy, disabled, size = 'md', style, accessibilityHint, trailing, testID }: ButtonProps) {
  const t = useTheme();
  const c = t.c;
  const palette = {
    primary: { bg: c.primarySolid, fg: c.primaryFg, border: c.primarySolid },
    secondary: { bg: c.surface, fg: c.fg, border: c.borderStrong },
    ghost: { bg: 'transparent', fg: c.fgSoft, border: 'transparent' },
    danger: { bg: c.dangerSolid, fg: '#ffffff', border: c.dangerSolid },
    // A dangerous entry that is not the card's main action (§11, §15): red outline and text.
    dangerOutline: { bg: 'transparent', fg: c.danger, border: c.dangerBorder },
  }[kind];
  const height = size === 'md' ? 44 : 36;
  return (
    <Press testID={testID} onPress={busy ? undefined : onPress} disabled={disabled} feedback="dim" accessibilityRole="button" accessibilityLabel={label}
      accessibilityHint={accessibilityHint} accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      style={[{ height, paddingHorizontal: size === 'md' ? 16 : 12, borderRadius: t.radius.md, backgroundColor: palette.bg, borderWidth: t.terminal || kind === 'secondary' || kind === 'dangerOutline' ? 1 : 0,
        borderColor: palette.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, style]}>
      {busy ? <ActivityIndicator size="small" color={palette.fg} /> : Icon ? <Icon size={size === 'md' ? 18 : 16} color={palette.fg} strokeWidth={2} /> : null}
      <AppText variant={size === 'md' ? 'callout' : 'subhead'} weight="semibold" color={palette.fg} numberOfLines={1}>{t.terminal && kind === 'primary' ? `[ ${label} ]` : label}</AppText>
      {trailing}
    </Press>
  );
}

/** Icon-only control with a 44 pt target and an accessible name. */
export function IconButton({ icon: Icon, label, onPress, size = 20, tone = 'soft', active, disabled, badge, style, testID, onLongPress }: {
  icon: ComponentType<LucideProps>; label: string; onPress?: (e: GestureResponderEvent) => void; size?: number; tone?: 'fg' | 'soft' | 'muted' | 'primary' | 'danger' | 'onPrimary' | 'onImage';
  active?: boolean; disabled?: boolean; badge?: ReactNode; style?: StyleProp<ViewStyle>; testID?: string; onLongPress?: () => void;
}) {
  const t = useTheme();
  // Icons grow a little with large text so they stay in proportion to the labels around them.
  const scale = Math.min(Math.max(useWindowDimensions().fontScale, 1), 1.3);
  const color = { fg: t.c.fg, soft: t.c.fgSoft, muted: t.c.fgMuted, primary: t.c.primary, danger: t.c.failed, onPrimary: t.c.primaryFg, onImage: '#ffffff' }[tone];
  return (
    <Press testID={testID} onPress={onPress} onLongPress={onLongPress} disabled={disabled} feedback="dim" accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!active }} hitSlop={2}
      style={[{ minWidth: 44, minHeight: 44, width: Math.round(44 * Math.min(scale, 1.15)), height: Math.round(44 * Math.min(scale, 1.15)), borderRadius: t.radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? t.c.hover : 'transparent' }, style]}>
      <Icon size={Math.round(size * scale)} color={color} strokeWidth={t.terminal ? 1.75 : 2} />
      {badge ? <View style={{ position: 'absolute', top: 4, right: 4 }} pointerEvents="none">{badge}</View> : null}
    </Press>
  );
}
