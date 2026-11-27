import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyCommandsRoot, useKeyCommand } from './platform/keyCommands';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { NavigationContainer, DefaultTheme, DarkTheme, type NavigationState } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { useFonts } from 'expo-font';
import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold } from '@expo-google-fonts/nunito';
import { Fredoka_600SemiBold } from '@expo-google-fonts/fredoka';
import { ThemeProvider, useTheme } from './design/theme';
import { OverlayHost } from './design/Overlay';
import { useI18n } from './i18n';
import { RootNavigator } from './navigation/RootNavigator';
import { UnlockSheet } from './features/account/UnlockSheet';
import { accountStore, restoreAccount } from './connection/account';
import { loadDirect, probeAllDirect, refreshRelayDevices } from './connection/devices';
import { refreshReferences } from './features/threads/references';
import { startFoldObserver } from './platform/native/fold';
import { installDevLinks } from './platform/devLinks';
import { installNotificationRouting, loadNotificationScope, notifyFromEvent, syncBackgroundWatch } from './features/notifications/notifications';
import { onAnyDeviceEvent } from './state/deviceData';
import { navigationRef } from './navigation/ref';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

function Themed() {
  const t = useTheme();
  // Screens are memoized (React Compiler), so their translate() calls do not re-run when the
  // language changes: remount the tree under the new locale and restore where the user was.
  const { locale } = useI18n();
  const navState = useRef<NavigationState | undefined>(undefined);
  useEffect(() => { void SystemUI.setBackgroundColorAsync(t.c.bg); }, [t.c.bg]);
  const base = t.mode === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <NavigationContainer key={locale} ref={navigationRef} initialState={navState.current} onStateChange={state => { navState.current = state; }} theme={{ ...base, colors: { ...base.colors, background: t.c.bg, card: t.c.bg, text: t.c.fg, border: t.c.border, primary: t.c.primary } }}>
      <StatusBar style={t.mode === 'dark' ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: t.c.bg }}>
        <RootNavigator />
        <UnlockSheet />
        <OverlayHost />
      </View>
    </NavigationContainer>
  );
}

export default function App() {
  // Cmd/Ctrl+[ goes back from any pushed page.
  useKeyCommand('back', () => { if (!navigationRef.isReady() || !navigationRef.canGoBack()) return false; navigationRef.goBack(); });
  const [fonts] = useFonts({ DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold, Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold, Fredoka_600SemiBold });
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    void Promise.all([restoreAccount(), loadDirect()]).finally(() => setBooted(true));
    const stop = startFoldObserver();
    const stopLinks = installDevLinks();
    const stopRouting = installNotificationRouting();
    const stopEvents = onAnyDeviceEvent(notifyFromEvent);
    // Devices and starred threads follow the account.
    const unsubscribe = accountStore.subscribe(() => { if (accountStore.get().phase === 'ready') { void refreshRelayDevices(); void refreshReferences(); void loadNotificationScope(); } syncBackgroundWatch(); });
    const timer = setInterval(() => { if (accountStore.get().phase === 'ready') void refreshRelayDevices(); void probeAllDirect(); }, 30_000);
    return () => { unsubscribe(); clearInterval(timer); stop(); stopLinks(); stopRouting(); stopEvents(); };
  }, []);
  useEffect(() => { if (fonts && booted) void SplashScreen.hideAsync().catch(() => undefined); }, [fonts, booted]);
  if (!fonts || !booted) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyCommandsRoot>
      <SafeAreaProvider>
        <KeyboardProvider>
          <ThemeProvider>
            <Themed />
          </ThemeProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
      </KeyCommandsRoot>
    </GestureHandlerRootView>
  );
}
