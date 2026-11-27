// Devices the app can open: the relay account's devices (and devices shared with it)
// plus saved direct Supervisors. Each has a transport target and a connection state.
import { setTransportReporter, type TransportStatus } from '@pockymoe/web/relayTransportCrypto';
import { relayApi, directAuth, DeviceApi } from '../protocol/api';
import type { Target } from '../protocol/transport';
import { prefs } from '../platform/prefs';
import { createStore } from '../state/store';
import { accountStore } from './account';
import { directTokens } from './secrets';

export interface DeviceEntry {
  key: string;
  name: string;
  target: Target;
  kind: 'relay' | 'direct';
  /** null while unknown. */
  online: boolean | null;
  lastSeenAt: string | null;
  /** When the current relay connection began (relay devices). */
  connectedAt?: string | null;
  /** Someone else's device shared with this account. */
  shared: boolean;
  /** Direct Supervisors that ask for a passcode. */
  needsPasscode?: boolean;
}
interface DevicesState { relay: DeviceEntry[]; direct: DeviceEntry[]; loading: boolean; error: string | null; loadedAt: number; transport: Record<string, TransportStatus> }
export const devicesStore = createStore<DevicesState>({ relay: [], direct: [], loading: false, error: null, loadedAt: 0, transport: {} });

setTransportReporter(status => devicesStore.set(s => {
  const previous = s.transport[status.deviceId];
  if (previous && previous.state === status.state && previous.bound === status.bound && previous.certificateVerified === status.certificateVerified) return {};
  return { transport: { ...s.transport, [status.deviceId]: status } };
}));

export const allDevices = (s: DevicesState) => [...s.relay, ...s.direct];
const apis = new Map<string, DeviceApi>();
export function deviceApi(entry: Pick<DeviceEntry, 'key' | 'target'>) {
  let api = apis.get(entry.key);
  if (!api || JSON.stringify(api.target) !== JSON.stringify(entry.target)) apis.set(entry.key, api = new DeviceApi(entry.target));
  return api;
}
export function findDevice(key: string | null | undefined) {
  return key ? allDevices(devicesStore.get()).find(d => d.key === key) ?? null : null;
}

/** Agent isolation per device (the Web card's "Isolated" pill), fetched when a device list shows. */
export const isolationStore = createStore<Record<string, boolean>>({});
export function loadIsolation(entries: DeviceEntry[]) {
  for (const d of entries) {
    if (d.kind !== 'relay' || d.shared || d.online !== true) continue;
    deviceApi(d).raw('/api/config/agent-isolation').then(v => isolationStore.set({ [d.key]: !!(v as { device?: boolean })?.device }), () => undefined);
  }
}

export async function refreshRelayDevices() {
  if (accountStore.get().phase !== 'ready') { devicesStore.set({ relay: [] }); return; }
  devicesStore.set({ loading: true });
  try {
    const portal = await relayApi.portal();
    const own: DeviceEntry[] = portal.devices.map(d => ({ key: `relay:${d.id}`, name: d.name, target: { kind: 'relay', deviceId: d.id }, kind: 'relay',
      online: d.connected, lastSeenAt: d.lastHeartbeatAt ?? d.connectedAt, connectedAt: d.connected ? d.connectedAt : null, shared: false }));
    const shared: DeviceEntry[] = (portal.sharedDevicesWithMe ?? []).filter(g => !own.some(d => d.key === `relay:${g.deviceId}`)).map(g => ({
      key: `relay:${g.deviceId}`, name: g.deviceName || g.deviceId.slice(0, 8), target: { kind: 'relay', deviceId: g.deviceId }, kind: 'relay',
      online: g.deviceConnected ?? null, lastSeenAt: null, shared: true }));
    devicesStore.set({ relay: [...own, ...shared], loading: false, error: null, loadedAt: Date.now() });
  } catch (error) {
    devicesStore.set({ loading: false, error: String((error as Error)?.message ?? error) });
  }
}

// ---- direct Supervisors ---------------------------------------------------------------
const DIRECT_KEY = 'pockymoe-native.direct';
interface SavedDirect { url: string; label: string }
const savedDirect = () => prefs.getJson<SavedDirect[]>(DIRECT_KEY) ?? [];

export function normalizeSupervisorUrl(input: string) {
  const trimmed = input.trim().replace(/\/+$/, '');
  const url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

export async function loadDirect() {
  const entries = await Promise.all(savedDirect().map(async saved => {
    const token = await directTokens.load(saved.url).catch(() => null);
    return { key: `direct:${saved.url}`, name: saved.label, target: { kind: 'direct', baseUrl: saved.url, token }, kind: 'direct', online: null, lastSeenAt: null, shared: false } satisfies DeviceEntry;
  }));
  devicesStore.set({ direct: entries });
  await Promise.all(entries.map(probeDirect));
}

export async function probeDirect(entry: DeviceEntry) {
  if (entry.target.kind !== 'direct') return;
  const update = (patch: Partial<DeviceEntry>) => devicesStore.set(s => ({ direct: s.direct.map(d => d.key === entry.key ? { ...d, ...patch } : d) }));
  try {
    const session = await directAuth.session(entry.target.baseUrl, entry.target.token);
    update({ online: true, lastSeenAt: new Date().toISOString(), needsPasscode: session.authRequired && !session.authenticated });
  } catch { update({ online: false }); }
}

/** A direct Supervisor's reachability as its live socket sees it (a probe only runs now and then). */
export function setDirectOnline(key: string, online: boolean) {
  devicesStore.set(s => {
    const entry = s.direct.find(d => d.key === key);
    if (!entry || entry.online === online) return {};
    return { direct: s.direct.map(d => d.key === key ? { ...d, online, ...(online ? { lastSeenAt: new Date().toISOString() } : {}) } : d) };
  });
}

/** Re-checks every saved Supervisor (startup, the periodic refresh, coming back to the app). */
export function probeAllDirect() { return Promise.all(devicesStore.get().direct.map(probeDirect)); }

/** Adds a Supervisor by URL; returns whether it asks for a passcode. */
export async function addDirect(input: string, label?: string) {
  const url = normalizeSupervisorUrl(input);
  const session = await directAuth.session(url, null);
  const list = savedDirect().filter(d => d.url !== url);
  const host = new URL(url).host;
  prefs.setJson(DIRECT_KEY, [...list, { url, label: label?.trim() || host }]);
  await loadDirect();
  return { url, needsPasscode: session.authRequired && !session.authenticated };
}
export async function signInDirect(url: string, passcode: string) {
  const result = await directAuth.login(url, passcode);
  if (!result.token) throw new Error('No session token');
  await directTokens.save(url, result.token);
  await loadDirect();
}
export async function removeDirect(url: string) {
  prefs.setJson(DIRECT_KEY, savedDirect().filter(d => d.url !== url));
  await directTokens.save(url, null);
  await loadDirect();
}
export async function renameDirect(url: string, label: string) {
  prefs.setJson(DIRECT_KEY, savedDirect().map(d => d.url === url ? { ...d, label } : d));
  await loadDirect();
}
