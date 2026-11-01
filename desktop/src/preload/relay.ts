import { contextBridge, ipcRenderer } from 'electron';
import type { HostCommand, RemoteCodexHost } from '../shared/contract';
import { channels as c } from '../shared/channels';

const origin = process.argv.find(a => a.startsWith('--rc-relay-origin='))?.slice('--rc-relay-origin='.length);
const allowed = (): boolean => process.isMainFrame && window.top === window && location.origin === origin;
const guard = (): void => { if (!allowed()) throw new Error('Desktop bridge unavailable for this frame'); };
const send = (channel: string, ...args: unknown[]): void => { guard(); ipcRenderer.send(channel, ...args); };
const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => { guard(); return ipcRenderer.invoke(channel, ...args); };
if (allowed()) {
  const host: RemoteCodexHost = {
    capabilities: () => invoke(c.capabilities),
    activity: { sync: snapshot => send(c.sync, snapshot) },
    onCommand: listener => {
      guard();
      const handler = (_: Electron.IpcRendererEvent, command: HostCommand): void => { if (allowed()) listener(command); };
      ipcRenderer.on(c.command, handler);
      send('desktop.command.ready');
      return () => { guard(); ipcRenderer.removeListener(c.command, handler); };
    },
    commandResult: (id, result) => send(c.commandResult, id, result),
    window: { openThread: (path, options) => send(c.openThread, path, options), setTitle: title => send(c.title, title) },
    shell: { openExternal: url => send(c.external, url) },
    files: { saveAs: (name, data) => invoke(c.save, name, data) },
    pet: { setVisible: visible => send(c.petSet, visible), isVisible: () => invoke(c.petGet) },
    settings: { get: () => invoke(c.settingsGet), set: patch => invoke(c.settingsSet, patch) },
    badge: { set: (count, style) => send(c.badge, count, style) }
  };
  contextBridge.exposeInMainWorld('remoteCodexHost', host);
}
