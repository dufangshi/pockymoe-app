// The phone's floating action (an extended FAB): icon and label within thumb reach, folding
// to the icon while the reader scrolls down a list and opening again on the way back up.
import type { ComponentType } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import type { LucideProps } from 'lucide-react-native';
import { Press } from './Press';
import { AppText } from './AppText';
import { useTheme } from './theme';

export function Fab({ icon: Icon, label, onPress, extended = true, bottom, testID }: {
  icon: ComponentType<LucideProps>; label: string; onPress: () => void; extended?: boolean; bottom: number; testID?: string;
}) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const layout = reduced ? undefined : LinearTransition.springify().damping(22).stiffness(260);
  return (
    <Animated.View layout={layout} style={{ position: 'absolute', right: 18, bottom, borderRadius: t.terminal ? 0 : 27,
      shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6, backgroundColor: t.c.primarySolid }}>
      <Press onPress={onPress} feedback="dim" accessibilityRole="button" accessibilityLabel={label} testID={testID} radius={t.terminal ? 0 : 27}
        style={{ height: 54, minWidth: 54, paddingHorizontal: extended ? 18 : 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Icon size={22} color={t.c.primaryFg} strokeWidth={2.5} />
        {extended ? (
          <Animated.View entering={reduced ? undefined : FadeIn.duration(140)} exiting={reduced ? undefined : FadeOut.duration(90)}>
            <AppText variant="callout" weight="semibold" color={t.c.primaryFg} numberOfLines={1}>{label}</AppText>
          </Animated.View>
        ) : null}
      </Press>
    </Animated.View>
  );
}
