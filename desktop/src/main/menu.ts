import { BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { t } from '../shared/i18n';
import type { SettingsStore } from './store';
import type { Windows } from './windows';
export function installMenu(windows: Windows, settings: SettingsStore): void {
  const available = (action: () => void) => (): void => { if (!windows.closingForUpdate) action(); };
  const command = (type: 'openMap' | 'newThread' | 'openDevices') => (): void => { void windows.dispatch({ type }); };
  const search = (): void => {
    if (windows.closingForUpdate) return;
    const wc = windows.focusMain().webContents;
    const modifiers: Electron.KeyboardInputEvent['modifiers'] = [process.platform === 'darwin' ? 'meta' : 'control'];
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'F', modifiers });
  };
  const application: MenuItemConstructorOptions = { label: 'Pockymoe', submenu: [
    { label: t('关于 Pockymoe'), click: available(() => { windows.createLocal('about'); }) }, { type: 'separator' },
    { label: t('设置…'), accelerator: 'CommandOrControl+,', click: available(() => { windows.createLocal('preferences'); }) },
    { label: t('更改 Pockymoe 地址…'), click: available(() => { windows.createLocal('relay'); }) }, { type: 'separator' },
    ...(process.platform === 'darwin' ? [{ role: 'services' as const, label: t('服务') }, { type: 'separator' as const },
      { role: 'hide' as const, label: t('隐藏 Pockymoe') }, { role: 'hideOthers' as const, label: t('隐藏其他') },
      { role: 'unhide' as const, label: t('全部显示') }, { type: 'separator' as const }] : []),
    { role: 'quit', label: t('退出 Pockymoe'), accelerator: 'CommandOrControl+Q' }
  ] };
  const navigation: MenuItemConstructorOptions[] = [
    // The Web owns Cmd/Ctrl+F, including terminal/editor exclusions; K is an alias.
    { id: 'pockymoe-search', label: t('搜索'), accelerator: 'CommandOrControl+K', click: search },
    { id: 'pockymoe-open-map', label: t('打开地图'), accelerator: 'CommandOrControl+0', click: command('openMap') },
    { label: t('新线程'), accelerator: 'CommandOrControl+N', click: command('newThread') },
    { label: t('设备总览'), click: command('openDevices') }, { type: 'separator' },
    { label: t('显示 / 隐藏桌宠'), accelerator: 'CommandOrControl+Shift+P', click: () => settings.set({ petVisible: !settings.get().petVisible }) },
    { label: t('后退'), accelerator: 'CommandOrControl+[', click: () => { if (windows.closingForUpdate) return; const h = windows.focusMain().webContents.navigationHistory; if (h.canGoBack()) h.goBack(); } },
    { label: t('前进'), accelerator: 'CommandOrControl+]', click: () => { if (windows.closingForUpdate) return; const h = windows.focusMain().webContents.navigationHistory; if (h.canGoForward()) h.goForward(); } }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate([application, { label: t('文件'), submenu: navigation },
    { label: t('编辑'), submenu: [
      { role: 'undo', label: t('撤销') }, { role: 'redo', label: t('重做') }, { type: 'separator' },
      { role: 'cut', label: t('剪切') }, { role: 'copy', label: t('复制') }, { role: 'paste', label: t('粘贴') },
      { role: 'pasteAndMatchStyle', label: t('粘贴并匹配样式') }, { role: 'delete', label: t('删除') }, { role: 'selectAll', label: t('全选') }
    ] },
    { label: t('视图'), submenu: [
      { role: 'reload', label: t('重新载入') }, { role: 'forceReload', label: t('强制重新载入') }, { role: 'toggleDevTools', label: t('开发者工具') },
      { type: 'separator' }, { role: 'resetZoom', label: t('实际大小'), accelerator: '' }, { role: 'zoomIn', label: t('放大') }, { role: 'zoomOut', label: t('缩小') },
      { type: 'separator' }, { role: 'togglefullscreen', label: t('切换全屏') }
    ] },
    { role: 'windowMenu', label: t('窗口'), submenu: [
      { role: 'minimize', label: t('最小化') }, { role: 'zoom', label: t('缩放窗口') }, { role: 'close', label: t('关闭窗口') },
      ...(process.platform === 'darwin' ? [{ type: 'separator' as const }, { role: 'front' as const, label: t('全部置前') }] : [])
    ] },
    { role: 'help', label: t('帮助'), submenu: [{ label: t('Pockymoe 帮助'), click: () => { void shell.openExternal('https://github.com/dufangshi/pockymoe-app'); } }] }
  ]));
  if (process.platform === 'win32') for (const window of BrowserWindow.getAllWindows()) { window.setAutoHideMenuBar(false); window.setMenuBarVisibility(false); }
}
