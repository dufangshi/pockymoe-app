import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { expect, it, vi } from 'vitest';
import { canUnload, closeForUpdate } from '../src/main/updateWindows';
function fixture(veto: boolean) {
  const contents = new EventEmitter() as EventEmitter & { executeJavaScript: () => Promise<boolean> };
  contents.executeJavaScript = vi.fn().mockResolvedValue(!veto);
  let destroyed = false;
  const window = Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => destroyed,
    close: vi.fn(() => { if (veto) contents.emit('will-prevent-unload'); else { destroyed = true; window.emit('closed'); } }) });
  Object.defineProperty(window, 'webContents', { get: () => { if (destroyed) throw new Error('Native window was destroyed'); return contents; } });
  return { window: window as unknown as BrowserWindow, contents };
}
it('preflights without closing a page and never overrides a real unload veto', async () => {
  const { window, contents } = fixture(true);
  expect(await canUnload(window)).toBe(false); expect(window.close).not.toHaveBeenCalled();
  const listener = vi.fn(); contents.on('will-prevent-unload', listener);
  expect(await closeForUpdate(window)).toBe(false); expect(window.isDestroyed()).toBe(false);
  expect(listener).toHaveBeenCalledOnce();
});
it('resolves only after the native closed event', async () => {
  const { window } = fixture(false); expect(await canUnload(window)).toBe(true);
  expect(await closeForUpdate(window)).toBe(true); expect(window.isDestroyed()).toBe(true);
});
