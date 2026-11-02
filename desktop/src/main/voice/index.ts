import { app, net, safeStorage, utilityProcess, type UtilityProcess } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ActivityEvent, DesktopSettings, HostCommand, HostCommandResult, SettingsStoreLike } from '../../shared/contract';
import { getLocale, t } from '../../shared/i18n';
import { REMOTE_DEFAULTS, speechText, type RemoteProvider, type RemoteVoice, type SummaryConnection, type SummaryStatus, type VoiceOption, type VoiceStatus } from '../../shared/voice';
import { VoiceKeys } from './keys';
import { LocalModel, MODEL } from './model';
import { listVoices, speechRequest, synthesizeRemote, VoiceError, voiceEndpoint } from './remote';
import { chatEndpoint, chatSummarizer, cleanSummary, concreteLanguage, summaryPrompt, type Summarizer, type TurnContext } from './summary';

const IDLE_UNLOAD_MS = 5 * 60_000, SYNTH_TIMEOUT_MS = 120_000;
const COMPLETE_TIMEOUT_MS = 45_000;
/** The page reaches the account's devices; none of this may open or raise a window. */
type PageCommand = Extract<HostCommand, { type: 'turnText' | 'listConnections' | 'completeWithConnection' }>;
export type PageQuery = (command: PageCommand extends infer C ? C extends { id: string } ? Omit<C, 'id'> : never : never, timeoutMs?: number) => Promise<HostCommandResult>;
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
    missingModel: t('请先填写模型'), notSummary: t('上游没有返回文字'), tooLarge: t('音频太大'), notVoices: t('服务没有提供音色列表，请手动填写'), keychainUnavailable: t('系统钥匙串不可用，无法保存 API Key'), modelAbsent: t('本地模型还没有下载'),
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
  private summaryKeys: VoiceKeys;
  private summaryState: SummaryStatus = { connections: [], keySet: false, lastError: null, sample: null };
  constructor(dataDir: string, private settings: SettingsStoreLike, private ready: () => void, private query: PageQuery) {
    let wasReady = false;
    this.keys = new VoiceKeys(join(dataDir, 'voice-keys.json'), safeStorage);
    this.summaryKeys = new VoiceKeys(join(dataDir, 'summary-keys.json'), safeStorage);
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
  summaryStatus(): SummaryStatus {
    const origin = this.summaryOrigin();
    return { ...this.summaryState, keySet: !!origin && this.summaryKeys.has(origin) };
  }
  private summaryOrigin(): string | null {
    try { const root = chatEndpoint(this.settings.get().petSummaryCustom.url); return root ? new URL(root).origin : null; } catch { return null; }
  }
  setSummaryKey(key: string | null): void {
    const origin = this.summaryOrigin();
    if (!origin) throw new Error(message(new VoiceError('missingUrl')));
    try { if (key?.trim()) this.summaryKeys.set(origin, key.trim()); else this.summaryKeys.clear(origin); } catch (error) { throw new Error(message(error)); }
    this.changed();
  }
  async refreshConnections(): Promise<void> {
    const result = await this.query({ type: 'listConnections' });
    if (result.ok && Array.isArray(result.data)) this.summaryState = { ...this.summaryState, connections: result.data as SummaryConnection[] };
    this.changed();
  }
  private summarizer(): Summarizer {
    const settings = this.settings.get(), connection = settings.petSummaryConnection;
    if (connection) return {
      complete: async prompt => {
        const result = await this.query({ type: 'completeWithConnection', deviceId: connection.deviceId, connectionId: connection.id, model: connection.model, system: prompt.system, user: prompt.user }, COMPLETE_TIMEOUT_MS);
        const text = (result.data as { text?: unknown } | undefined)?.text;
        if (!result.ok || typeof text !== 'string') throw new Error(result.error || t('上游没有返回文字'));
        return text;
      },
    };
    const origin = this.summaryOrigin();
    return chatSummarizer(fetcher, settings.petSummaryCustom, origin ? this.summaryKeys.get(origin) : null);
  }
  private async complete(turn: TurnContext): Promise<string> {
    const language = concreteLanguage(this.settings.get().petSummaryLanguage, getLocale());
    const line = cleanSummary(await this.summarizer().complete(summaryPrompt(turn, language)));
    if (!line) throw new VoiceError('notSummary');
    return line;
  }
  private setSummaryState(patch: Partial<SummaryStatus>): void { this.summaryState = { ...this.summaryState, ...patch }; this.changed(); }
  /** Null means saying the turn finished, whatever went wrong; the reason shows in Preferences. */
  async summarize(event: ActivityEvent): Promise<string | null> {
    if (!this.settings.get().petVoiceSummary || !['completed', 'failed'].includes(event.type)) return null;
    try {
      const { item } = event;
      const result = await this.query({ type: 'turnText', deviceId: item.deviceId, threadId: item.threadId, turnId: item.turnId ?? null });
      const text = result.ok ? result.data as { request?: unknown; answer?: unknown } : {};
      const answer = typeof text.answer === 'string' && text.answer.trim() ? text.answer : item.resultSummary ?? '';
      if (!answer.trim()) return null;
      const line = await this.complete({ title: item.rootThreadTitle ?? item.title, request: typeof text.request === 'string' ? text.request : '', answer, failed: event.type === 'failed' });
      if (this.summaryState.lastError) this.setSummaryState({ lastError: null });
      return line;
    } catch (error) { this.setSummaryState({ lastError: message(error) }); return null; }
  }
  /** Runs a fixed turn through the configured upstream, so the setting can be checked before relying on it. */
  async testSummary(): Promise<string> {
    const zh = getLocale().toLowerCase().startsWith('zh');
    try {
      const line = await this.complete(zh
        ? { title: '修复登录白屏', failed: false, request: '登录后页面白屏，帮我查一下并修好。', answer: '原因是登录回调里读取了尚未加载的用户信息，导致渲染报错。我在 src/auth/callback.ts 里加了加载判断，并补了两个回归测试，全部通过。白屏已修复。这次没有改接口，部署前端即可生效。' }
        : { title: 'Fix blank page after sign-in', failed: false, request: 'The page is blank after signing in. Please find out why and fix it.', answer: 'The sign-in callback read user data before it had loaded, which crashed rendering. I added a loading check in src/auth/callback.ts and two regression tests, which pass. The blank page is fixed. No API changed, so deploying the frontend is enough.' });
      this.setSummaryState({ sample: line, lastError: null });
      return line;
    } catch (error) { const reason = message(error); this.setSummaryState({ sample: null, lastError: reason }); throw new Error(reason); }
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
  /** One click on a new computer: fetch the model, use it, and turn voice on. */
  install(): void {
    this.settings.set({ petVoiceProvider: 'local', petVoice: true });
    void this.model.download();
  }
  stopWorker(): void { this.stop(); }
  private stop(): void { clearTimeout(this.idle); this.worker?.kill(); this.worker = null; }
  dispose(): void { this.stop(); this.model.cancel(); this.listeners.clear(); }
}
export { MODEL };
