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
import { apnsSubscription, noticeFields, noticeTarget } from './apns';
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
  // While the app is open its device sockets post their own notices (which skip the thread on
  // screen), so a relay APNs push arriving then is not shown a second time.
  handleNotification: async notification => {
    const remote = (notification.request.trigger as { type?: string } | null)?.type === 'push';
    const show = !(remote && AppState.currentState === 'active');
    return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: false, shouldSetBadge: false };
  },
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
  if (Platform.OS === 'ios') { syncApns(); return; }
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

/**
 * iOS: registers this install's APNs token with the signed-in relay (docs/thread-notifications.md,
 * relay apns.rs). The relay sends with its POCKYMOE_APNS_TOPIC (app kind "ios"); a development
 * build's token belongs to Apple's sandbox. 503: the relay has no APNs keys or topic.
 */
async function registerApns(deviceToken?: string) {
  const origin = accountStore.get().origin;
  if (!origin) return;
  try {
    // Without a connection to Apple's push service (some simulators) the token never comes: give up
    // after 30 s; the next launch or token change tries again.
    const token = deviceToken ?? String((await withTimeout(Notifications.getDevicePushTokenAsync(), 30_000)).data);
    const sentLive = liveActivityToken;
    const response = await fetch(relayUrl('relay/account/notifications/native'), { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...apnsSubscription(token, origin, String(Constants.expoConfig?.extra?.variant ?? 'development')), ...(sentLive ? { liveActivityToken: sentLive } : {}) }) });
    if (response.ok) {
      const saved = await response.json().catch(() => null) as { id?: string } | null;
      apnsRegistration = saved?.id ?? null;
      // ActivityKit may rotate its token while this registration is in flight.
      if (liveActivityToken && liveActivityToken !== sentLive) void setLiveActivityToken(liveActivityToken);
    }
    notifyStore.set({ native: response.ok ? 'registered' : response.status === 503 ? 'unavailable' : 'failed' });
    apnsRegistered = response.ok ? `${origin}\u0000${token}` : null;
  } catch { notifyStore.set({ native: 'failed' }); apnsRegistered = null; }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(value => { clearTimeout(id); resolve(value); }, error => { clearTimeout(id); reject(error); });
  });
}

// The account Live Activity's push token (iOS), bound to this install's APNs registration so the
// relay can update the activity while the app is closed (docs/thread-notifications.md).
let apnsRegistration: string | null = null;
let liveActivityToken: string | null = null;
export async function setLiveActivityToken(token: string) {
  liveActivityToken = token;
  // Never asks for notification permission because ActivityKit issued a token.
  if (!apnsRegistration) return;
  await fetch(relayUrl('relay/account/notifications/native/live-activity'), { method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: apnsRegistration, token }) }).catch(() => undefined);
}

// Registered once per relay and token; again when iOS hands out a new token.
let apnsRegistered: string | null = null;
let apnsTokenListener: { remove(): void } | null = null;
/** A Personal Team build (free Apple ID) cannot sign the push entitlement (app.config.ts). */
export const pushInBuild = Platform.OS !== 'ios' || Constants.expoConfig?.extra?.iosSigning !== 'personal';

function syncApns() {
  if (!pushInBuild) return;
  const account = accountStore.get();
  const ready = account.phase === 'ready' && !!account.origin && notifyStore.get().permission === 'granted';
  if (!ready) { apnsRegistered = null; apnsRegistration = null; if (account.phase !== 'ready') liveActivityToken = null; return; }
  apnsTokenListener ??= Notifications.addPushTokenListener(token => { if (accountStore.get().phase === 'ready') void registerApns(String(token.data)); });
  if (apnsRegistered?.startsWith(`${account.origin}\u0000`)) return;
  apnsRegistered = `${account.origin}\u0000`;
  void registerApns();
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
  // (iOS: the relay's APNs push does the same.)
  if (AppState.currentState !== 'active' && notifyStore.get().native === 'registered' && deviceKey.startsWith('relay:')) return;
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
  // A tap that launched the app arrives before navigation is ready: retry for a few seconds.
  const open = (target: { deviceKey: string; threadId: string } | null, tries = 40) => {
    if (!target) return;
    if (!navigationRef.isReady()) { if (tries > 0) setTimeout(() => open(target, tries - 1), 250); return; }
    const { deviceKey, threadId } = target;
    selectionStore.set({ deviceKey });
    navigationRef.navigate('Thread', { deviceKey, threadId });
  };
  void Notifications.getLastNotificationResponseAsync().then(r => r && open(noticeTarget(noticeFields(r.notification.request.trigger, r.notification.request.content.data))));
  const sub = Notifications.addNotificationResponseReceivedListener(r => open(noticeTarget(noticeFields(r.notification.request.trigger, r.notification.request.content.data))));
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
