import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const native = vi.hoisted(() => ({ menu: vi.fn(), image: vi.fn(), setImage: vi.fn(), setContextMenu: vi.fn(), setToolTip: vi.fn() }));
vi.mock('electron', () => ({
  app: Object.assign(new EventEmitter(), { getAppPath: () => '/app' }),
  nativeTheme: new EventEmitter(),
  nativeImage: { createFromPath: native.image.mockImplementation(() => ({ setTemplateImage: vi.fn() })) },
  Menu: { buildFromTemplate: native.menu.mockImplementation(value => value) },
  Tray: class extends EventEmitter {
    setImage = native.setImage; setContextMenu = native.setContextMenu; setToolTip = native.setToolTip;
    isDestroyed = () => false; destroy = vi.fn();
  },
}));
import { DesktopTray } from '../src/main/tray';
import { ActivityHub } from '../src/main/activity';
import { defaults, type SettingsStore } from '../src/main/store';
import type { Windows } from '../src/main/windows';
import { item, snapshot } from './fixtures';
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it('defers bursts and skips native tray work for unchanged menu content', () => {
  vi.useFakeTimers();
  const hub = new ActivityHub();
  const tray = new DesktopTray(hub, { get: () => defaults, onChange: () => () => {} } as unknown as SettingsStore, { relay: new Set() } as unknown as Windows);
  try {
    hub.sync(snapshot([item()])); hub.sync(snapshot([item()]));
    expect(native.menu).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1); expect(native.menu).toHaveBeenCalledTimes(2);
    const counts = [native.image.mock.calls.length, native.setImage.mock.calls.length, native.menu.mock.calls.length];
    hub.sync(snapshot([item()], { generatedAt: '2026-11-01T07:00:00.000Z' })); vi.advanceTimersByTime(1);
    expect([native.image.mock.calls.length, native.setImage.mock.calls.length, native.menu.mock.calls.length]).toEqual(counts);
    hub.sync(snapshot([item({ title: 'Changed title' })], { generatedAt: '2026-11-01T07:01:00.000Z' })); vi.advanceTimersByTime(1);
    expect(native.menu).toHaveBeenCalledTimes(3);
  } finally { tray.dispose(); hub.dispose(); }
});
