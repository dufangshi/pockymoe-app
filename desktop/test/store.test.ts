import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaults, SettingsStore } from '../src/main/store';
it('round-trips all settings and rejects invalid patches without mutation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rc-settings-'));
  try {
    const path = join(dir, 'settings.json'), store = new SettingsStore(path);
    expect(store.firstRun).toBe(true); expect(store.get().petEdgeHide).toBe(true);
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

it('marks a v1 relay-only configuration for probing without guessing its Web origin', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pockymoe-migrate-'));
  try {
    const path = join(dir, 'settings.json'); writeFileSync(path, JSON.stringify({ relayOrigin: 'https://custom.example.com', petId: 'moe' }));
    const store = new SettingsStore(path);
    expect(store.legacyRelay).toBe('https://custom.example.com');
    expect(store.get()).toMatchObject({ webOrigin: '', relayOrigin: 'https://custom.example.com' });
    store.set({ webOrigin: '' });
    expect(new SettingsStore(path).legacyRelay).toBeNull();
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

it('requires setup for fresh and legacy addressless profiles, preserving saved origins', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pockymoe-setup-'));
  try {
    const path = join(dir, 'settings.json');
    expect(new SettingsStore(path).get()).toMatchObject({ webOrigin: '', relayOrigin: '' });
    writeFileSync(path, JSON.stringify({ petVisible: false }));
    const legacy = new SettingsStore(path);
    expect(legacy.firstRun).toBe(true);
    expect(legacy.get().petVisible).toBe(false);
    legacy.set({ webOrigin: 'https://app.example.com', relayOrigin: 'https://relay.example.com' });
    const restarted = new SettingsStore(path);
    expect(restarted.firstRun).toBe(false);
    expect(restarted.get()).toMatchObject({ webOrigin: 'https://app.example.com', relayOrigin: 'https://relay.example.com' });
  } finally { rmSync(dir, { recursive: true }); }
});

it('retires former built-in pets but preserves user imports across restarts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pockymoe-pet-migration-'));
  try {
    const path = join(dir, 'settings.json');
    expect(new SettingsStore(path).get().petId).toBe('moe');
    for (const petId of ['frost', 'gpt-dragon']) {
      writeFileSync(path, JSON.stringify({ petId }));
      expect(new SettingsStore(path).get().petId).toBe('moe');
    }
    writeFileSync(path, JSON.stringify({ petId: 'unknown-user-pack' }));
    const custom = new SettingsStore(path);
    custom.set({ petVisible: false });
    expect(new SettingsStore(path).get().petId).toBe('unknown-user-pack');
    // Reusing a retired id in a new import must survive a restart.
    for (const petId of ['frost', 'gpt-dragon']) {
      mkdirSync(join(dir, 'pets', petId), { recursive: true });
      writeFileSync(join(dir, 'pets', petId, 'pet.json'), JSON.stringify({ id: petId }));
      custom.set({ petId });
      expect(new SettingsStore(path).get().petId).toBe(petId);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
