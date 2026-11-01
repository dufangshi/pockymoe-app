import { t } from '../shared/i18n';
import type { DesktopSettings } from '../shared/contract';
import type { LocalAction, LocalState } from '../shared/local';
import { LOCAL_SPEAKERS, MODEL_DOWNLOAD_MB, REMOTE_DEFAULTS, SPEEDS, type LocalSpeaker, type RemoteProvider, type RemoteVoice, type VoiceProvider } from '../shared/voice';
import { mountSelect } from './select';

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
const speakerLabel = (speaker: LocalSpeaker): string => speaker.kind === 'en' ? t('英文女声 · {name}', { name: speaker.name }) : t(speaker.kind === 'zhFemale' ? '中文女声 · {name}' : '中文男声 · {name}', { name: speaker.name });
const providerLabels = (): Record<VoiceProvider, string> => ({ local: t('本地模型'), compatible: t('OpenAI 兼容服务'), openai: 'OpenAI', elevenlabs: 'ElevenLabs' });
const remoteOf = (settings: DesktopSettings): RemoteVoice | null => settings.petVoiceProvider === 'local' ? null : settings.petVoiceRemotes[settings.petVoiceProvider] ?? REMOTE_DEFAULTS[settings.petVoiceProvider];
const progressText = (state: LocalState): string => t('正在下载 {percent}%', { percent: Math.round(state.voice.model.progress * 100) });

