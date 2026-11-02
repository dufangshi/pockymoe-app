import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false, getVersion: () => '0.0.0' }, dialog: {}, shell: {} }));
vi.mock('electron-updater', () => ({ default: { autoUpdater: {} } }));

describe('installsInPlace', () => {
  it('sends Mac to the download page, because an ad-hoc signature cannot self-update', async () => {
    const { installsInPlace } = await import('../src/main/updates');
    expect(installsInPlace('darwin')).toBe(false);
    expect(installsInPlace('win32')).toBe(true);
  });
});
