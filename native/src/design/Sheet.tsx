// Secondary windows (docs/ui-principles.md §4): on a phone they rise from the bottom with
// a scrim, a grabber, a title and a 40 pt ×; on wide windows they are centered dialogs.
// The content scrolls vertically only; actions sit at the bottom, Cancel first.
import { useEffect, useState, type ReactNode } from 'react';
import { createStore } from '../state/store';
import { BackHandler, Modal, Pressable, ScrollView, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { IconButton } from './Button';
import { AppText } from './AppText';
import { useTheme } from './theme';
import { translate } from '../i18n';

export const WIDE_SHEET = 640;

// iOS presents one view controller at a time from a presenter, and an RN Modal presents from the
// root controller: a menu, confirmation or toast rendered at the root cannot show while a Sheet is
// up. Each open Sheet is a layer; the topmost one renders the app-wide overlays inside its own
// Modal (a nested Modal presents from that Sheet), the root renders them only with no Sheet open.
const layers = createStore<{ stack: number[] }>({ stack: [] });
let layerSeq = 0;
let renderOverlays: (() => ReactNode) | null = null;
/** Overlay.tsx registers its hosts here (no import cycle). */
export function setOverlayRenderer(render: () => ReactNode) { renderOverlays = render; }
export function useNoSheetOpen() { return layers.useValue(s => s.stack.length === 0); }
function useLayer(active: boolean) {
  const [id] = useState(() => ++layerSeq);
  useEffect(() => {
    if (!active) return;
    layers.set(s => ({ stack: [...s.stack, id] }));
    return () => layers.set(s => ({ stack: s.stack.filter(x => x !== id) }));
  }, [active, id]);
  return layers.useValue(s => s.stack[s.stack.length - 1] === id);
}

// VoiceOver keeps to a view marked accessibilityViewIsModal and skips everything beside it, a
// Modal presented above included: a Commit sheet or a menu over the Git sheet was invisible to it
// (D6). Every Modal surface registers here and only the topmost one carries the mark.
const modals = createStore<{ stack: number[] }>({ stack: [] });
let modalSeq = 0;
/** Registers a Modal surface while `active`; true while it is the topmost one. */
export function useModalTop(active: boolean) {
  const [id] = useState(() => ++modalSeq);
  useEffect(() => {
    if (!active) return;
    modals.set(s => ({ stack: [...s.stack, id] }));
    return () => modals.set(s => ({ stack: s.stack.filter(x => x !== id) }));
  }, [active, id]);
  return modals.useValue(s => s.stack[s.stack.length - 1] === id);
}

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string | null;
  children: ReactNode;
  footer?: ReactNode;
  /** Fill most of the screen (lists, pickers) instead of fitting the content. */
  tall?: boolean;
  /** With `tall` on a phone: this share of the window's height instead of all of it. */
  fraction?: number;
  scroll?: boolean;
  /** Refuse dismissal by scrim, swipe and back (busy or unsaved); × still asks onClose. */
  dismissable?: boolean;
  testID?: string;
  contentStyle?: StyleProp<ViewStyle>;
  /** false when the content draws its own header (the inspector): only the grabber stays. */
  header?: boolean;
  /** Called once the sheet's window is gone (after the closing animation). */
  onClosed?: () => void;
  /** false for the overlays' own sheets (menu, confirmation): they never host other overlays. */
  overlayLayer?: boolean;
}

/**
 * A key for a Modal that changes a moment after the colour mode does. An Android Modal window
 * copies the app's status bar icons when it opens and never again, so a light/dark change
 * while it is open (automatic mode at sunset) left dark icons on dark. Remounting it after the
 * app's status bar has switched gives it the new icons.
 */
export function useModalKey() {
  const mode = useTheme().mode;
  const [key, setKey] = useState(mode);
  useEffect(() => {
    if (key === mode) return;
    const id = setTimeout(() => setKey(mode), 120);
    return () => clearTimeout(id);
  }, [mode, key]);
  return key;
}

