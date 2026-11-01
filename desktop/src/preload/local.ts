import { contextBridge, ipcRenderer } from 'electron';
// Keep this sandboxed entry self-contained; Electron sandbox cannot require
// Rollup's shared chunks from disk.
const c = { localGet: 'rcDesktop.getState', localState: 'rcDesktop.state', localAction: 'rcDesktop.action' } as const;
import type { LocalBridge, LocalState } from '../shared/local';
const local: LocalBridge = {
  getState: () => ipcRenderer.invoke(c.localGet),
  onState: listener => {
    const handler = (_: Electron.IpcRendererEvent, state: LocalState): void => listener(state);
    ipcRenderer.on(c.localState, handler);
    return () => ipcRenderer.removeListener(c.localState, handler);
  },
  action: action => ipcRenderer.invoke(c.localAction, action)
};
if (process.isMainFrame && (location.protocol === 'file:' || process.argv.includes('--rc-local-dev'))) contextBridge.exposeInMainWorld('rcDesktop', local);
