import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { AccessibilityInfo, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import type { LucideProps } from 'lucide-react-native';
import { Check, ChevronRight } from 'lucide-react-native';
import { translate } from '../i18n';
import { useIconSize } from './useIconScale';
import { Press } from './Press';
import { AppText } from './AppText';
import { useTheme } from './theme';

/** A titled group of rows (settings, device details). */
export function Section({ title, footer, children, style, accessory }: { title?: string; footer?: string; children: ReactNode; style?: StyleProp<ViewStyle>; accessory?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[{ marginBottom: 18 }, style]}>
      {title ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 6, minHeight: 18 }}>
          <AppText variant="subhead" weight="bold" tone="soft" accessibilityRole="header">{t.terminal ? `# ${title}` : title}</AppText>
          {accessory}
        </View>
      ) : null}
      <View style={{ marginHorizontal: 12, backgroundColor: t.c.panel, borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.c.border, overflow: 'hidden' }}>{children}</View>
      {footer ? <AppText variant="footnote" tone="muted" style={{ marginHorizontal: 16, marginTop: 6 }}>{footer}</AppText> : null}
    </View>
  );
}

export interface RowProps {
  title: string; subtitle?: string | null; icon?: ComponentType<LucideProps>; leading?: ReactNode; trailing?: ReactNode; value?: string | null;
  onPress?: () => void; onLongPress?: () => void; chevron?: boolean; destructive?: boolean; selected?: boolean; last?: boolean; disabled?: boolean;
  accessibilityLabel?: string; numberOfLines?: number; testID?: string;
}
export function Row({ title, subtitle, icon: Icon, leading, trailing, value, onPress, onLongPress, chevron, destructive, selected, last, disabled, accessibilityLabel, numberOfLines = 1, testID }: RowProps) {
  const t = useTheme();
  const iconSize = useIconSize(19);
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 14, paddingVertical: 9, gap: 12,
      backgroundColor: selected ? t.c.accentSoft : 'transparent' }}>
      {leading ?? (Icon ? <Icon size={iconSize} color={destructive ? t.c.failed : t.c.fgSoft} strokeWidth={2} /> : null)}
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText variant="callout" weight="medium" color={destructive ? t.c.failed : undefined} numberOfLines={numberOfLines}>{title}</AppText>
        {subtitle ? <AppText variant="footnote" tone="muted" numberOfLines={2}>{subtitle}</AppText> : null}
      </View>
      {value ? <AppText variant="subhead" tone="muted" numberOfLines={1} style={{ maxWidth: '45%' }}>{value}</AppText> : null}
      {trailing}
      {chevron ? <ChevronRight size={18} color={t.c.fgMuted} /> : null}
    </View>
  );
  return (
    <View>
      {onPress || onLongPress ? <Press testID={testID} onPress={onPress} onLongPress={onLongPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? [title, subtitle, value].filter(Boolean).join(', ')} accessibilityState={{ selected: !!selected }}>{body}</Press> : body}
      {last ? null : <View style={{ height: 1, backgroundColor: t.c.border, marginLeft: Icon || leading ? 45 : 14 }} />}
    </View>
  );
}

/** "Saved" beside a setting for a moment after it changed (ui-principles §15). Pass the
 *  time of the last change; 0 shows nothing. Announced to screen readers. */
export function SavedMark({ at }: { at: number }) {
  const t = useTheme();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!at) return;
    setShown(true);
    AccessibilityInfo.announceForAccessibility(translate('native.saved'));
    const timer = setTimeout(() => setShown(false), 1600);
    return () => clearTimeout(timer);
  }, [at]);
  if (!shown) return null;
  return (
    <Animated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(220)} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <Check size={13} color={t.c.success} strokeWidth={2.5} />
      <AppText variant="caption" color={t.c.success}>{translate('native.saved')}</AppText>
    </Animated.View>
  );
}
