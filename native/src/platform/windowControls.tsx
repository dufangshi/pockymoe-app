// iPadOS 26+ lets apps run in resizable windows whose controls (close, minimise, resize) sit in
// the top-leading corner over the app, outside the plain safe area: they covered the thread
// header's Back button and the device switcher (D21). The native module reports where the safe
// area adapted to that corner starts, and the app's top inset grows to it while windowed, so
// every header and sheet below reads the larger inset.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { pockymoeNative } from './native/fold';

export function WindowControlsInsets({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [top, setTop] = useState(0);
  useEffect(() => {
    const query = pockymoeNative?.windowControlsTop;
    if (Platform.OS !== 'ios' || !Platform.isPad || !query) return;
    let live = true;
    // After a resize UIKit settles the window's layout guides on the next pass.
    const id = setTimeout(() => { query().then(value => { if (live) setTop(value); }, () => undefined); }, 60);
    return () => { live = false; clearTimeout(id); };
  }, [width, height, insets.top]);
  const value = useMemo(() => (top > insets.top ? { ...insets, top } : insets), [insets, top]);
  return <SafeAreaInsetsContext.Provider value={value}>{children}</SafeAreaInsetsContext.Provider>;
}
