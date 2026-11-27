// The one segmented control (docs/ui-principles.md §15: two or three choices are always a
// segmented control, the Web's `product-segmented`): a bordered track on the surface colour
// with a raised thumb on the panel colour that slides to the chosen segment.
import { useEffect, useRef, useState } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { AppText } from './AppText';
import { Press } from './Press';
import { haptic } from './haptics';
import { useTheme } from './theme';

export interface SegmentOption<T extends string> { value: T; label: string; accessibilityLabel?: string; disabled?: boolean }

export function Segmented<T extends string>({ value, options, onChange, label, compact, stretch = true, style, testID }: {
  value: T; options: SegmentOption<T>[]; onChange: (v: T) => void; label: string;
  /** Shorter segments for a choice inside a row or a pane header. */
  compact?: boolean;
  /** Equal segments filling the width (default); otherwise each segment fits its label. */
  stretch?: boolean;
  style?: StyleProp<ViewStyle>; testID?: string;
}) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const frames = useRef<Record<string, { x: number; width: number }>>({});
  const [ready, setReady] = useState(false);
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const index = options.findIndex(o => o.value === value);
  const radius = t.terminal ? 0 : t.plum ? t.radius.pill : 8;
  const inner = t.terminal ? 0 : t.plum ? t.radius.pill : 5;

  const move = (animate: boolean) => {
    const frame = frames.current[value];
    if (!frame) return;
    if (animate && !reduced) {
      x.value = withSpring(frame.x, { damping: 28, stiffness: 320, mass: 0.7 });
      w.value = withSpring(frame.width, { damping: 28, stiffness: 320, mass: 0.7 });
    } else { x.value = frame.x; w.value = frame.width; }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { move(ready); }, [value, ready]);

  const onSegmentLayout = (key: string) => (e: LayoutChangeEvent) => {
    frames.current[key] = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width };
    if (Object.keys(frames.current).length >= options.length) { if (!ready) setReady(true); else if (key === value) move(false); }
  };
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }], width: w.value }));

  return (
    <View testID={testID} accessibilityRole="radiogroup" accessibilityLabel={label}
      style={[{ flexDirection: 'row', alignSelf: stretch ? 'stretch' : 'flex-start', padding: 3, gap: 2, borderWidth: 1, borderColor: t.c.border,
        borderRadius: radius, backgroundColor: t.c.surface }, style]}>
      {ready && index >= 0 ? (
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 3, bottom: 3, left: 0, borderRadius: inner,
          backgroundColor: t.terminal ? t.c.primarySolid : t.c.panel, borderWidth: t.plum ? 1 : 0, borderColor: t.c.accentBorder,
          shadowColor: '#000', shadowOpacity: t.terminal ? 0 : 0.16, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: t.terminal ? 0 : 1 }, thumb]} />
      ) : null}
      {options.map(o => {
        const on = o.value === value;
        return (
          <Press key={o.value} onLayout={onSegmentLayout(o.value)} disabled={o.disabled} feedback="none"
            onPress={() => { if (on) return; haptic.selection(); onChange(o.value); }}
            accessibilityRole="radio" accessibilityState={{ checked: on, disabled: !!o.disabled }} accessibilityLabel={o.accessibilityLabel ?? o.label}
            style={{ flex: stretch ? 1 : undefined, minHeight: compact ? 34 : 40, paddingHorizontal: compact ? 10 : 12, alignItems: 'center', justifyContent: 'center', borderRadius: inner,
              // Until the thumb has measured, the chosen segment draws its own background.
              backgroundColor: on && !ready ? (t.terminal ? t.c.primarySolid : t.c.panel) : 'transparent' }}>
            <AppText variant={compact ? 'footnote' : 'subhead'} weight="semibold" numberOfLines={1}
              color={on ? (t.terminal ? t.c.primaryFg : t.c.fg) : t.c.fgMuted}>{o.label}</AppText>
          </Press>
        );
      })}
    </View>
  );
}
