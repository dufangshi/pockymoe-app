/** Where spoken alerts come from. Everything but 'local' sends the alert text to that service. */
export type VoiceProvider = 'local' | 'compatible' | 'openai' | 'elevenlabs';
export type RemoteProvider = Exclude<VoiceProvider, 'local'>;
export const REMOTE_PROVIDERS: RemoteProvider[] = ['compatible', 'openai', 'elevenlabs'];
export interface RemoteVoice {
  /** API root, e.g. http://127.0.0.1:8091/v1 for a vLLM-Omni server. */
  url: string;
  model: string;
  voice: string;
  /** Sent as `instructions`; Breeze-TTS-2 and gpt-4o-mini-tts shape the voice with it. */
  style: string;
  /** JSON object merged into the request, for model options such as seed or ref_audio. */
  extra: string;
}
export const REMOTE_DEFAULTS: Record<RemoteProvider, RemoteVoice> = {
  compatible: { url: '', model: '', voice: '', style: '', extra: '' },
  openai: { url: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts', voice: 'alloy', style: '', extra: '' },
  elevenlabs: { url: 'https://api.elevenlabs.io', model: 'eleven_multilingual_v2', voice: '', style: '', extra: '' },
};
export const SPEEDS = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
export const MAX_SPEECH_CHARS = 160;
export const MODEL_DOWNLOAD_MB = 147;
export interface VoiceOption { id: string; label: string }
export type LocalModelState = 'absent' | 'downloading' | 'extracting' | 'ready' | 'unsupported';
export interface VoiceStatus {
  model: { state: LocalModelState; progress: number; error: string | null };
  /** A key is saved for the configured service's origin. Keys never leave the main process. */
  keySet: boolean;
  voices: VoiceOption[];
  lastError: string | null;
}

// The order of Kokoro v1.1's voices.bin, which is how its speaker ids count.
const number = (list: string) => list.split(',');
const FEMALE = number('001,002,003,004,005,006,007,008,017,018,019,021,022,023,024,026,027,028,032,036,038,039,040,042,043,044,046,047,048,049,051,059,060,067,070,071,072,073,074,075,076,077,078,079,083,084,085,086,087,088,090,092,093,094,099');
const MALE = number('009,010,011,012,013,014,015,016,020,025,029,030,031,033,034,035,037,041,045,050,052,053,054,055,056,057,058,061,062,063,064,065,066,068,069,080,081,082,089,091,095,096,097,098,100');
export interface LocalSpeaker { sid: number; kind: 'zhFemale' | 'zhMale' | 'en'; name: string }
export const LOCAL_SPEAKERS: LocalSpeaker[] = [
  { sid: 0, kind: 'en', name: 'Maple' }, { sid: 1, kind: 'en', name: 'Sol' }, { sid: 2, kind: 'en', name: 'Vale' },
  ...FEMALE.map((name, index) => ({ sid: 3 + index, kind: 'zhFemale' as const, name })),
  ...MALE.map((name, index) => ({ sid: 3 + FEMALE.length + index, kind: 'zhMale' as const, name })),
];
export const DEFAULT_SPEAKER = 3;

/** One clip per alert: long titles would take too long to read, and to synthesize. */
export function speechText(text: string): string {
  const clean = [...text].filter(char => char >= ' ' || char === '\n').join('').replace(/\s+/g, ' ').trim();
  return clean.length > MAX_SPEECH_CHARS ? `${clean.slice(0, MAX_SPEECH_CHARS)}…` : clean;
}

export type SummaryLanguage = 'auto' | 'zh-CN' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es';
/** Kokoro speaks only these; other languages need an online voice. */
export const LOCAL_SUMMARY_LANGUAGES: SummaryLanguage[] = ['auto', 'zh-CN', 'en'];
export const SUMMARY_LANGUAGES: SummaryLanguage[] = ['auto', 'zh-CN', 'en', 'ja', 'ko', 'fr', 'de', 'es'];
/** A saved upstream on one of the account's devices; its key stays on that device. */
export interface SummaryConnection { deviceId: string; deviceName: string; id: string; name: string; protocol: string; model: string }
export interface SummaryStatus {
  connections: SummaryConnection[];
  keySet: boolean;
  lastError: string | null;
  /** What the last test produced. */
  sample: string | null;
}
