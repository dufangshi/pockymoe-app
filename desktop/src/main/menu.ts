import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import type { SettingsStore } from './store';
import type { Windows } from './windows';
export function installMenu(windows: Windows, settings: SettingsStore): void {
  const command = (type: 'openMap' | 'newThread' | 'openDevices') => (): void => { void windows.dispatch({ type }); };
  const pageKey = (keyCode: string, modifiers: NonNullable<Electron.KeyboardInputEvent['modifiers']>) => (): void => {
    const wc = windows.focusMain().webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  };
  const mod = process.platform === 'darwin' ? 'meta' : 'control';
  const appMenu: MenuItemConstructorOptions = { label: app.name, submenu: [
    { role: 'about' }, { type: 'separator' }, { label: '设置…', accelerator: 'CommandOrControl+,', click: () => windows.createLocal('preferences') },
    { label: '更改 Pockymoe 地址…', click: () => windows.createLocal('relay') }, { type: 'separator' },
    ...(process.platform === 'darwin' ? [{ role: 'services' as const }, { type: 'separator' as const }, { role: 'hide' as const }, { role: 'hideOthers' as const }, { role: 'unhide' as const }, { type: 'separator' as const }] : []),
    { role: 'quit', accelerator: 'CommandOrControl+Q' }
  ] };
  const navigation: MenuItemConstructorOptions[] = [
    // Upstream MatterWorkbench owns Cmd/Ctrl+F, including editor exclusions.
    // Cmd/Ctrl+K is only a native alias; leave F itself to the page.
    { id: 'pockymoe-search', label: '搜索', accelerator: 'CommandOrControl+K', click: pageKey('F', [mod]) },
    { id: 'pockymoe-open-map', label: '打开地图', accelerator: 'CommandOrControl+0', click: command('openMap') },
    { label: '新线程', accelerator: 'CommandOrControl+N', click: command('newThread') },
    { label: '设备总览', click: command('openDevices') }, { type: 'separator' },
    { label: '显示 / 隐藏桌宠', accelerator: 'CommandOrControl+Shift+P', click: () => settings.set({ petVisible: !settings.get().petVisible }) },
    { label: '后退', accelerator: 'CommandOrControl+[', click: () => { const history = windows.focusMain().webContents.navigationHistory; if (history.canGoBack()) history.goBack(); } },
    { label: '前进', accelerator: 'CommandOrControl+]', click: () => { const history = windows.focusMain().webContents.navigationHistory; if (history.canGoForward()) history.goForward(); } },

  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate([appMenu, { label: '文件', submenu: navigation }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Pockymoe 帮助', click: () => { void shell.openExternal('https://github.com/dufangshi/pockymoe-app'); } }] }
  ]));
}
