import type { RemoteProvider, RemoteVoice, VoiceOption } from '../../shared/voice';

export class VoiceError extends Error {}
export const MAX_AUDIO_BYTES = 32 * 1024 * 1024;
const TIMEOUT_MS = 60_000;
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Normalizes what people paste: a trailing slash, or the whole speech URL. */
export function voiceEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new VoiceError('invalidUrl');
  const trimmed = value.trim();
  if (!trimmed) return '';
  let url: URL;
  try { url = new URL(trimmed); } catch { throw new VoiceError('invalidUrl'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new VoiceError('invalidUrl');
  return `${url.origin}${url.pathname.replace(/\/+$/, '').replace(/\/audio\/speech$/, '').replace(/\/+$/, '')}`;
}
export function parseExtra(value: string): Record<string, unknown> {
  if (!value.trim()) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new VoiceError('invalidExtra'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new VoiceError('invalidExtra');
  return parsed as Record<string, unknown>;
}
/** Loopback and LAN: a self-hosted vLLM server often has no TLS, and that traffic stays local. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host)) return true;
  const ip = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!ip) return !host.includes('.') && !host.includes(':');
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return a === 127 || a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 || a === 169 && b === 254 || a === 100 && b >= 64 && b <= 127;
}
export interface SpeechRequest { url: string; init: RequestInit }
/** Exported so the wire format of each protocol is testable without a server. */
export function speechRequest(provider: RemoteProvider, config: RemoteVoice, key: string | null, text: string, speed: number): SpeechRequest {
  const root = voiceEndpoint(config.url);
  if (!root) throw new VoiceError('missingUrl');
  const secure = new URL(root).protocol === 'https:' || isPrivateHost(new URL(root).hostname);
  if (key && !secure) throw new VoiceError('insecureKey');
  const extra = parseExtra(config.extra);
  if (provider === 'elevenlabs') {
    if (!config.voice.trim()) throw new VoiceError('missingVoice');
    const url = `${root}/v1/text-to-speech/${encodeURIComponent(config.voice.trim())}?output_format=mp3_44100_128`;
    const body = { ...extra, text, model_id: config.model.trim() || undefined, ...(speed !== 1 ? { voice_settings: { ...(extra.voice_settings as object | undefined), speed } } : {}) };
    return { url, init: { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'xi-api-key': key } : {}) }, body: JSON.stringify(body) } };
  }
  const optional = (name: string, value: string) => value.trim() ? { [name]: value.trim() } : {};
  const body = { response_format: 'wav', ...(speed !== 1 ? { speed } : {}), ...optional('model', config.model), ...optional('voice', config.voice), ...optional('instructions', config.style), ...extra, input: text };
  return { url: `${root}/audio/speech`, init: { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) } };
}
export async function send(fetcher: Fetch, url: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Response> {
  // A redirect could carry a custom key header to another host.
  try { return await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }); }
  catch (error) { throw new VoiceError((error as Error).name === 'TimeoutError' ? 'timeout' : 'unreachable'); }
}
export async function readError(response: Response): Promise<VoiceError> {
  let detail = '';
  try {
    const text = await response.text();
    try { const body = JSON.parse(text) as { error?: { message?: string } | string; detail?: unknown; message?: string }; detail = typeof body.error === 'string' ? body.error : body.error?.message || (typeof body.detail === 'string' ? body.detail : (body.detail as { message?: string } | undefined)?.message) || body.message || ''; }
    catch { detail = text; }
  } catch { /* The status alone still helps. */ }
  return new VoiceError(`HTTP ${response.status}${detail ? ` · ${detail.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`);
}
export async function synthesizeRemote(fetcher: Fetch, request: SpeechRequest): Promise<Uint8Array> {
  const response = await send(fetcher, request.url, request.init);
  if (!response.ok) throw await readError(response);
  if (/json|text\//i.test(response.headers.get('content-type') ?? '')) throw new VoiceError('notAudio');
  if (Number(response.headers.get('content-length') ?? 0) > MAX_AUDIO_BYTES) throw new VoiceError('tooLarge');
  const reader = response.body?.getReader();
  if (!reader) throw new VoiceError('notAudio');
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_AUDIO_BYTES) { void reader.cancel(); throw new VoiceError('tooLarge'); }
    parts.push(value);
  }
  if (!total) throw new VoiceError('notAudio');
  const audio = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { audio.set(part, at); at += part.length; }
  return audio;
}
export function parseVoices(provider: RemoteProvider, body: unknown): VoiceOption[] {
  const value = body as { voices?: unknown[]; uploaded_voices?: { name?: unknown }[] } | null;
  const voices = Array.isArray(value?.voices) ? value.voices : [];
  const named = voices.flatMap((voice): VoiceOption[] => {
    if (typeof voice === 'string') return [{ id: voice, label: voice }];
    const entry = voice as { voice_id?: unknown; id?: unknown; name?: unknown } | null;
    const id = provider === 'elevenlabs' ? entry?.voice_id : entry?.id ?? entry?.name;
    return typeof id === 'string' ? [{ id, label: typeof entry?.name === 'string' ? entry.name : id }] : [];
  });
  const uploaded = Array.isArray(value?.uploaded_voices) ? value.uploaded_voices.flatMap(voice => typeof voice?.name === 'string' ? [{ id: voice.name, label: voice.name }] : []) : [];
  return [...named, ...uploaded].slice(0, 500);
}
/** OpenAI has no listing endpoint, so its built-in names are known here; the field stays free text. */
const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'fable', 'marin', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];
export async function listVoices(fetcher: Fetch, provider: RemoteProvider, config: RemoteVoice, key: string | null): Promise<VoiceOption[]> {
  if (provider === 'openai') return OPENAI_VOICES.map(id => ({ id, label: id }));
  const root = voiceEndpoint(config.url);
  if (!root) throw new VoiceError('missingUrl');
  if (key && new URL(root).protocol !== 'https:' && !isPrivateHost(new URL(root).hostname)) throw new VoiceError('insecureKey');
  const url = provider === 'elevenlabs' ? `${root}/v2/voices?page_size=100` : `${root}/audio/voices`;
  const headers: Record<string, string> = key ? provider === 'elevenlabs' ? { 'xi-api-key': key } : { authorization: `Bearer ${key}` } : {};
  const response = await send(fetcher, url, { headers });
  if (!response.ok) throw await readError(response);
  try { return parseVoices(provider, await response.json()); } catch { throw new VoiceError('notVoices'); }
}
