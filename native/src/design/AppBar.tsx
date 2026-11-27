import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ChevronLeft } from 'lucide-react-native';
import { Platform } from 'react-native';
import { IconButton } from './Button';
import { AppText } from './AppText';
import { useTheme } from './theme';
import { ensureContrast } from './contrast';
import { translate } from '../i18n';

/** Back is a chevron on iOS and an arrow on Android, everywhere (one action, one look). */
export const BackIcon = Platform.OS === 'ios' ? ChevronLeft : ArrowLeft;

/** Every page and pane has one bar with the same contract on both platforms. */
export function AppBar({ title, subtitle, onBack, leading, trailing, inset = true, center, titleAccessory, onTitlePress }: {
  title?: string; subtitle?: string | null; onBack?: () => void; leading?: ReactNode; trailing?: ReactNode; inset?: boolean; center?: ReactNode;
  titleAccessory?: ReactNode; onTitlePress?: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  // Small text on the bar: 4.5:1 against it (D14; muted alone reached 4.0:1 in Classic light).
  const subtitleColor = ensureContrast(t.c.fgMuted, [t.c.bg], 4.5);
  return (
    <View style={{ paddingTop: inset ? insets.top : 0, backgroundColor: t.c.bg, borderBottomWidth: t.terminal ? 1 : 0, borderBottomColor: t.c.border }}>
      <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, gap: 2 }}>
        {onBack ? <IconButton icon={BackIcon} size={Platform.OS === 'ios' ? 26 : 22} label={translate('native.back')} onPress={onBack} tone="fg" testID="back" /> : leading}
        <View style={{ flex: 1, minWidth: 0, paddingHorizontal: onBack || leading ? 2 : 10 }}>
          {center ?? (title ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ flexShrink: 1 }}>
                <AppText variant="headline" numberOfLines={1} accessibilityRole="header" onPress={onTitlePress} suppressHighlighting>{title}</AppText>
                {subtitle ? <AppText variant="footnote" color={subtitleColor} numberOfLines={1}>{subtitle}</AppText> : null}
              </View>
              {titleAccessory}
            </View>
          ) : null)}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>{trailing}</View>
      </View>
    </View>
  );
}
