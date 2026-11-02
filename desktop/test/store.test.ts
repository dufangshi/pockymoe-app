import { expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaults, SettingsStore } from '../src/main/store';
it('round-trips all settings and rejects invalid patches without mutation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rc-settings-'));
  try {
    const path = join(dir, 'settings.json'), store = new SettingsStore(path);
    expect(store.firstRun).toBe(true); expect(store.get().webOrigin).toBe(''); expect(store.get().relayOrigin).toBe(''); expect(store.get().petEdgeHide).toBe(true);
    const settings = { ...defaults, webOrigin: 'https://web.example.com', relayOrigin: 'https://relay.example.com', alertMode: 'both' as const, petVisible: false,
      petId: 'another', petSize: 'L' as const, petMini: true, petSound: true, petEdgeHide: false, launchAtLogin: true,
      quickWindowShortcut: 'CommandOrControl+Shift+Space', snoozeUntil: '2100-01-01T00:00:00Z' };
    store.set(settings);
    const restarted = new SettingsStore(path);
    expect(restarted.firstRun).toBe(false); expect(restarted.get()).toEqual(settings);
    expect(() => restarted.set({ relayOrigin: 'http://example.com' })).toThrow(); expect(restarted.get()).toEqual(settings);
    expect(new SettingsStore(path, { relayOrigin: 'http://127.0.0.1:5199' }).get().relayOrigin).toBe('http://127.0.0.1:5199');
  } finally { rmSync(dir, { recursive: true }); }
});

it('migrates a v1 relay-only configuration to the origin pair', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pockymoe-migrate-'));
  try {
    const path = join(dir, 'settings.json'); writeFileSync(path, JSON.stringify({ relayOrigin: 'https://custom.example.com', petId: 'moe' }));
    expect(new SettingsStore(path).get()).toMatchObject({ webOrigin: 'https://custom.example.com', relayOrigin: 'https://custom.example.com' });
  } finally { rmSync(dir, { recursive: true }); }
});
it('persists unchanged defaults without recursively publishing identical settings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pockymoe-noop-'));
  try {
    const path = join(dir, 'settings.json'), store = new SettingsStore(path); let changes = 0;
    store.onChange(next => { changes++; store.set({ petVisible: next.petVisible }); });
    store.set({ petVisible: true });
    expect(new SettingsStore(path).firstRun).toBe(true); expect(changes).toBe(0);
    store.set({ petVisible: false }); expect(changes).toBe(1);
  } finally { rmSync(dir, { recursive: true }); }
});
