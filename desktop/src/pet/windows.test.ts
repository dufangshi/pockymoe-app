import { describe, expect, it, vi } from 'vitest';
import { configureOverlay, glassOptions } from './windows';
describe('overlay native options', () => {
  it('preserves Dock and Cmd-Tab process identity on every overlay', () => {
    const window = { setAlwaysOnTop: vi.fn(), setVisibleOnAllWorkspaces: vi.fn() }; configureOverlay(window);
    expect(window.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  });
  it('uses actual native glass and an interactive separate child', () => {
    expect(glassOptions('darwin')).toMatchObject({ vibrancy: 'hud', visualEffectState: 'active', focusable: true, frame: false });
    expect(glassOptions('win32')).toMatchObject({ backgroundMaterial: 'acrylic' });
    expect(glassOptions('linux').backgroundMaterial).toBeUndefined();
  });
});
