// Notifications through what Pockymoe already has (docs/thread-notifications.md):
// - the account's scope and per-turn subscriptions on the relay (the turn bell);
// - iOS: the relay's native APNs registration (POST /relay/account/notifications/native);
// - while the app runs (also briefly in the background): local notifications from the
//   device sockets, for turns that finish, fail or wait for an answer.
// Android has no FCM here, like the WebView shell: background delivery after the OS
// suspends the app needs the shell's foreground service or push keys (owner decision).
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { ThreadEventEnvelope } from '@pockymoe/shared';
import { relayUrl } from '@pockymoe/web/relayOrigin';
import { createStore } from '../../state/store';
import { deviceDataStore } from '../../state/deviceData';
import { findDevice } from '../../connection/devices';
import { accountStore } from '../../connection/account';
import { translate } from '../../i18n';
import { navigationRef } from '../../navigation/ref';
import { selectionStore } from '../../layout/selection';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { pockymoeNative } from '../../platform/native/fold';
import { relaySessionToken } from '../../platform/relaySession';

export type Scope = 'subscribed' | 'all' | 'selected';
/** The account's notification settings on the relay (the Web's lib/notificationSettings). */
export interface NotificationPrefs {
  scope: Scope;
  devices: { deviceId: string; name: string }[];
  workspaces: { deviceId: string; workspaceId: string; name: string; deviceName: string }[];
}
interface NotifyState { permission: 'unknown' | 'granted' | 'denied'; scope: Scope; prefs: NotificationPrefs | null; native: 'off' | 'registered' | 'unavailable' | 'failed'; subscribed: Record<string, boolean> }
export const notifyStore = createStore<NotifyState>({ permission: 'unknown', scope: 'subscribed', prefs: null, native: 'off', subscribed: {} });
/** The thread on screen; it never notifies about itself while the app is active. */
export const visibleThread = { key: null as string | null };

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

const relayFetchJson = async <T,>(path: string, init?: RequestInit) => {
  const response = await fetch(relayUrl(path), init);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (response.status === 204 ? null : await response.json()) as T;
};

export async function enableNotifications() {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('threads', { name: translate('native.threads'), importance: Notifications.AndroidImportance.HIGH });
  const current = await Notifications.getPermissionsAsync();
  const result = current.granted ? current : await Notifications.requestPermissionsAsync();
  notifyStore.set({ permission: result.granted ? 'granted' : 'denied' });
  if (result.granted && Platform.OS === 'ios' && accountStore.get().phase === 'ready') await registerApns();
  syncBackgroundWatch();
  return result.granted;
}

/**
 * Android: notices while the app is not visible come from the module's foreground service,
 * which polls the relay's account feed (as the WebView shell does). Runs only while signed in
 * to a relay with notification permission.
 */
export function syncBackgroundWatch() {
  const account = accountStore.get();
  // Signed out: notices that name threads go too (both platforms).
  if (account.phase === 'signedOut' || account.phase === 'none') void Notifications.dismissAllNotificationsAsync().catch(() => undefined);
  if (Platform.OS !== 'android' || !pockymoeNative?.startThreadWatch) return;
  const token = relaySessionToken();
  if (account.phase === 'ready' && account.origin && token && notifyStore.get().permission === 'granted') {
    const scheme = String(Constants.expoConfig?.scheme ?? 'pockymoe-app-dev');
    notifyStore.set({ native: pockymoeNative.startThreadWatch(account.origin, token, scheme, {
      title: 'Pockymoe', done: translate('native.notifyDone'), failed: translate('native.notifyFailed'), waiting: translate('native.notifyWaiting'),
      watchTitle: translate('native.watchTitle'), watchChannel: translate('native.watchChannel'), threadsChannel: translate('native.threads'),
    }) ? 'registered' : 'failed' });
    rememberNames();
  } else pockymoeNative.stopThreadWatch?.();
}

// The watch service names a notice's thread and device from titles this app already decrypted.
let namesTimer: ReturnType<typeof setTimeout> | null = null;
let namesSent = '';
function rememberNames() {
  if (Platform.OS !== 'android' || !pockymoeNative?.rememberThreadNames || notifyStore.get().native !== 'registered') return;
  const names: Record<string, string> = {};
  for (const [key, data] of Object.entries(deviceDataStore.get())) {
    if (!key.startsWith('relay:')) continue;
    const deviceId = key.slice(6);
    const device = findDevice(key);
    if (device?.name) names[`device:${deviceId}`] = device.name;
    for (const thread of [...data.threads].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, 150))
      if (thread.title) names[`${deviceId}/${thread.id}`] = thread.title;
  }
  const encoded = JSON.stringify(names);
  if (encoded === namesSent) return;
  namesSent = encoded;
  pockymoeNative.rememberThreadNames(names);
}
deviceDataStore.subscribe(() => {
  if (namesTimer) return;
  namesTimer = setTimeout(() => { namesTimer = null; rememberNames(); }, 3000);
});

async function registerApns() {
  try {
    const token = await Notifications.getDevicePushTokenAsync();
    const response = await fetch(relayUrl('relay/account/notifications/native'), { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceToken: String(token.data), sandbox: __DEV__, appKind: 'ios' }) });
    notifyStore.set({ native: response.ok ? 'registered' : response.status === 503 ? 'unavailable' : 'failed' });
  } catch { notifyStore.set({ native: 'failed' }); }
}

export async function loadNotificationScope() {
  if (accountStore.get().phase !== 'ready') return;
  try {
    const prefs = await relayFetchJson<NotificationPrefs>('relay/account/notifications/preferences');
    if (prefs && ['subscribed', 'all', 'selected'].includes(prefs.scope)) notifyStore.set({ scope: prefs.scope, prefs: { scope: prefs.scope, devices: prefs.devices ?? [], workspaces: prefs.workspaces ?? [] } });
  } catch { /* keep the last known */ }
}

