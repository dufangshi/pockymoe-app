import { contextBridge, ipcRenderer } from 'electron';
import type { PetAction, PetBridge, PetCue, PetPackImages, PetStateMessage } from './bridge';
let images: PetPackImages & { epoch: number } = { epoch: -1, imageUrl: '' };
ipcRenderer.on('rcDesktop:pet:pack', (_event, next: typeof images) => { images = next; });
const pet: PetBridge = {
  onCursor: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, cursor: { x: number; y: number } | null): void => listener(cursor);
    ipcRenderer.on('rcDesktop:pet:cursor', wrapped);
    return () => ipcRenderer.removeListener('rcDesktop:pet:cursor', wrapped);
  },
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
    const wrapped = (_event: Electron.IpcRendererEvent, state: PetStateMessage): void => {
      if (state.packEpoch === images.epoch) listener({ ...state, ...images });
    };
    ipcRenderer.on('rcDesktop:pet:state', wrapped);
    return () => ipcRenderer.removeListener('rcDesktop:pet:state', wrapped);
  },
};
if (process.isMainFrame) contextBridge.exposeInMainWorld('rcDesktop', { pet });
