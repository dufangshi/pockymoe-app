// The native counterpart of the Web's relayTransport.ts. Every device request goes
// through the vendored `exchange()` (HPKE-sealed, signed with this app's browser key
// when the device is bound); sockets use the vendored `SocketCipher`. A direct
// Supervisor is plain HTTP(S) with an optional bearer token.
import { exchange, SocketCipher, TransportError, type WireMessage } from '@pockymoe/web/relayTransportCrypto';
import { relayUrl, relaySocketUrl } from '@pockymoe/web/relayOrigin';
import { relaySocketHeaders } from '../platform/relaySession';

export type Target =
  | { kind: 'relay'; deviceId: string }
  | { kind: 'direct'; baseUrl: string; token: string | null };

export function targetKey(target: Target) {
  return target.kind === 'relay' ? `relay:${target.deviceId}` : `direct:${target.baseUrl}`;
}

/** `path` starts with `/api/`. */
export async function deviceFetch(target: Target, path: string, init: RequestInit = {}, threadScope?: string): Promise<Response> {
  if (target.kind === 'direct') {
    const headers = new Headers(init.headers);
    if (target.token && !headers.has('authorization')) headers.set('authorization', `Bearer ${target.token}`);
    return fetch(`${target.baseUrl}${path}`, { ...init, headers, credentials: 'omit' });
  }
  const url = relayUrl(`relay/devices/${encodeURIComponent(target.deviceId)}${path}`);
  const { response } = await exchange(new Request(url, { ...init, credentials: 'include' }), threadScope);
  return response;
}

type Listener = (event: { data?: string; code?: number; reason?: string }) => void;

/**
 * A WebSocket-shaped connection to one device's `/ws`: for a relay device, an
 * encrypted channel created with `POST /api/transport/session`; for a direct
 * Supervisor, the plain socket with its token.
 */
export class DeviceSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  readyState = DeviceSocket.CONNECTING;
  private socket?: WebSocket;
  private cipher?: SocketCipher;
  private incoming = Promise.resolve();
  private outgoing = Promise.resolve();
  private listeners = new Map<string, Set<Listener>>();
  private aborted = false;
  constructor(readonly target: Target, readonly threadId: string | null = null) { void this.connect(); }

  on(type: 'open' | 'message' | 'close' | 'error', listener: Listener) {
    let set = this.listeners.get(type); if (!set) this.listeners.set(type, set = new Set());
    set.add(listener); return () => { set!.delete(listener); };
  }
  private emit(type: string, event: Parameters<Listener>[0] = {}) { this.listeners.get(type)?.forEach(l => l(event)); }

  private async connect() {
    try {
      let url: string;
      let headers: Record<string, string> = {};
      if (this.target.kind === 'direct') {
        const ws = new URL(`${this.target.baseUrl}/ws`);
        ws.protocol = ws.protocol === 'https:' ? 'wss:' : 'ws:';
        if (this.target.token) ws.searchParams.set('token', this.target.token);
        url = ws.toString();
      } else {
        const id = encodeURIComponent(this.target.deviceId);
        const prefix = this.threadId ? `/api/threads/${encodeURIComponent(this.threadId)}` : '/api';
        const result = await exchange(new Request(relayUrl(`relay/devices/${id}${prefix}/transport/session`), {
          method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}',
        }), this.threadId ?? undefined, undefined, true);
        if (!result.sendKey || !result.receiveKey || !result.response.ok)
          throw new TransportError('transport_unavailable', `Encrypted session refused (${result.response.status})`, result.response.status);
        const { channelId } = await result.response.json() as { channelId: string };
        this.cipher = new SocketCipher(channelId, result.sendKey, result.receiveKey);
        const ws = new URL(relaySocketUrl(`relay/devices/${id}/ws`));
        ws.searchParams.set('channelId', channelId);
        if (this.threadId) ws.searchParams.set('threadId', this.threadId);
        url = ws.toString();
        headers = relaySocketHeaders(url);
      }
      if (this.aborted) return;
      // React Native's WebSocket takes headers as a third argument.
      const Socket = WebSocket as unknown as new (url: string, protocols: string[] | null, options: { headers: Record<string, string> }) => WebSocket;
      const socket = new Socket(url, null, { headers });
      this.socket = socket;
      socket.onopen = () => { this.readyState = DeviceSocket.OPEN; this.emit('open'); };
      socket.onclose = event => { this.readyState = DeviceSocket.CLOSED; this.emit('close', { code: event.code, reason: event.reason }); };
      socket.onerror = () => this.emit('error');
      socket.onmessage = event => {
        this.incoming = this.incoming.then(async () => {
          const raw = String(event.data);
          const data = this.cipher ? JSON.stringify(await this.cipher.open(JSON.parse(raw) as WireMessage)) : raw;
          this.emit('message', { data });
        }).catch(() => this.fail('Event verification failed'));
      };
    } catch (error) {
      if (__DEV__) console.log('[socket] connect failed', (error as Error)?.stack ?? error);
      this.fail(error instanceof Error ? error.message : 'Connection failed', (error as { status?: number })?.status);
    }
  }
  send(message: WireMessage) {
    if (this.readyState !== DeviceSocket.OPEN) return;
    this.outgoing = this.outgoing.then(async () => {
      const payload = this.cipher ? JSON.stringify(await this.cipher.seal(message)) : JSON.stringify(message);
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(payload);
    }).catch(() => this.fail('Event send failed'));
  }
  close(code = 1000, reason = '') {
    this.aborted = true;
    if (this.readyState === DeviceSocket.CLOSED) return;
    this.readyState = DeviceSocket.CLOSING;
    if (this.socket) this.socket.close(code, reason);
    else { this.readyState = DeviceSocket.CLOSED; this.emit('close', { code, reason }); }
  }
  private fail(message: string, status?: number) {
    if (this.readyState === DeviceSocket.CLOSED) return;
    this.emit('error');
    this.socket?.close(4000, 'Encrypted connection failed');
    this.readyState = DeviceSocket.CLOSED;
    this.emit('close', { code: status === 401 ? 4401 : 4000, reason: message.slice(0, 120) });
  }
}
