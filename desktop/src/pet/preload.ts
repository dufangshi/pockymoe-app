import { contextBridge, ipcRenderer } from 'electron';
import type { PetAction, PetBridge, PetCue, PetViewState } from './bridge';
const pet: PetBridge = {
  ready: () => ipcRenderer.send('rcDesktop:pet:ready'),
  hitTest: (interactive, motion) => ipcRenderer.send('rcDesktop:pet:hitTest', interactive === true, motion),
  action: (action: PetAction) => ipcRenderer.invoke('rcDesktop:pet:action', action),
  onCue: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, cue: PetCue): void => listener(cue);
    ipcRenderer.on('rcDesktop:pet:cue', wrapped);
    return () => ipcRenderer.removeListener('rcDesktop:pet:cue', wrapped);
  },
  clip: (path) => ipcRenderer.invoke('rcDesktop:pet:clip', path),
  onSpeech: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, audio: Uint8Array, id: number): void =>
      listener(audio, id);
    ipcRenderer.on('rcDesktop:pet:speech', wrapped);
    return () => ipcRenderer.removeListener('rcDesktop:pet:speech', wrapped);
  },
  onState: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: PetViewState): void => listener(state);
    ipcRenderer.on('rcDesktop:pet:state', wrapped);
    return () => ipcRenderer.removeListener('rcDesktop:pet:state', wrapped);
  },
};
if (process.isMainFrame) contextBridge.exposeInMainWorld('rcDesktop', { pet });
