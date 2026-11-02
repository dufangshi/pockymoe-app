import type { ElectronApplication } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
/** Safe lifecycle evidence for hangs: no environment, user strings or URL queries. */
export async function recordLifecycle(app: ElectronApplication, path: string): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  app.process().once('exit', (code, signal) => appendFileSync(path, JSON.stringify({ event: 'process-exit', code, signal }) + '\n'));
  await app.evaluate(({ app, BrowserWindow }, path) => {
    const { appendFileSync } = process.getBuiltinModule('fs');
    const record = (event: string, extra: object = {}): void => appendFileSync(path, JSON.stringify({ event, ready: app.isReady(), runtime: '__pockymoeDesktopTest' in globalThis,
      windows: BrowserWindow.getAllWindows().map(window => ({ id: window.id, visible: window.isVisible(), loading: window.webContents.isLoading(), path: new URL(window.webContents.getURL() || 'about:blank').pathname })), ...extra }) + '\n');
    record('driver-connected');
    for (const event of ['before-quit', 'will-quit', 'quit', 'window-all-closed'] as const) (app as NodeJS.EventEmitter).on(event, () => record(event));
    process.on('uncaughtExceptionMonitor', error => record('uncaught-exception', { name: error.name, frames: error.stack?.split('\n').filter(line => line.trim().startsWith('at ')) }));
    app.on('render-process-gone', (_event, contents, details) => record('renderer-exit', { id: contents.id, reason: details.reason, code: details.exitCode }));
  }, path);
}
