import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import type { SettingsStore } from './store';
import type { Windows } from './windows';
export function installMenu(windows: Windows, settings: SettingsStore): void {
  const command = (type: 'openPalette' | 'newThread' | 'openDevices') => (): void => { void windows.dispatch({ type }); };
  const pageKey = (keyCode: string, modifiers: NonNullable<Electron.KeyboardInputEvent['modifiers']>) => (): void => {
    const wc = windows.focusMain().webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  };
  const mod = process.platform === 'darwin' ? 'meta' : 'control';
  const appMenu: MenuItemConstructorOptions = { label: app.name, submenu: [
    { role: 'about' }, { type: 'separator' }, { label: '设置…', accelerator: 'CommandOrControl+,', click: () => windows.createLocal('preferences') },
    { label: '更改 Relay…', click: () => windows.createLocal('relay') }, { type: 'separator' },
    ...(process.platform === 'darwin' ? [{ role: 'services' as const }, { type: 'separator' as const }, { role: 'hide' as const }, { role: 'hideOthers' as const }, { role: 'unhide' as const }, { type: 'separator' as const }] : []),
    { role: 'quit', accelerator: 'CommandOrControl+Q' }
  ] };
  const navigation: MenuItemConstructorOptions[] = [
    { label: '搜索线程、工作区、命令', accelerator: 'CommandOrControl+K', click: command('openPalette') },
    { label: '新线程', accelerator: 'CommandOrControl+N', click: command('newThread') },
    { label: '新线程并选择位置', accelerator: 'CommandOrControl+Shift+N', click: pageKey('N', [mod, 'shift']) },
    { label: '设备总览', click: command('openDevices') }, { type: 'separator' },
    { label: '显示 / 隐藏桌宠', accelerator: 'CommandOrControl+Shift+P', click: () => settings.set({ petVisible: !settings.get().petVisible }) },
    { label: '显示 / 隐藏侧栏', accelerator: 'CommandOrControl+\\', click: pageKey('\\', [mod]) },
    { label: '显示 / 隐藏检查器', accelerator: 'CommandOrControl+Alt+\\', click: pageKey('\\', [mod, 'alt']) },
    { label: '过滤侧栏', accelerator: 'CommandOrControl+Shift+F', click: pageKey('F', [mod, 'shift']) },
    { label: '后退', accelerator: 'CommandOrControl+[', click: pageKey('[', [mod]) },
    { label: '前进', accelerator: 'CommandOrControl+]', click: pageKey(']', [mod]) },
    { label: '下一个未读', accelerator: 'Alt+Shift+Down', click: pageKey('Down', ['alt', 'shift']) },
    { label: '上一个未读', accelerator: 'Alt+Shift+Up', click: pageKey('Up', ['alt', 'shift']) },
    ...Array.from({ length: 9 }, (_, n) => ({ label: `打开第 ${n + 1} 个活动线程`, accelerator: `CommandOrControl+${n + 1}`, click: pageKey(`${n + 1}`, [mod]) }))
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate([appMenu, { label: '文件', submenu: navigation }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Remote Codex 帮助', click: () => { void shell.openExternal('https://github.com/dufangshi/remote-codex-app'); } }] }
  ]));
}
