// Copy, paths and long names (docs/ui-principles.md §2, §14).
import { useState } from 'react';
import { AccessibilityInfo, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { AlertTriangle, Check, Copy } from 'lucide-react-native';
import { Press } from './Press';
import { AppText, type Variant } from './AppText';
import { Sheet } from './Sheet';
import { useTheme } from './theme';
import { translate } from '../i18n';

/** The one copy button: two pages; a check for ~1.5 s with an announcement; red and "Copy failed" in place on failure. */
export function CopyButton({ value, label = translate('chat.copy'), size = 16, style }: { value: string | (() => string); label?: string; size?: number; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(typeof value === 'function' ? value() : value);
      setState('done'); AccessibilityInfo.announceForAccessibility(translate('common.copied'));
      setTimeout(() => setState('idle'), 1500);
    } catch { setState('failed'); setTimeout(() => setState('idle'), 3000); }
  };
  const Icon = state === 'done' ? Check : state === 'failed' ? AlertTriangle : Copy;
  return (
    <Press onPress={() => void copy()} feedback="dim" accessibilityRole="button" accessibilityLabel={state === 'done' ? translate('common.copied') : label} hitSlop={8}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6, borderRadius: t.radius.sm }, style]}>
      <Icon size={size} color={state === 'failed' ? t.c.failed : state === 'done' ? t.c.success : t.c.fgMuted} />
      {state === 'failed' ? <AppText variant="caption" tone="danger">{translate('common.copyFailed')}</AppText> : null}
    </Press>
  );
}

/** Keeps both ends of a long name: "very-long-…-name.ts". */
export function middleTruncate(text: string, max: number) {
  if (text.length <= max) return text;
  const keep = max - 1, head = Math.ceil(keep * 0.55);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
}
export function MiddleName({ text, max = 42, variant = 'callout', mono }: { text: string; max?: number; variant?: Variant; mono?: boolean }) {
  const t = useTheme();
  return <AppText variant={mono ? 'monoSmall' : variant} numberOfLines={1} ellipsizeMode="middle" style={mono ? { fontFamily: t.font.mono } : undefined} accessibilityLabel={text}>{middleTruncate(text, max)}</AppText>;
}

/** A path chip: monospace, middle ellipsis keeping the first and last segments, a copy button; a tap shows the whole value. */
export function PathChip({ path, copyValue, style }: { path: string; copyValue?: string; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.c.surface, borderRadius: t.radius.sm, borderWidth: 1, borderColor: t.c.border, paddingLeft: 8, maxWidth: '100%' }, style]}>
      <Press onPress={() => setOpen(true)} feedback="dim" style={{ flexShrink: 1, paddingVertical: 4 }} accessibilityRole="button" accessibilityLabel={translate('common.pathShowWhole', { path })}>
        <AppText variant="monoSmall" tone="soft" numberOfLines={1} ellipsizeMode="middle">{path}</AppText>
      </Press>
      <CopyButton value={copyValue ?? path} label={translate('common.copyPath')} size={14} />
      <Sheet visible={open} onClose={() => setOpen(false)} title={translate('common.copyPath')}>
        <AppText variant="mono" selectable>{path}</AppText>
      </Sheet>
    </View>
  );
}
