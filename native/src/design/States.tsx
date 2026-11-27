import { useEffect, type ComponentType, type ReactNode } from 'react';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { translate } from '../i18n';
import { ActivityIndicator, View } from 'react-native';
import type { LucideProps } from 'lucide-react-native';
import { AlertTriangle, Info, WifiOff } from 'lucide-react-native';
import { AppText } from './AppText';
import { PocketFriends } from './PackArt';
import { Button } from './Button';
import { useTheme } from './theme';

export function EmptyState({ icon: Icon, title, body, action, children }: { icon?: ComponentType<LucideProps>; title: string; body?: string; action?: { label: string; onPress: () => void; icon?: ComponentType<LucideProps> }; children?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 }}>
      {/* Plum Pocket puts its pocket friends where other presets show the icon. */}
      {t.plum ? <PocketFriends /> : Icon ? <View style={{ width: 56, height: 56, borderRadius: t.radius.xl, backgroundColor: t.c.surface, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}><Icon size={26} color={t.c.fgMuted} /></View> : null}
      <AppText variant="headline" center>{title}</AppText>
      {body ? <AppText variant="callout" tone="muted" center style={{ maxWidth: 340 }}>{body}</AppText> : null}
      {action ? <Button label={action.label} icon={action.icon} onPress={action.onPress} kind="primary" style={{ marginTop: 8 }} /> : null}
      {children}
    </View>
  );
}

/** An inline notice with an optional action; tone picks the colour and icon. */
export function Banner({ tone = 'info', text, action, icon }: { tone?: 'info' | 'warning' | 'danger' | 'offline'; text: string; action?: { label: string; onPress: () => void }; icon?: ComponentType<LucideProps> }) {
  const t = useTheme();
  const palette = { info: [t.c.infoBg, t.c.info], warning: [t.c.warningBg, t.c.warning], danger: [t.c.dangerBg, t.c.danger], offline: [t.c.warningBg, t.c.warning] }[tone];
  const Icon = icon ?? (tone === 'offline' ? WifiOff : tone === 'info' ? Info : AlertTriangle);
  return (
    <View accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: t.radius.md, backgroundColor: palette[0], borderWidth: 1, borderColor: t.c.border }}>
      <Icon size={16} color={palette[1]} />
      <AppText variant="subhead" color={palette[1]} style={{ flex: 1 }}>{text}</AppText>
      {action ? <Button label={action.label} onPress={action.onPress} size="sm" kind="ghost" /> : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }} accessibilityLabel={label} accessibilityRole="progressbar">
      <ActivityIndicator color={t.c.primary} />
      {label ? <AppText variant="footnote" tone="muted">{label}</AppText> : null}
    </View>
  );
}

/** Placeholder rows while a list loads for the first time: the shape of what is coming,
 *  so nothing jumps when it arrives. A short request may pulse (ui-principles §6); with
 *  reduced motion it stays still. */
export function SkeletonRows({ rows = 6, header = true }: { rows?: number; header?: boolean }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(withTiming(0.45, { duration: 700, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(pulse);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const bar = (width: number | `${number}%`, height = 10) => <View style={{ width, height, borderRadius: t.terminal ? 0 : height / 2, backgroundColor: t.c.muted }} />;
  return (
    <Animated.View style={[{ paddingHorizontal: 18, paddingTop: 14, gap: 18 }, style]} accessibilityRole="progressbar" accessibilityLabel={translate('native.loading')}>
      {header ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>{bar(14, 14)}{bar('34%', 12)}</View> : null}
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {bar(10, 10)}
          <View style={{ flex: 1, gap: 7 }}>{bar(`${[72, 54, 64, 46, 68, 58][i % 6]!}%`, 11)}{bar('18%', 8)}</View>
        </View>
      ))}
    </Animated.View>
  );
}
