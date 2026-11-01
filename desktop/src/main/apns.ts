import { app, pushNotifications } from 'electron';
import type { SettingsStore } from './store';
import type { Windows } from './windows';
import { threadPath } from './security';
export const apnsEnabled = (): boolean => process.platform === 'darwin' && app.isPackaged && process.env.POCKYMOE_DESKTOP_APNS === '1';
let installed = false, registering = false;
let token: Promise<string> | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
export async function registerApns(settings: SettingsStore, windows: Windows): Promise<void> {
  if (!apnsEnabled() || registering || !windows.relay.size) return;
  if (!installed) {
    installed = true;
    pushNotifications.on('received-apns-notification', (_event, info: Record<string, unknown>) => {
      try {
        const path = typeof info.path === 'string' ? threadPath(info.path) : typeof info.deviceId === 'string' && typeof info.threadId === 'string' ? `/devices/${encodeURIComponent(info.deviceId)}/threads/${encodeURIComponent(info.threadId)}` : null;
        if (path) void windows.dispatch({ type: 'navigate', path });
      } catch { /* Ignore malformed remote payloads. */ }
    });
    // A first launch may register before login. Retry when the authenticated
    // session changes, without inspecting or copying cookie/token values.
    windows.main().webContents.session.cookies.on('changed', () => {
      if (registering) return;
      clearTimeout(retry);
      retry = setTimeout(() => { void registerApns(settings, windows); }, 500);
    });
    app.on('before-quit', () => clearTimeout(retry));
  }
  registering = true;
  try {
    token ??= pushNotifications.registerForAPNSNotifications();
    const deviceToken = await token;
    const relayOrigin = settings.get().relayOrigin;
    await windows.main().webContents.session.fetch(`${relayOrigin}/relay/account/notifications/native`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nativePlatform: 'apns', deviceToken, relayOrigin, sandbox: process.env.POCKYMOE_DESKTOP_APNS_SANDBOX === '1', appKind: 'macos-desktop' })
    });
  } catch { /* Missing entitlements, auth and network failures stay quiet. */ }
  finally { registering = false; }
}
