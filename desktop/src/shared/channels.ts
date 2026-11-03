export const channels = {
  updateState: 'desktop.updates.state', updateChange: 'desktop.updates.change', updateInstall: 'desktop.updates.install',
  preferences: 'desktop.window.openPreferences', appearance: 'desktop.appearance.sync', capabilities: 'desktop.capabilities', sync: 'desktop.activity.sync', command: 'desktop.command',
  commandResult: 'desktop.commandResult', openThread: 'desktop.window.openThread', title: 'desktop.window.title',
  external: 'desktop.shell.openExternal', save: 'desktop.files.saveAs', petSet: 'desktop.pet.setVisible',
  petGet: 'desktop.pet.isVisible', settingsGet: 'desktop.settings.get', settingsSet: 'desktop.settings.set',
  badge: 'desktop.badge.set', localState: 'pockymoeDesktop.state', localGet: 'pockymoeDesktop.getState',
  localAction: 'pockymoeDesktop.action'
} as const;