function modelRow(state: LocalState): string {
  const { model } = state.voice;
  const describe = model.state === 'ready' ? t('模型已就绪，在这台电脑上离线运行。')
    : model.state === 'downloading' ? progressText(state)
    : model.state === 'extracting' ? t('正在解压…')
    : model.state === 'unsupported' ? t('此设备不支持本地模型，请选择在线服务。')
    : model.error === 'checksum' ? t('下载的文件校验失败，请重试。')
    : model.error ? t('下载失败，请检查网络后重试。')
    : t('首次使用需下载 {size} MB。', { size: MODEL_DOWNLOAD_MB });
  const button = model.state === 'ready' ? `<button id="voice-model" data-command="remove">${t('删除模型')}</button>`
    : model.state === 'downloading' ? `<button id="voice-model" data-command="cancel">${t('取消')}</button>`
    : model.state === 'absent' ? `<button id="voice-model" data-command="download">${t('下载')}</button>` : '';
  return `<div class="setting-row"><div><label>${t('本地模型')}</label><p id="voice-model-status">${describe}</p></div>${button}</div>`;
}
export function voiceSection(state: LocalState, picker: (id: string, label: string) => string): string {
  const settings = state.settings, remote = remoteOf(settings), provider = settings.petVoiceProvider as RemoteProvider;
  const field = (id: string, label: string, value: string, placeholder = '', note = ''): string => `<div class="setting-row voice-field"><div><label for="${id}">${label}</label>${note ? `<p>${note}</p>` : ''}</div><input id="${id}" type="text" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" spellcheck="false" autocomplete="off"/></div>`;
  const http = !!remote?.url && remote.url.startsWith('http:');
  const rows = remote ? `
    ${field('voice-url', t('服务地址'), remote.url, provider === 'compatible' ? 'http://127.0.0.1:8091/v1' : REMOTE_DEFAULTS[provider].url, provider === 'compatible' ? t('如 vLLM-Omni，填到 /v1 为止。') : '')}
    <div class="setting-row voice-field"><div><label for="voice-key">API Key</label><p>${state.voice.keySet ? t('已保存在系统钥匙串。') : provider === 'compatible' ? t('服务没有鉴权时留空。') : t('保存在系统钥匙串，只发送给这个地址。')}</p></div><div class="inline-controls"><input id="voice-key" type="password" placeholder="${state.voice.keySet ? '••••••••' : ''}" autocomplete="off"/>${state.voice.keySet ? `<button id="voice-key-clear">${t('清除')}</button>` : ''}</div></div>
    ${field('voice-model-name', t('模型'), remote.model, provider === 'compatible' ? 'BreezeBlue/Breeze-TTS-2' : REMOTE_DEFAULTS[provider].model)}
    <div class="setting-row voice-field"><div><label for="voice-name">${t('音色')}</label></div><div class="inline-controls"><input id="voice-name" type="text" value="${escapeHtml(remote.voice)}" spellcheck="false" autocomplete="off"/>${state.voice.voices.length ? `<button type="button" id="voice-name-list" aria-label="${t('选择音色')}"></button>` : `<button id="voice-list">${t('获取')}</button>`}</div></div>
    ${provider === 'elevenlabs' ? '' : field('voice-style', t('风格描述'), remote.style, t('温柔、自然的年轻女声'), t('部分模型用它决定音色。'))}
    <details class="voice-advanced"${remote.extra ? ' open' : ''}><summary>${t('额外参数')}</summary><p>${t('并入请求的 JSON，例如固定音色用的 seed 或 ref_audio。')}</p><textarea id="voice-extra" rows="3" spellcheck="false" placeholder='{"seed": 42}'>${escapeHtml(remote.extra)}</textarea></details>
  ` : `${modelRow(state)}<div class="setting-row"><label for="petVoiceSpeaker">${t('音色')}</label>${picker('petVoiceSpeaker', t('音色'))}</div>`;
  const privacy = remote ? `<p class="voice-note">${t('提醒文字（含线程标题）会发送到这个服务。')}${http ? ` ${t('这是未加密的 HTTP 地址。')}` : ''}</p>` : '';
  return `<div class="setting-row"><div><label for="petVoice">${t('语音播报')}</label><p>${t('用自然的人声读出提醒。')}</p></div><input id="petVoice" class="switch" type="checkbox" ${settings.petVoice ? 'checked' : ''}/></div>
    <div class="setting-row"><label for="petVoiceProvider">${t('声音来源')}</label>${picker('petVoiceProvider', t('声音来源'))}</div>
    ${rows}
    <div class="setting-row"><label for="petVoiceSpeed">${t('语速')}</label>${picker('petVoiceSpeed', t('语速'))}</div>
    <div class="setting-row voice-preview"><p id="voice-error" class="inline-error" role="alert">${escapeHtml(state.voice.lastError ?? '')}</p><button id="voice-preview" ${!remote && state.voice.model.state !== 'ready' ? 'disabled' : ''}>${t('试听')}</button></div>
    ${privacy}`;
}
export function updateVoiceProgress(root: HTMLElement, state: LocalState): void {
  const status = root.querySelector<HTMLElement>('#voice-model-status');
  if (status && state.voice.model.state === 'downloading') status.textContent = progressText(state);
}
export function bindVoice(root: HTMLElement, state: LocalState, cleanups: (() => void)[], save: (patch: Partial<DesktopSettings>) => Promise<unknown>, action: (value: LocalAction) => Promise<boolean>): void {
  const settings = state.settings, provider = settings.petVoiceProvider;
  const trigger = (id: string): HTMLButtonElement | null => root.querySelector<HTMLButtonElement>(`#${id}`);
  const labels = providerLabels();
  const mount = (id: string, options: { value: string; label: string }[], value: string, change: (value: string) => void): void => { const button = trigger(id); if (button) cleanups.push(mountSelect(button, options, value, change)); };
  mount('petVoiceProvider', (Object.keys(labels) as VoiceProvider[]).map(value => ({ value, label: labels[value] })), provider, value => { void save({ petVoiceProvider: value as VoiceProvider }); });
  mount('petVoiceSpeaker', LOCAL_SPEAKERS.map(speaker => ({ value: String(speaker.sid), label: speakerLabel(speaker) })), String(settings.petVoiceSpeaker), value => { void save({ petVoiceSpeaker: Number(value) }); });
  mount('petVoiceSpeed', SPEEDS.map(speed => ({ value: String(speed), label: `${speed}×` })), String(settings.petVoiceSpeed), value => { void save({ petVoiceSpeed: Number(value) }); });
  const remote = remoteOf(settings);
  const update = (patch: Partial<RemoteVoice>): void => { if (provider !== 'local') void save({ petVoiceRemotes: { ...settings.petVoiceRemotes, [provider]: { ...remote!, ...patch } } }); };
  const bindText = (id: string, name: keyof RemoteVoice): void => { const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`); if (input) input.onchange = () => { update({ [name]: input.value }); }; };
  bindText('voice-url', 'url'); bindText('voice-model-name', 'model'); bindText('voice-name', 'voice'); bindText('voice-style', 'style'); bindText('voice-extra', 'extra');
  mount('voice-name-list', state.voice.voices.map(voice => ({ value: voice.id, label: voice.label })), remote?.voice ?? '', value => { update({ voice: value }); });
  const key = root.querySelector<HTMLInputElement>('#voice-key');
  if (key) key.onchange = () => { if (key.value.trim()) void action({ type: 'voiceKey', key: key.value }); };
  const clear = trigger('voice-key-clear'); if (clear) clear.onclick = () => { void action({ type: 'voiceKey', key: null }); };
  const list = trigger('voice-list');
  if (list) list.onclick = () => { list.disabled = true; list.textContent = t('获取中…'); void action({ type: 'voiceList' }).finally(() => { if (list.isConnected) { list.disabled = false; list.textContent = t('获取'); } }); };
  const model = trigger('voice-model');
  if (model) model.onclick = () => { void action({ type: 'voiceModel', command: model.dataset.command as 'download' | 'cancel' | 'remove' }); };
  const preview = trigger('voice-preview');
  if (preview) preview.onclick = () => {
    preview.disabled = true; preview.textContent = t('合成中…');
    void action({ type: 'voicePreview' }).finally(() => { if (preview.isConnected) { preview.disabled = false; preview.textContent = t('试听'); } });
  };
}
