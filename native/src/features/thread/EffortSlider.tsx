// A model's reasoning levels as one compact slider (the Web's EffortSlider, shared UI bab9756,
// owner's variant A): "Effort · high" on the left, then a 3 pt track inset by half a thumb so the
// thumb's centre sits on each level's tick. Discrete steps; the label follows the finger and the
// level is applied when the drag ends. Plum Pocket fills with its level colours on a gradient
// from lavender; Terminal draws square blocks and a square thumb.
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { ModelOptionDto } from '@pockymoe/shared';
import { AppText } from '../../design/AppText';
import { withAlpha } from '../../design/contrast';
import { haptic } from '../../design/haptics';
import { useTheme } from '../../design/theme';
import { translate } from '../../i18n';
import { effortLabel } from './effort';
import { effortColor, effortIndexAt, effortStopX, orderedEfforts, plumEffortColor } from './effortModel';

const THUMB = 14;
const TRACK = 3;
const ROW = 44;

export function EffortSlider({ efforts, value, defaultEffort, disabled, onChange }: {
  efforts: ModelOptionDto['supportedReasoningEfforts'];
  /** The chosen level; null shows the model's default as chosen. */
  value: string | null | undefined;
  defaultEffort: string | null | undefined;
  disabled?: boolean;
  onChange: (effort: string) => void;
}) {
  const t = useTheme();
  const options = orderedEfforts(efforts);
  const count = options.length;
  const chosen = value ?? defaultEffort ?? null;
  const selected = Math.max(0, options.findIndex(e => e.reasoningEffort === chosen));
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? selected;
  const thumbSize = t.terminal ? 12 : THUMB;
  const x = useRef(new Animated.Value(0)).current;
  const pressed = useRef(new Animated.Value(1)).current;

  // The thumb and fill move between levels in 140 ms (the Web's ease).
  useEffect(() => {
    if (!width) return;
    Animated.timing(x, { toValue: effortStopX(shown, count, width, thumbSize), duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [shown, width, count, thumbSize, x]);

  const latest = useRef({ width, count, selected, disabled, options, onChange, thumbSize });
  latest.current = { width, count, selected, disabled, options, onChange, thumbSize };
  // The level under the finger, also kept outside React state for the release handler.
  const under = useRef<number | null>(null);
  const pick = (index: number | null) => { under.current = index; setDragging(index); };
  // The track's left edge on screen, taken when the finger lands (moves report page x).
  const origin = useRef(0);
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !latest.current.disabled,
    onMoveShouldSetPanResponder: () => !latest.current.disabled,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: e => {
      const l = latest.current;
      origin.current = e.nativeEvent.pageX - e.nativeEvent.locationX;
      Animated.timing(pressed, { toValue: 1.12, duration: 90, useNativeDriver: false }).start();
      pick(effortIndexAt(e.nativeEvent.locationX, l.count, l.width, l.thumbSize));
    },
    onPanResponderMove: (_e, g) => {
      const l = latest.current;
      const next = effortIndexAt(g.moveX - origin.current, l.count, l.width, l.thumbSize);
      if (under.current !== next) { haptic.selection(); pick(next); }
    },
    onPanResponderRelease: () => {
      Animated.timing(pressed, { toValue: 1, duration: 90, useNativeDriver: false }).start();
      const l = latest.current;
      const current = under.current;
      pick(null);
      if (current !== null && current !== l.selected) l.onChange(l.options[current]!.reasoningEffort);
    },
    onPanResponderTerminate: () => { Animated.timing(pressed, { toValue: 1, duration: 90, useNativeDriver: false }).start(); pick(null); },
  })).current;

  if (!count) return null;
  const level = options[shown]!.reasoningEffort;
  const accent = t.plum ? plumEffortColor(level, shown, count) : t.c.primary;
  const ring = t.plum ? accent : t.c.primary;
  const trackBg = t.plum ? withAlpha('#d9c2a0', 0.55) : withAlpha(t.c.fg, 0.14);
  const tickBg = withAlpha(t.c.fg, 0.32);
  const tickOnFill = withAlpha(t.c.panel, 0.75);
  const stepTo = (index: number) => { if (!disabled && index !== selected) { haptic.selection(); onChange(options[index]!.reasoningEffort); } };
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const inset = thumbSize / 2;
  const fillWidth = Animated.subtract(x, inset);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: ROW, opacity: disabled ? 0.5 : 1 }}>
      <AppText variant="caption" tone="muted" numberOfLines={1} style={{ minWidth: 118, fontSize: 12 }}>
        {translate('chat.effort')}<AppText variant="caption" weight="semibold" style={{ fontSize: 12 }}>{` · ${effortLabel(level)}`}</AppText>
      </AppText>
      <View onLayout={onLayout} {...responder.panHandlers} style={{ flex: 1, height: ROW, justifyContent: 'center' }}
        accessible accessibilityRole="adjustable" accessibilityLabel={translate('chat.effort')} accessibilityValue={{ text: effortLabel(options[selected]!.reasoningEffort) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={e => stepTo(Math.max(0, Math.min(count - 1, selected + (e.nativeEvent.actionName === 'increment' ? 1 : -1))))}>
        {width ? (t.terminal ? (
          // Terminal: n-1 square blocks between the ticks, filled up to the thumb.
          <View pointerEvents="none" style={{ flexDirection: 'row', gap: 2, marginHorizontal: inset, height: 8 }}>
            {options.slice(1).map((_, i) => <View key={i} style={{ flex: 1, backgroundColor: i < shown ? t.c.primary : withAlpha(t.c.fg, 0.14) }} />)}
          </View>
        ) : (
          <View pointerEvents="none" style={{ marginHorizontal: inset, height: TRACK, borderRadius: TRACK, backgroundColor: trackBg }}>
            <Animated.View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: fillWidth, borderRadius: TRACK, overflow: 'hidden', backgroundColor: t.plum ? undefined : accent }}>
              {t.plum ? (
                <Svg width="100%" height={TRACK}>
                  <Defs><LinearGradient id="fill" x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor="#9479cf" /><Stop offset="1" stopColor={accent} /></LinearGradient></Defs>
                  <Rect x="0" y="0" width="100%" height={TRACK} fill="url(#fill)" />
                </Svg>
              ) : null}
            </Animated.View>
            {options.map((_, i) => (
              <View key={i} style={{ position: 'absolute', top: 0, left: effortStopX(i, count, width, thumbSize) - inset - 1.5, width: 3, height: 3, borderRadius: 1.5,
                backgroundColor: i < shown ? tickOnFill : i === shown ? 'transparent' : tickBg }} />
            ))}
          </View>
        )) : null}
        {width ? (
          <Animated.View pointerEvents="none" style={{ position: 'absolute', top: (ROW - thumbSize) / 2, left: Animated.subtract(x, thumbSize / 2), width: thumbSize, height: thumbSize,
            borderRadius: t.terminal ? 0 : thumbSize / 2, backgroundColor: t.c.panel, borderWidth: 2, borderColor: ring,
            shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2, transform: [{ scale: pressed }] }} />
        ) : null}
      </View>
    </View>
  );
}

export { effortColor };