/** Saves the account's scope (and the selected devices and workspaces) on the relay. */
export async function saveNotificationPrefs(next: NotificationPrefs) {
  const saved = await relayFetchJson<NotificationPrefs>('relay/account/notifications/preferences', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) });
  const value = saved && saved.scope ? saved : next;
  notifyStore.set({ scope: value.scope, prefs: value });
  return value;
}

const turnKey = (deviceId: string, threadId: string, turnId: string) => `${deviceId}/${threadId}/${turnId}`;
export async function setTurnSubscription(deviceId: string, threadId: string, turnId: string, subscribed: boolean) {
  const key = turnKey(deviceId, threadId, turnId);
  notifyStore.set(s => ({ subscribed: { ...s.subscribed, [key]: subscribed } }));
  // A direct Supervisor (`direct:<url>`): the subscription lives in the app, which notifies from
  // the device socket while it runs.
  if (deviceId.startsWith('direct:')) {
    if (subscribed && notifyStore.get().permission !== 'granted' && !(await enableNotifications())) {
      notifyStore.set(s => ({ subscribed: { ...s.subscribed, [key]: false } }));
      throw new Error(translate('native.notificationsDenied'));
    }
    return;
  }
  try {
    await relayFetchJson(`relay/account/notifications/turns/${encodeURIComponent(deviceId)}/${encodeURIComponent(threadId)}/${encodeURIComponent(turnId)}`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscribed }) });
    if (subscribed && notifyStore.get().permission !== 'granted') await enableNotifications();
  } catch (error) {
    notifyStore.set(s => ({ subscribed: { ...s.subscribed, [key]: !subscribed } }));
    throw error;
  }
}
export const isTurnSubscribed = (deviceId: string, threadId: string, turnId: string) => !!notifyStore.get().subscribed[turnKey(deviceId, threadId, turnId)];

/** Device socket events → local notifications, under the account's scope. */
export function notifyFromEvent(deviceKey: string, event: ThreadEventEnvelope) {
  if (notifyStore.get().permission !== 'granted') return;
  const kind = event.type === 'thread.turn.completed' ? (event.payload.status === 'failed' ? 'failed' : event.payload.status === 'interrupted' ? null : 'completed')
    : event.type === 'thread.request.created' ? 'waiting' : null;
  if (!kind) return;
  const key = `${deviceKey}::${event.threadId}`;
  if (AppState.currentState === 'active' && visibleThread.key === key) return;
  // In the background, Android's watch service posts relay notices; avoid doubles.
  if (Platform.OS === 'android' && AppState.currentState !== 'active' && notifyStore.get().native === 'registered' && deviceKey.startsWith('relay:')) return;
  const deviceId = deviceKey.startsWith('relay:') ? deviceKey.slice(6) : deviceKey;
  const turnId = 'turnId' in event.payload ? String(event.payload.turnId) : event.type === 'thread.request.created' ? event.payload.request.turnId ?? '' : '';
  const scope = notifyStore.get().scope;
  if (scope === 'subscribed' && !isTurnSubscribed(deviceId, event.threadId, turnId)) return;
  const thread = deviceDataStore.get()[deviceKey]?.threads.find(t => t.id === event.threadId);
  if (scope === 'selected') {
    const prefs = notifyStore.get().prefs;
    const picked = !!prefs && (prefs.devices.some(d => d.deviceId === deviceId) || (!!thread && prefs.workspaces.some(w => w.deviceId === deviceId && w.workspaceId === thread.workspaceId)));
    if (!picked) return;
  }
  const device = findDevice(deviceKey);
  void Notifications.scheduleNotificationAsync({
    content: {
      title: thread?.title ?? translate('native.threads'),
      body: kind === 'waiting' ? translate('native.notifyWaiting') : kind === 'failed' ? translate('native.notifyFailed') : translate('native.notifyDone'),
      subtitle: device?.name,
      data: { deviceKey, threadId: event.threadId },
      ...(Platform.OS === 'android' ? { channelId: 'threads' } : {}),
    },
    trigger: null,
  });
}

/** A tapped notification opens its thread. */
export function installNotificationRouting() {
  const open = (data: unknown) => {
    const { deviceKey, threadId } = (data ?? {}) as { deviceKey?: string; threadId?: string };
    if (!deviceKey || !threadId || !navigationRef.isReady()) return;
    selectionStore.set({ deviceKey });
    navigationRef.navigate('Thread', { deviceKey, threadId });
  };
  void Notifications.getLastNotificationResponseAsync().then(r => r && open(r.notification.request.content.data));
  const sub = Notifications.addNotificationResponseReceivedListener(r => open(r.notification.request.content.data));
  // Background watch notices open `<scheme>://thread/<device>/<thread>`.
  const openUrl = (url: string | null) => {
    if (!url) return;
    const parsed = Linking.parse(url);
    const parts = [parsed.hostname, ...(parsed.path ?? '').split('/')].filter(Boolean);
    if (parts[0] === 'thread' && parts[1] && parts[2]) open({ deviceKey: `relay:${parts[1]}`, threadId: parts[2] });
  };
  void Linking.getInitialURL().then(openUrl);
  const linkSub = Linking.addEventListener('url', e => openUrl(e.url));
  void Notifications.getPermissionsAsync().then(p => { notifyStore.set({ permission: p.granted ? 'granted' : p.canAskAgain ? 'unknown' : 'denied' }); syncBackgroundWatch(); });
  return () => { sub.remove(); linkSub.remove(); };
}
