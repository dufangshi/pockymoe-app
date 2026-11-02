import { windowsGlassMaterial } from '../shared/platform';
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
/** Never let the overlay transform the entire app into a background-only process. */
export function configureOverlay(window: Pick<BrowserWindow, 'setAlwaysOnTop' | 'setVisibleOnAllWorkspaces'>): void {
  window.setAlwaysOnTop(true, 'floating');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
}
export function glassOptions(platform: string, release = '', forceSolid = false): BrowserWindowConstructorOptions {
  const acrylic = platform === 'win32' && windowsGlassMaterial(release, forceSolid) === 'acrylic';
  return { frame: false, transparent: !acrylic, hasShadow: true, roundedCorners: true, focusable: true,
    skipTaskbar: true, resizable: false, minimizable: false, maximizable: false, backgroundColor: '#00000000',
    ...(platform === 'darwin' ? { type: 'panel', vibrancy: 'hud', visualEffectState: 'active' } : {}),
    ...(platform === 'win32' ? acrylic ? { backgroundMaterial: 'acrylic' } : { hasShadow: false } : {}) };
}
