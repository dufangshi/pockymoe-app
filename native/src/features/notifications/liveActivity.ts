// iOS: keeps the account Live Activity (lock screen, Dynamic Island) in step with the app's thread
// lists while the app runs; the relay updates it over APNs while the app is closed. The native
// side (LiveActivityManager, ported from the iOS shell) decides when to start, update and end it.
import { AppState, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { accountStore } from '../../connection/account';
import { findDevice } from '../../connection/devices';
import { deviceDataStore } from '../../state/deviceData';
import { getLocale } from '../../i18n';
import { isUnread } from '../threads/references';
import { buildActivitySnapshot, type ActivityDevice } from './activitySnapshot';
import { setLiveActivityToken } from './notifications';

interface LiveActivityModule {
  addListener(event: 'liveActivityToken', listener: (e: { token: string }) => void): { remove(): void };
  syncLiveActivity?(snapshot: string, language: string): Promise<boolean>;
  clearLiveActivity?(): Promise<void>;
}
const native = Platform.OS === 'ios' ? requireOptionalNativeModule<LiveActivityModule>('PockymoeNative') : null;

export function startLiveActivity() {
  if (!native?.syncLiveActivity) return () => undefined;
  const tokens = native.addListener('liveActivityToken', e => { void setLiveActivityToken(e.token); });
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = '';
  let signedIn = false;
  const sync = () => {
    timer = null;
    const account = accountStore.get();
    if (account.phase !== 'ready' || !account.user) {
      if (signedIn) { signedIn = false; last = ''; void native.clearLiveActivity?.(); }
      return;
    }
    signedIn = true;
    const devices: ActivityDevice[] = Object.entries(deviceDataStore.get()).flatMap(([key, data]) => key.startsWith('relay:')
      ? [{ deviceId: key.slice(6), name: findDevice(key)?.name ?? '', threads: data.threads, workspaces: data.workspaces, waiting: data.waiting }] : []);
    const snapshot = JSON.stringify(buildActivitySnapshot(account.user.id, devices, (deviceId, thread) => isUnread(`relay:${deviceId}`, thread)));
    const language = getLocale().startsWith('zh') ? 'zh' : 'en';
    // Unchanged snapshots are not sent again, except on returning to the foreground (it may start).
    if (snapshot + language === last && AppState.currentState !== 'active') return;
    last = snapshot + language;
    void native.syncLiveActivity?.(snapshot, language);
  };
  const schedule = () => { if (!timer) timer = setTimeout(sync, 1000); };
  const unsubscribe = [deviceDataStore.subscribe(schedule), accountStore.subscribe(schedule)];
  const appState = AppState.addEventListener('change', state => { if (state === 'active') { last = ''; schedule(); } });
  schedule();
  return () => { tokens.remove(); unsubscribe.forEach(u => u()); appState.remove(); if (timer) clearTimeout(timer); };
}
