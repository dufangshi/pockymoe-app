import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaults, SettingsStore } from '../src/main/store';
it('round-trips all settings and rejects invalid patches without mutation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rc-settings-'));
  try {
    const path = join(dir, 'settings.json'), store = new SettingsStore(path);
    expect(store.firstRun).toBe(true);
    const settings = { ...defaults, relayOrigin: 'https://relay.example.com', alertMode: 'both' as const, petVisible: false,
      petId: 'another', petSize: 'L' as const, petMini: true, petSound: true, launchAtLogin: true,
      quickWindowShortcut: 'CommandOrControl+Shift+Space', snoozeUntil: '2100-01-01T00:00:00Z' };
    store.set(settings);
    const restarted = new SettingsStore(path);
    expect(restarted.firstRun).toBe(false); expect(restarted.get()).toEqual(settings);
    expect(() => restarted.set({ relayOrigin: 'http://example.com' })).toThrow(); expect(restarted.get()).toEqual(settings);
    expect(new SettingsStore(path, 'http://127.0.0.1:5199').get().relayOrigin).toBe('http://127.0.0.1:5199');
  } finally { rmSync(dir, { recursive: true }); }
});
