export const channels = {
  capabilities: 'desktop.capabilities', sync: 'desktop.activity.sync', command: 'desktop.command',
  commandResult: 'desktop.commandResult', openThread: 'desktop.window.openThread', title: 'desktop.window.title',
  external: 'desktop.shell.openExternal', save: 'desktop.files.saveAs', petSet: 'desktop.pet.setVisible',
  petGet: 'desktop.pet.isVisible', settingsGet: 'desktop.settings.get', settingsSet: 'desktop.settings.set',
  badge: 'desktop.badge.set', localState: 'rcDesktop.state', localGet: 'rcDesktop.getState',
  localAction: 'rcDesktop.action'
} as const;
