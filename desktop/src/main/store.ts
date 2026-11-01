import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DesktopSettings, SettingsStoreLike } from '../shared/contract';
import { relayOrigin } from './security';

export const defaults: DesktopSettings = {
  webOrigin: 'https://app.lnz-study.com', relayOrigin: 'https://remote.lnz-study.com', alertMode: 'petFirst', petVisible: true,
  petId: 'moe', petSize: 'M', petMini: false, petSound: false, launchAtLogin: false,
  quickWindowShortcut: 'Alt+Space', snoozeUntil: null
};
export function readJson(path: string): unknown { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(data), { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}
export function validateSettings(patch: unknown): Partial<DesktopSettings> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid settings');
  const out: Partial<DesktopSettings> = {};
  for (const [key, value] of Object.entries(patch)) {
    switch (key) {
      case 'webOrigin': case 'relayOrigin': out[key] = relayOrigin(value); break;
      case 'alertMode': if (!['petFirst', 'system', 'both'].includes(String(value))) throw new Error('Invalid alert mode'); out.alertMode = value as DesktopSettings['alertMode']; break;
      case 'petSize': if (!['S', 'M', 'L'].includes(String(value))) throw new Error('Invalid pet size'); out.petSize = value as DesktopSettings['petSize']; break;
      case 'petId': if (typeof value !== 'string' || !/^[\w.-]{1,100}$/.test(value)) throw new Error('Invalid pet id'); out.petId = value; break;
      case 'quickWindowShortcut': if (typeof value !== 'string' || value.length < 3 || value.length > 80) throw new Error('Invalid shortcut'); out.quickWindowShortcut = value; break;
      case 'snoozeUntil': if (value !== null && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) throw new Error('Invalid snooze'); out.snoozeUntil = value as string | null; break;
      case 'petVisible': case 'petMini': case 'petSound': case 'launchAtLogin':
        if (typeof value !== 'boolean') throw new Error('Invalid toggle'); out[key] = value; break;
      default: throw new Error('Unknown setting');
    }
  }
  return out;
}
export class SettingsStore implements SettingsStoreLike {
  private value: DesktopSettings;
  private listeners = new Set<(settings: DesktopSettings) => void>();
  readonly firstRun: boolean;
  constructor(private path: string, overrides: Partial<Pick<DesktopSettings, 'webOrigin' | 'relayOrigin'>> = {}) {
    const stored = readJson(path) as Partial<DesktopSettings> | null;
    if (stored?.relayOrigin && !stored.webOrigin) stored.webOrigin = stored.relayOrigin === defaults.relayOrigin ? defaults.webOrigin : stored.relayOrigin;
    this.firstRun = !stored && !overrides.webOrigin;
    try { this.value = { ...defaults, ...validateSettings(stored || {}) }; } catch { this.value = { ...defaults }; }
    this.value = { ...this.value, ...validateSettings(overrides) };
  }
  get(): DesktopSettings { return { ...this.value }; }
  set(patch: Partial<DesktopSettings>): DesktopSettings {
    this.value = { ...this.value, ...validateSettings(patch) };
    writeJson(this.path, this.value);
    for (const listener of this.listeners) listener(this.get());
    return this.get();
  }
  onChange(listener: (settings: DesktopSettings) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}
