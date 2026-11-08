import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import type { RivePack } from './rive';
/** A fresh sandbox with no preload, credentials or host bridge; destroyed on rejection/timeout. */
export async function verifyRivePack(bytes: Buffer, config: RivePack): Promise<void> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      partition: 'rive-pack-validation',
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  const devOrigin = process.env.ELECTRON_RENDERER_URL
    ? new URL(process.env.ELECTRON_RENDERER_URL).origin
    : null;
  window.webContents.session.webRequest.onBeforeRequest((details, callback) =>
    callback({
      cancel: !details.url.startsWith('file:') && !(devOrigin && new URL(details.url).origin === devOrigin),
    }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        const dev = process.env.ELECTRON_RENDERER_URL;
        if (dev) await window.loadURL(`${dev.replace(/\/$/, '')}/pet/riveValidate.html`);
        else await window.loadFile(join(__dirname, '../renderer/pet/riveValidate.html'));
        // Keep each script below DevTools/V8's large-string parsing cliff. There
        // is no network exception or host bridge in the validation sandbox.
        await window.webContents.executeJavaScript(
          `globalThis.riveValidationBytes = new Uint8Array(${bytes.length})`,
        );
        for (let offset = 0; offset < bytes.length; offset += 1024 * 1024) {
          const chunk = bytes.subarray(offset, offset + 1024 * 1024).toString('base64');
          await window.webContents.executeJavaScript(
            `globalThis.riveValidationBytes.set(
              Uint8Array.from(atob(${JSON.stringify(chunk)}), c => c.charCodeAt(0)), ${offset})`,
          );
        }
        await window.webContents.executeJavaScript(
          `(() => {
            const bytes = globalThis.riveValidationBytes;
            delete globalThis.riveValidationBytes;
            return window.verifyRive(bytes, ${JSON.stringify(config)});
          })()`,
        );
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Rive validation timed out')), 30000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (!window.isDestroyed()) window.destroy();
  }
}
