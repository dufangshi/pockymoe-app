import { contextBridge, ipcRenderer } from 'electron';
import type { PetAction, PetBridge, PetViewState } from './bridge';
const pet: PetBridge = {
  ready: () => ipcRenderer.send('rcDesktop:pet:ready'),
  hitTest: (interactive) => ipcRenderer.send('rcDesktop:pet:hitTest', interactive === true),
  action: (action: PetAction) => ipcRenderer.invoke('rcDesktop:pet:action', action),
  onState: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: PetViewState): void => listener(state);
    ipcRenderer.on('rcDesktop:pet:state', wrapped);
    return () => ipcRenderer.removeListener('rcDesktop:pet:state', wrapped);
  },
};
if (process.isMainFrame) contextBridge.exposeInMainWorld('rcDesktop', { pet });
