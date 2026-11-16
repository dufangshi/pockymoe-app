import { contextBridge, ipcRenderer } from 'electron';
// Keep this sandboxed entry self-contained; Electron sandbox cannot require
// Rollup's shared chunks from disk.
const c = { localGet: 'pockymoeDesktop.getState', localState: 'pockymoeDesktop.state', localAction: 'pockymoeDesktop.action' } as const;
import type { LocalBridge, LocalState } from '../shared/local';
let rendering = true;
const renderingListeners = new Set<(rendering: boolean) => void>();
ipcRenderer.on('rcDesktop:rendering', (_event, next: boolean) => {
  rendering = next === true;
  renderingListeners.forEach(listener => listener(rendering));
});
const local: LocalBridge = {
  onRendering: listener => {
    renderingListeners.add(listener); listener(rendering);
    return () => { renderingListeners.delete(listener); };
  },
  getState: () => ipcRenderer.invoke(c.localGet),
  onState: listener => {
    let pending: LocalState | undefined;
    const wake = (): void => { if (rendering && pending) { const state = pending; pending = undefined; listener(state); } };
    const handler = (_: Electron.IpcRendererEvent, state: LocalState): void => { pending = state; wake(); };
    renderingListeners.add(wake);
    ipcRenderer.on(c.localState, handler);
    return () => { ipcRenderer.removeListener(c.localState, handler); renderingListeners.delete(wake); };
  },
  action: action => ipcRenderer.invoke(c.localAction, action)
};
if (process.isMainFrame && (location.protocol === 'file:' || process.argv.includes('--pockymoe-local-dev'))) contextBridge.exposeInMainWorld('pockymoeDesktop', local);
