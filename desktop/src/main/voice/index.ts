import { app, net, safeStorage, utilityProcess, type UtilityProcess } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DesktopSettings, SettingsStoreLike } from '../../shared/contract';
import { t } from '../../shared/i18n';
import { REMOTE_DEFAULTS, speechText, type RemoteProvider, type RemoteVoice, type VoiceOption, type VoiceStatus } from '../../shared/voice';
import { VoiceKeys } from './keys';
import { LocalModel, MODEL } from './model';
import { listVoices, speechRequest, synthesizeRemote, VoiceError, voiceEndpoint } from './remote';

const IDLE_UNLOAD_MS = 5 * 60_000, SYNTH_TIMEOUT_MS = 120_000;
const fetcher = (url: string, init: RequestInit): Promise<Response> => net.fetch(url, init as never);
/** The addon ships per platform; where none exists (or it fails to load) remote services still work. */
function addonAvailable(): boolean {
  const platform = process.platform === 'win32' ? 'win' : process.platform;
  try { return existsSync(join(app.getAppPath(), 'node_modules', `sherpa-onnx-${platform}-${process.arch}`).replace('app.asar', 'app.asar.unpacked')) || !app.isPackaged; } catch { return false; }
}
function message(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  const known: Record<string, string> = {
    invalidUrl: t('服务地址无效'), missingUrl: t('请先填写服务地址'), missingVoice: t('请先选择音色'), invalidExtra: t('额外参数必须是 JSON 对象'),
    insecureKey: t('公网地址要用 HTTPS 才能发送 API Key'), timeout: t('语音服务超时'), unreachable: t('无法连接语音服务'), notAudio: t('服务返回的不是音频'),
    tooLarge: t('音频太大'), notVoices: t('服务没有提供音色列表，请手动填写'), keychainUnavailable: t('系统钥匙串不可用，无法保存 API Key'), modelAbsent: t('本地模型还没有下载'),
  };
  return known[code] ?? (code || t('操作失败'));
}
export class VoiceService {
  readonly model: LocalModel;
  private keys: VoiceKeys;
  private worker: UtilityProcess | null = null;
  private pending = new Map<number, { resolve(audio: Uint8Array): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private nextId = 0;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private voices: VoiceOption[] = [];
  private lastError: string | null = null;
  private supported = addonAvailable();
  private listeners = new Set<() => void>();
  constructor(dataDir: string, private settings: SettingsStoreLike, private ready: () => void) {
    let wasReady = false;
    this.keys = new VoiceKeys(join(dataDir, 'voice-keys.json'), safeStorage);
    this.model = new LocalModel(join(dataDir, 'voice'), fetcher, () => {
      const nowReady = this.model.state === 'ready';
      if (nowReady && !wasReady && settings.get().petVoice && settings.get().petVoiceProvider === 'local') this.ready();
      wasReady = nowReady; this.changed();
    });
    wasReady = this.model.state === 'ready';
    let previous = settings.get();
    settings.onChange(next => {
      if (next.petVoiceProvider !== previous.petVoiceProvider) { this.voices = []; this.lastError = null; }
      // Turning voice on is the consent to fetch the model; the setting says how big it is.
      if (next.petVoice && next.petVoiceProvider === 'local' && this.supported && this.model.state === 'absent' && !this.model.error) void this.model.download();
      previous = next; this.changed();
    });
    if (settings.get().petVoice && settings.get().petVoiceProvider === 'local' && this.supported && this.model.state === 'absent') void this.model.download();
  }
  onChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private changed(): void { for (const listener of this.listeners) listener(); }
  private remote(settings: DesktopSettings): { provider: RemoteProvider; config: RemoteVoice } | null {
    if (settings.petVoiceProvider === 'local') return null;
    const provider = settings.petVoiceProvider;
    return { provider, config: settings.petVoiceRemotes[provider] ?? REMOTE_DEFAULTS[provider] };
  }
  private origin(settings: DesktopSettings): string | null {
    const remote = this.remote(settings);
    if (!remote) return null;
    try { const root = voiceEndpoint(remote.config.url); return root ? new URL(root).origin : null; } catch { return null; }
  }
  status(): VoiceStatus {
    const settings = this.settings.get(), origin = this.origin(settings);
    return { model: { state: this.supported ? this.model.state : 'unsupported', progress: this.model.progress, error: this.model.error }, keySet: !!origin && this.keys.has(origin), voices: this.voices, lastError: this.lastError };
  }
  setKey(key: string | null): void {
    const origin = this.origin(this.settings.get());
    if (!origin) throw new Error(message(new VoiceError('missingUrl')));
    try { if (key?.trim()) this.keys.set(origin, key.trim()); else this.keys.clear(origin); } catch (error) { throw new Error(message(error)); }
    this.changed();
  }
  async refreshVoices(): Promise<void> {
    const settings = this.settings.get(), remote = this.remote(settings);
    if (!remote) return;
    const origin = this.origin(settings);
    try { this.voices = await listVoices(fetcher, remote.provider, remote.config, origin ? this.keys.get(origin) : null); this.changed(); }
    catch (error) { this.voices = []; this.changed(); throw new Error(message(error)); }
  }
  /** Events use this: a failed remote service records why, and an installed local model takes over. */
  async speak(text: string): Promise<Uint8Array | null> {
    try {
      const audio = await this.synthesize(text);
      if (this.lastError) { this.lastError = null; this.changed(); }
      return audio;
    } catch (error) {
      const reason = message(error);
      if (reason !== this.lastError) { this.lastError = reason; this.changed(); }
      if (this.settings.get().petVoiceProvider === 'local' || this.model.state !== 'ready' || !this.supported) return null;
      try { return await this.local(speechText(text)); } catch { return null; }
    }
  }
  /** Preview uses this directly so the person sees the error instead of a fallback. */
  async preview(text: string): Promise<Uint8Array> {
    try { const audio = await this.synthesize(text); this.lastError = null; this.changed(); return audio; }
    catch (error) { const reason = message(error); this.lastError = reason; this.changed(); throw new Error(reason); }
  }
  private async synthesize(raw: string): Promise<Uint8Array> {
    const settings = this.settings.get(), text = speechText(raw), remote = this.remote(settings);
    if (!remote) return this.local(text);
    const origin = this.origin(settings);
    return synthesizeRemote(fetcher, speechRequest(remote.provider, remote.config, origin ? this.keys.get(origin) : null, text, settings.petVoiceSpeed));
  }
  private local(text: string): Promise<Uint8Array> {
    if (this.model.state !== 'ready' || !this.supported) return Promise.reject(new VoiceError('modelAbsent'));
    const settings = this.settings.get();
    clearTimeout(this.idle);
    const worker = this.worker ??= this.fork();
    const id = ++this.nextId;
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); this.stop(); reject(new VoiceError('timeout')); }, SYNTH_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, dir: this.model.path, text, sid: settings.petVoiceSpeaker, speed: settings.petVoiceSpeed });
    });
  }
  private fork(): UtilityProcess {
    const worker = utilityProcess.fork(join(__dirname, 'voiceWorker.js'), [], { serviceName: 'Pockymoe Voice', stdio: 'ignore' });
    worker.on('message', (reply: { id?: number; wav?: Uint8Array; error?: string }) => {
      const entry = reply.id === undefined ? undefined : this.pending.get(reply.id);
      if (!entry) return;
      this.pending.delete(reply.id!); clearTimeout(entry.timer);
      if (reply.wav) entry.resolve(reply.wav); else entry.reject(new Error(reply.error || t('操作失败')));
      if (!this.pending.size) this.idle = setTimeout(() => this.stop(), IDLE_UNLOAD_MS);
    });
    worker.once('exit', () => {
      if (this.worker === worker) this.worker = null;
      for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(t('语音进程已退出'))); }
      this.pending.clear();
    });
    return worker;
  }
  stopWorker(): void { this.stop(); }
  private stop(): void { clearTimeout(this.idle); this.worker?.kill(); this.worker = null; }
  dispose(): void { this.stop(); this.model.cancel(); this.listeners.clear(); }
}
export { MODEL };
