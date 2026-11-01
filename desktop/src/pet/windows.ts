import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
/** Never let the overlay transform the entire app into a background-only process. */
export function configureOverlay(window: Pick<BrowserWindow, 'setAlwaysOnTop' | 'setVisibleOnAllWorkspaces'>): void {
  window.setAlwaysOnTop(true, 'floating');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
}
export function glassOptions(platform: string): BrowserWindowConstructorOptions {
  return { frame: false, transparent: true, hasShadow: true, roundedCorners: true, focusable: true,
    skipTaskbar: true, resizable: false, minimizable: false, maximizable: false, backgroundColor: '#00000000',
    ...(platform === 'darwin' ? { type: 'panel', vibrancy: 'hud', visualEffectState: 'active' } : {}),
    ...(platform === 'win32' ? { backgroundMaterial: 'acrylic' } : {}) };
}
