import { describe, expect, it, vi } from 'vitest';
import { configureOverlay, glassOptions, windowWasDestroyed } from './windows';
describe('overlay native options', () => {
  it('preserves Dock and Cmd-Tab process identity on every overlay', () => {
    const window = { setAlwaysOnTop: vi.fn(), setVisibleOnAllWorkspaces: vi.fn() }; configureOverlay(window);
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  });
  it('uses actual native glass and an interactive separate child', () => {
    expect(glassOptions('darwin')).toMatchObject({ vibrancy: 'hud', visualEffectState: 'active', focusable: true, frame: false });
    expect(glassOptions('win32')).toMatchObject({ transparent: true, frame: false, hasShadow: false });
    expect(glassOptions('win32', '10.0.22621')).toMatchObject({ transparent: false, backgroundMaterial: 'acrylic' });
    expect(glassOptions('win32', '10.0.22621', true).backgroundMaterial).toBeUndefined();
    expect(glassOptions('win32').backgroundMaterial).toBeUndefined();
    expect(glassOptions('linux').backgroundMaterial).toBeUndefined();
  });
});


it('recognizes only the native destroyed-object error during teardown', () => {
  expect(windowWasDestroyed(new TypeError('Object has been destroyed'))).toBe(true);
  for (const error of [new TypeError('Callback is not a function'), new Error('Other failure'), 'Object has been destroyed', null]) expect(windowWasDestroyed(error)).toBe(false);
});
