import { t } from '../shared/i18n';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DesktopSettings, PageSettings, SettingsStoreLike } from '../shared/contract';
import { DEFAULT_SPEAKER, LOCAL_SPEAKERS, REMOTE_PROVIDERS, SPEEDS, SUMMARY_LANGUAGES, type RemoteProvider, type RemoteVoice, type SummaryLanguage } from '../shared/voice';
import { MAX_MUTE_RULES, type MuteRule } from '../shared/mutes';
import { relayOrigin } from './security';
import { parseExtra, voiceEndpoint } from './voice/remote';

export const defaults: DesktopSettings = {
  webOrigin: '', relayOrigin: '', alertMode: 'petFirst', petVisible: true,
  petId: 'moe', petSize: 'M', petMini: false, petSound: true, petVoice: false, petVoiceProvider: 'local', petVoiceSpeaker: DEFAULT_SPEAKER, petVoiceSpeed: 1, petVoiceRemotes: {}, petVoiceSummary: false, petSummaryConnection: null, petSummaryLanguage: 'auto', petMutes: [], petMuteAlerts: false, petEdgeHide: true, launchAtLogin: false,
  quickWindowShortcut: 'Alt+Space', snoozeUntil: null
};
export function readJson(path: string): unknown { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(data), { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}
const VOICE_SERVICE_KEYS = ['petVoiceProvider', 'petVoiceSpeaker', 'petVoiceSpeed', 'petVoiceRemotes', 'petVoiceSummary', 'petSummaryConnection', 'petSummaryLanguage', 'petMutes', 'petMuteAlerts'] as const;
/** Settings as the Web page may see them. */
export function pageSettings(settings: DesktopSettings): PageSettings {
  const visible = { ...settings } as Partial<DesktopSettings>;
  for (const key of VOICE_SERVICE_KEYS) delete visible[key];
  return visible as PageSettings;
}
/** The page may not redirect alert text elsewhere: only Preferences changes the voice service. */
export function pageSettingsPatch(patch: unknown): Partial<PageSettings> {
  const valid = validateSettings(patch);
  if (VOICE_SERVICE_KEYS.some(key => key in valid)) throw new Error(t('未知设置'));
  return valid;
}
function validateRemotes(value: unknown): DesktopSettings['petVoiceRemotes'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(t('语音服务设置无效'));
  const out: DesktopSettings['petVoiceRemotes'] = {};
  for (const [provider, raw] of Object.entries(value)) {
    if (!REMOTE_PROVIDERS.includes(provider as RemoteProvider) || !raw || typeof raw !== 'object') throw new Error(t('语音服务设置无效'));
    const config = raw as Partial<RemoteVoice>, text = (field: unknown, max: number): string => { if (field === undefined) return ''; if (typeof field !== 'string' || field.length > max) throw new Error(t('语音服务设置无效')); return field; };
    let url: string;
    try { url = voiceEndpoint(config.url ?? ''); } catch { throw new Error(t('服务地址无效')); }
    const extra = text(config.extra, 2 * 1024 * 1024);
    try { parseExtra(extra); } catch { throw new Error(t('额外参数必须是 JSON 对象')); }
    out[provider as RemoteProvider] = { url, model: text(config.model, 200), voice: text(config.voice, 200), style: text(config.style, 2000), extra };
  }
  return out;
}
function validateMutes(value: unknown): MuteRule[] {
  if (!Array.isArray(value) || value.length > MAX_MUTE_RULES) throw new Error(t('语音服务设置无效'));
  return value.map(row => {
    const rule = row as Partial<MuteRule> | null;
    if (!rule || !['device', 'workspace', 'thread'].includes(String(rule.kind)) || typeof rule.id !== 'string' || !rule.id || rule.id.length > 400 || typeof rule.label !== 'string' || rule.label.length > 400) throw new Error(t('语音服务设置无效'));
    return { kind: rule.kind as MuteRule['kind'], id: rule.id, label: rule.label };
  });
}
function validateSummaryConnection(value: unknown): DesktopSettings['petSummaryConnection'] {
  if (value === null) return null;
  const row = value as Record<string, unknown> | undefined;
  if (!row || typeof row !== 'object' || (['deviceId', 'id', 'name', 'model'] as const).some(key => typeof row[key] !== 'string' || (row[key] as string).length > 300) || !row.deviceId || !row.id) throw new Error(t('语音服务设置无效'));
  return { deviceId: row.deviceId as string, id: row.id as string, name: row.name as string, model: row.model as string };
}
export function validateSettings(patch: unknown): Partial<DesktopSettings> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error(t('设置无效'));
  const out: Partial<DesktopSettings> = {};
  for (const [key, value] of Object.entries(patch)) {
    switch (key) {
      case 'webOrigin': case 'relayOrigin': out[key] = value === '' ? '' : relayOrigin(value); break;
      case 'alertMode': if (!['petFirst', 'system', 'both'].includes(String(value))) throw new Error(t('提醒方式无效')); out.alertMode = value as DesktopSettings['alertMode']; break;
      case 'petSize': if (!['S', 'M', 'L'].includes(String(value))) throw new Error(t('宠物大小无效')); out.petSize = value as DesktopSettings['petSize']; break;
      case 'petId': if (typeof value !== 'string' || !/^[\w.-]{1,100}$/.test(value)) throw new Error(t('宠物标识无效')); out.petId = value; break;
      case 'quickWindowShortcut': if (typeof value !== 'string' || value.length < 3 || value.length > 80) throw new Error(t('快捷键无效')); out.quickWindowShortcut = value; break;
      case 'snoozeUntil': if (value !== null && (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) throw new Error(t('暂停时间无效')); out.snoozeUntil = value as string | null; break;
      case 'petVoiceProvider': if (value !== 'local' && !REMOTE_PROVIDERS.includes(value as RemoteProvider)) throw new Error(t('语音服务设置无效')); out.petVoiceProvider = value as DesktopSettings['petVoiceProvider']; break;
      case 'petVoiceSpeaker': if (!LOCAL_SPEAKERS.some(speaker => speaker.sid === value)) throw new Error(t('语音服务设置无效')); out.petVoiceSpeaker = value as number; break;
      case 'petVoiceSpeed': if (!SPEEDS.includes(value as number)) throw new Error(t('语音服务设置无效')); out.petVoiceSpeed = value as number; break;
      case 'petVoiceRemotes': out.petVoiceRemotes = validateRemotes(value); break;
      case 'petMutes': out.petMutes = validateMutes(value); break;
      case 'petSummaryLanguage': if (!SUMMARY_LANGUAGES.includes(value as SummaryLanguage)) throw new Error(t('语音服务设置无效')); out.petSummaryLanguage = value as SummaryLanguage; break;
      case 'petSummaryConnection': out.petSummaryConnection = validateSummaryConnection(value); break;
      case 'petVisible': case 'petMini': case 'petSound': case 'petVoice': case 'petVoiceSummary': case 'petMuteAlerts': case 'petEdgeHide': case 'launchAtLogin':
        if (typeof value !== 'boolean') throw new Error(t('开关值无效')); out[key] = value; break;
      default: throw new Error(t('未知设置'));
    }
  }
  return out;
}
export function hasConnection(settings: Pick<DesktopSettings, 'webOrigin' | 'relayOrigin'>): boolean {
  return !!settings.webOrigin && !!settings.relayOrigin;
}
export class SettingsStore implements SettingsStoreLike {
  private value: DesktopSettings;
  private listeners = new Set<(settings: DesktopSettings) => void>();
  readonly firstRun: boolean;
  constructor(private path: string, overrides: Partial<Pick<DesktopSettings, 'webOrigin' | 'relayOrigin'>> = {}) {
    const stored = readJson(path) as Partial<DesktopSettings> | null;
    if (stored?.relayOrigin && !stored.webOrigin) stored.webOrigin = stored.relayOrigin;
    // Sound used to be off and nearly inaudible; settings saved before petVoice existed get the new default.
    if (stored && stored.petVoice === undefined) stored.petSound = true;
    // The pack it named was replaced by an original one under a new id.
    // Summaries used to take their own address; upstreams now come only from Settings.
    if (stored) delete (stored as Record<string, unknown>).petSummaryCustom;
    // Imported packs are user-owned, even when reusing a retired built-in id.
    const petId = stored?.petId;
    if (stored && (petId === 'frost' || petId === 'gpt-dragon')) {
      const imported = readJson(join(dirname(path), 'pets', petId, 'pet.json')) as { id?: string } | null;
      if (imported?.id !== petId) stored.petId = 'moe';
    }
    try { this.value = { ...defaults, ...validateSettings(stored || {}) }; } catch { this.value = { ...defaults }; }
    this.value = { ...this.value, ...validateSettings(overrides) };
    this.firstRun = !hasConnection(this.value);
  }
  get(): DesktopSettings { return { ...this.value }; }
  set(patch: Partial<DesktopSettings>): DesktopSettings {
    const next = { ...this.value, ...validateSettings(patch) };
    const changed = Object.keys(next).some(key => next[key as keyof DesktopSettings] !== this.value[key as keyof DesktopSettings]);
    this.value = next;
    writeJson(this.path, this.value);
    if (changed) for (const listener of this.listeners) listener(this.get());
    return this.get();
  }
  onChange(listener: (settings: DesktopSettings) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}
