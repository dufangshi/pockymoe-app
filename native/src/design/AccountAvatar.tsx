// The Web's account avatar: two initials in a circle (square in Terminal), 32 pt in a 40 pt
// target. Phones put it at the end of the top bar (ui-principles §1, relay accounts only).
import type { ComponentRef, Ref } from 'react';
import { View } from 'react-native';
import { AppText } from './AppText';
import { Press } from './Press';
import { useTheme } from './theme';

/** "lab0a1b2c" → "LA"; "Ada Lovelace" → "AL"; "ada.lovelace@x" → "AL". */
export function initials(name: string) {
  const local = name.split('@')[0] ?? name;
  const words = local.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const raw = words.length >= 2 ? words[0]!.slice(0, 1) + words[1]!.slice(0, 1) : (words[0] ?? local).slice(0, 2);
  return raw.toUpperCase() || '?';
}

export function AccountAvatar({ name, size = 32, onPress, label, testID, ref }: {
  name: string; size?: number; onPress?: () => void; label?: string; testID?: string; ref?: Ref<ComponentRef<typeof View>>;
}) {
    const t = useTheme();
    const circle = (
      <View style={{ width: size, height: size, borderRadius: t.terminal ? 0 : size / 2, borderWidth: 1, borderColor: t.c.borderStrong, backgroundColor: t.c.panel, alignItems: 'center', justifyContent: 'center' }}>
        <AppText variant={size >= 40 ? 'headline' : 'footnote'} weight="semibold" tone="soft" maxFontSizeMultiplier={1.3}>{initials(name)}</AppText>
      </View>
    );
    if (!onPress) return <View ref={ref} collapsable={false} accessible accessibilityLabel={label ?? name}>{circle}</View>;
    return (
      <View ref={ref} collapsable={false}>
        <Press onPress={onPress} feedback="dim" accessibilityRole="button" accessibilityLabel={label ?? name} testID={testID}
          style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 }}>{circle}</Press>
      </View>
    );
  }
