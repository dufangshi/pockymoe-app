import type { BrowserWindow } from 'electron';
export class UpdateCancelled extends Error { readonly code = 'updateCancelled'; }
export async function canUnload(window: BrowserWindow): Promise<boolean> {
  if (window.isDestroyed()) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      window.webContents.executeJavaScript(`(() => { const event = new Event('beforeunload', {cancelable:true}); return window.dispatchEvent(event) && !event.defaultPrevented; })()`).then(result => result === true, () => false),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 3000); })
    ]);
  } finally { clearTimeout(timer); }
}
/** Never override will-prevent-unload: refusal keeps the page and app alive. */
export async function closeForUpdate(window: BrowserWindow): Promise<boolean> {
  if (window.isDestroyed()) return true;
  const contents = window.webContents;
  return new Promise(resolve => {
    const finish = (closed: boolean): void => {
      clearTimeout(timer); window.removeListener('closed', onClosed);
      contents.removeListener('will-prevent-unload', refused); resolve(closed);
    };
    const onClosed = (): void => finish(true);
    const refused = (): void => finish(false);
    const timer = setTimeout(() => finish(window.isDestroyed()), 3000);
    window.once('closed', onClosed); contents.once('will-prevent-unload', refused);
    try { window.close(); } catch { finish(false); }
  });
}
