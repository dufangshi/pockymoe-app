// A full-screen look at one image (T3's zoomable image): pinch or double-tap to zoom, drag to
// move a zoomed image, drag down to close, share from the bar. The page dims behind it.
import { useEffect } from 'react';
import { Modal, StatusBar, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image as ExpoImage } from 'expo-image';
import { File as FsFile, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Share2, X } from 'lucide-react-native';
import { IconButton } from './Button';
import { AppText } from './AppText';
import { showToast } from './Overlay';
import { translate } from '../i18n';

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

export function ImageViewer({ uri, name, onClose }: { uri: string | null; name?: string; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scale = useSharedValue(1), savedScale = useSharedValue(1);
  const x = useSharedValue(0), y = useSharedValue(0), savedX = useSharedValue(0), savedY = useSharedValue(0);
  const dim = useSharedValue(0);
  useEffect(() => {
    if (!uri) return;
    scale.value = 1; savedScale.value = 1; x.value = 0; y.value = 0; savedX.value = 0; savedY.value = 0;
    dim.value = withTiming(1, { duration: 160 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  const close = () => { dim.value = withTiming(0, { duration: 140 }, done => { if (done) runOnJS(onClose)(); }); };
  const clampPan = (s: number) => { 'worklet'; return { mx: (width * (s - 1)) / 2, my: (height * (s - 1)) / 2 }; };

  const pinch = Gesture.Pinch()
    .onUpdate(e => { scale.value = Math.min(MAX_SCALE, Math.max(0.8, savedScale.value * e.scale)); })
    .onEnd(() => {
      const s = Math.min(MAX_SCALE, Math.max(1, scale.value));
      scale.value = withSpring(s); savedScale.value = s;
      const { mx, my } = clampPan(s);
      x.value = withSpring(Math.max(-mx, Math.min(mx, x.value))); y.value = withSpring(Math.max(-my, Math.min(my, y.value)));
      savedX.value = Math.max(-mx, Math.min(mx, x.value)); savedY.value = Math.max(-my, Math.min(my, y.value));
    });
  const pan = Gesture.Pan().averageTouches(true)
    .onUpdate(e => {
      if (savedScale.value > 1) { x.value = savedX.value + e.translationX; y.value = savedY.value + e.translationY; return; }
      // At fit size only a downward drag moves the image, and it dims the page as it goes.
      y.value = Math.max(0, e.translationY);
      dim.value = 1 - Math.min(1, y.value / (height * 0.6));
    })
    .onEnd(e => {
      if (savedScale.value > 1) {
        const { mx, my } = clampPan(savedScale.value);
        const nx = Math.max(-mx, Math.min(mx, x.value)), ny = Math.max(-my, Math.min(my, y.value));
        x.value = withSpring(nx); y.value = withSpring(ny); savedX.value = nx; savedY.value = ny;
        return;
      }
      if (e.translationY > 120 || e.velocityY > 900) runOnJS(close)();
      else { y.value = withSpring(0); dim.value = withTiming(1, { duration: 120 }); }
    });
  const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd(e => {
    if (savedScale.value > 1) {
      scale.value = withSpring(1); savedScale.value = 1;
      x.value = withSpring(0); y.value = withSpring(0); savedX.value = 0; savedY.value = 0;
    } else {
      // Zoom in around the tapped point.
      const s = DOUBLE_TAP_SCALE, { mx, my } = clampPan(s);
      const nx = Math.max(-mx, Math.min(mx, (width / 2 - e.x) * (s - 1))), ny = Math.max(-my, Math.min(my, (height / 2 - e.y) * (s - 1)));
      scale.value = withSpring(s); savedScale.value = s; x.value = withSpring(nx); y.value = withSpring(ny); savedX.value = nx; savedY.value = ny;
    }
  });
  const gesture = Gesture.Exclusive(doubleTap, Gesture.Simultaneous(pinch, pan));

  const imageStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }] }));
  const backdrop = useAnimatedStyle(() => ({ opacity: dim.value }));

  const share = async () => {
    if (!uri) return;
    try {
      const match = /^data:([^;]+);base64,(.*)$/.exec(uri);
      let target = uri;
      if (match) {
        const ext = match[1]!.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
        const file = new FsFile(Paths.cache, (name ?? `image.${ext}`).replace(/[^\w.-]+/g, '_'));
        if (file.exists) file.delete();
        file.create();
        file.write(Uint8Array.from(atob(match[2]!), c => c.charCodeAt(0)));
        target = file.uri;
      }
      await Sharing.shareAsync(target, { dialogTitle: name });
    } catch (e) { showToast(String((e as Error)?.message ?? e), 'error'); }
  };

  return (
    <Modal transparent visible={!!uri} animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
      <StatusBar barStyle="light-content" />
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View style={[{ position: 'absolute', inset: 0, backgroundColor: '#000' }, backdrop]} />
        <GestureDetector gesture={gesture}>
          <Animated.View style={[{ flex: 1 }, imageStyle]} accessibilityViewIsModal>
            {uri ? <ExpoImage source={{ uri }} style={{ width, height }} contentFit="contain" accessibilityLabel={name} accessibilityHint={translate('native.imageZoomHint')} /> : null}
          </Animated.View>
        </GestureDetector>
        <Animated.View style={[{ position: 'absolute', top: insets.top + 6, left: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }, backdrop]}>
          <IconButton icon={X} label={translate('workbench.close')} onPress={close} tone="onImage" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }} testID="image-close" />
          <View style={{ flex: 1, minWidth: 0 }}>{name ? <AppText variant="subhead" color="#fff" numberOfLines={1}>{name}</AppText> : null}</View>
          <IconButton icon={Share2} label={translate('native.share')} onPress={() => void share()} tone="onImage" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }} testID="image-share" />
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}
