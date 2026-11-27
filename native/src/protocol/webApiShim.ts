// What the vendored gitApi.ts and pull request modules expect from the Web's api.ts:
// `deviceRequest` (JSON over the device transport), `request` (a Web path, which for a
// device is `relay/devices/<key>/api/...`) and `ApiError` with `statusCode` and `payload`.
import { deviceFetch } from './transport';
import { findDevice } from '../connection/devices';

export class ApiError extends Error {
  constructor(message: string, readonly statusCode: number, readonly payload: { code: string; message?: string }) { super(message); }
  get code() { return this.payload.code; }
}
export async function deviceRequest<T>(deviceKey: string | null | undefined, path: string, init: RequestInit = {}, scope?: string): Promise<T> {
  const device = deviceKey ? findDevice(deviceKey) : null;
  if (!device) throw new ApiError('No device selected', 0, { code: 'no_device' });
  const headers = new Headers(init.headers);
  if (typeof init.body === 'string' && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await deviceFetch(device.target, `/${path.replace(/^\//, '')}`, { ...init, headers }, scope);
  const text = await response.text();
  let data: unknown = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const payload = (data && typeof data === 'object' ? data : { code: `http_${response.status}` }) as { code: string; message?: string };
    throw new ApiError(payload.message ?? `HTTP ${response.status}`, response.status, { ...payload, code: payload.code ?? `http_${response.status}` });
  }
  return data as T;
}

/** The Web's `request()` for device paths: `relay/devices/<key>/api/...` goes to that
    device's transport; the native app has no other origin to send `api/...` to. */
export function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const match = /^\/?relay\/devices\/([^/]+)\/(api\/.*)$/.exec(path);
  if (!match) return Promise.reject(new ApiError(`No device for ${path.split('?')[0]}`, 0, { code: 'no_device' }));
  return deviceRequest<T>(decodeURIComponent(match[1]!), match[2]!, init);
}
