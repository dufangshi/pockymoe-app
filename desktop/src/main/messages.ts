import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from 'electron';
import type { LocalMessage } from '../shared/local';

/** Serializes local confirmations and rejects replies from another window or an older prompt. */
export class LocalMessages {
  private nextId = 0;
  private queue = Promise.resolve();
  private disposed = false;
  private current?: { window: BrowserWindow; message: LocalMessage; finish(response: number): void };
  constructor(private changed: () => void) {}
  view(windowId: number): LocalMessage | null { return this.current?.window.id === windowId ? this.current.message : null; }
  show(options: MessageBoxOptions, window: BrowserWindow): Promise<MessageBoxReturnValue> {
    const buttons = options.buttons?.length ? [...options.buttons] : ['OK'];
    const cancelId = options.cancelId ?? buttons.length - 1;
    const result = this.queue.then(() => new Promise<MessageBoxReturnValue>(resolve => {
      if (this.disposed || window.isDestroyed()) { resolve({ response: cancelId, checkboxChecked: false }); return; }
      const finish = (response: number): void => {
        window.removeListener('closed', cancel); window.removeListener('hide', cancel);
        this.current = undefined; this.changed(); resolve({ response, checkboxChecked: false });
      };
      const cancel = (): void => finish(cancelId);
      this.current = { window, finish, message: { id: ++this.nextId, title: options.title || 'Pockymoe', message: options.message, detail: options.detail || '', buttons, cancelId, defaultId: options.defaultId ?? 0 } };
      window.once('closed', cancel); window.once('hide', cancel);
      window.show(); window.focus(); this.changed();
    }));
    this.queue = result.then(() => undefined);
    return result;
  }
  respond(windowId: number, id: number, response: number): boolean {
    const current = this.current;
    if (!current || current.window.id !== windowId || current.message.id !== id || !Number.isInteger(response) || response < 0 || response >= current.message.buttons.length) return false;
    current.finish(response); return true;
  }
  dispose(): void { this.disposed = true; if (this.current) this.current.finish(this.current.message.cancelId); }
}