export function Sheet({ visible, onClose, title, subtitle, children, footer, tall, fraction, scroll = true, dismissable = true, testID, contentStyle, header: showHeader = true, onClosed, overlayLayer = true }: SheetProps) {
  const t = useTheme();
  const modalKey = useModalKey();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= WIDE_SHEET;
  const [mounted, setMounted] = useState(visible);
  const isTopLayer = useLayer(overlayLayer && mounted);
  const modalTop = useModalTop(mounted);
  // The Modal unmounts with `mounted`; tell the owner on the next frame, when iOS has dismissed it.
  const [wasMounted, setWasMounted] = useState(mounted);
  useEffect(() => {
    if (mounted) { setWasMounted(true); return; }
    if (!wasMounted) return;
    setWasMounted(false);
    const id = requestAnimationFrame(() => onClosed?.());
    return () => cancelAnimationFrame(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);
  const offset = useSharedValue(height);
  const fade = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      offset.value = wide ? 24 : height;
      fade.value = 0;
      requestAnimationFrame(() => {
        offset.value = withSpring(0, { damping: 26, stiffness: 260, mass: 0.9 });
        fade.value = withTiming(1, { duration: 180 });
      });
    } else if (mounted) {
      fade.value = withTiming(0, { duration: 160 });
      offset.value = withTiming(wide ? 24 : height, { duration: 200, easing: Easing.in(Easing.quad) }, done => { if (done) runOnJS(setMounted)(false); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (dismissable) onClose(); return true; });
    return () => sub.remove();
  }, [visible, dismissable, onClose]);

  const pan = Gesture.Pan().enabled(!wide && dismissable).activeOffsetY(8).failOffsetX([-20, 20])
    .onUpdate(e => { offset.value = Math.max(0, e.translationY); })
    .onEnd(e => {
      if (e.translationY > 120 || e.velocityY > 900) runOnJS(onClose)();
      else offset.value = withSpring(0, { damping: 24, stiffness: 260 });
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }], opacity: wide ? fade.value : 1 }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  if (!mounted) return null;

  const maxHeight = wide ? Math.min(height * 0.86, 760) : fraction ? Math.min(height * fraction, height - insets.top - 12) : height - insets.top - 12;
  const header = !showHeader ? (wide ? null : <View style={{ alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: t.c.borderStrong, marginTop: 6, marginBottom: 2 }} />) : (
    <View style={{ paddingHorizontal: 16, paddingTop: wide ? 14 : 6, paddingBottom: 6 }}>
      {!wide ? <View style={{ alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: t.c.borderStrong, marginBottom: 8 }} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {title ? <AppText variant="headline" accessibilityRole="header" numberOfLines={1}>{title}</AppText> : null}
          {subtitle ? <AppText variant="footnote" tone="muted" numberOfLines={1}>{subtitle}</AppText> : null}
        </View>
        <IconButton icon={X} label={translate('workbench.close')} onPress={onClose} testID="sheet-close" />
      </View>
    </View>
  );
  const body = scroll
    ? <ScrollView style={tall ? { flex: 1 } : { flexGrow: 0 }} contentContainerStyle={[{ paddingHorizontal: 16, paddingBottom: 12 }, contentStyle]} keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}>{children}</ScrollView>
    : <View style={[{ flexShrink: 1, flexGrow: tall ? 1 : 0 }, contentStyle]}>{children}</View>;

  return (
    <Modal key={modalKey} transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => { if (dismissable) onClose(); }}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: wide ? 'center' : 'flex-end', alignItems: wide ? 'center' : 'stretch', paddingTop: wide ? 0 : insets.top + 8 }}>
          <Animated.View style={[{ position: 'absolute', inset: 0, backgroundColor: t.c.scrim }, scrimStyle]}>
            <Pressable style={{ flex: 1 }} onPress={() => dismissable && onClose()} accessibilityRole="button" accessibilityLabel={translate('workbench.close')} />
          </Animated.View>
          <GestureDetector gesture={pan}>
            <Animated.View testID={testID} accessibilityViewIsModal={modalTop} style={[{
              backgroundColor: t.c.sheet, maxHeight, width: wide ? Math.min(560, width - 48) : undefined,
              // A tall sheet takes its height but gives way to the keyboard instead of rising off the top.
              ...(tall ? { flexBasis: maxHeight, flexShrink: 1, minHeight: Math.min(maxHeight, 240) } : {}),
              borderTopLeftRadius: t.radius.sheet, borderTopRightRadius: t.radius.sheet,
              borderBottomLeftRadius: wide ? t.radius.sheet : 0, borderBottomRightRadius: wide ? t.radius.sheet : 0,
              borderWidth: t.terminal ? 1 : 0, borderColor: t.c.borderStrong,
              paddingBottom: wide ? 8 : Math.max(insets.bottom, 10),
              shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 16,
            }, sheetStyle]}>
              {header}
              {body}
              {footer ? <View style={{ borderTopWidth: 1, borderTopColor: t.c.border, paddingHorizontal: 16, paddingTop: 10, flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>{footer}</View> : null}
            </Animated.View>
          </GestureDetector>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
      {isTopLayer && renderOverlays ? <View pointerEvents="box-none" style={{ position: 'absolute', inset: 0 }}>{renderOverlays()}</View> : null}
    </Modal>
  );
}
