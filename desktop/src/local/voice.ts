import { t } from '../shared/i18n';
import type { DesktopSettings } from '../shared/contract';
import type { LocalAction, LocalState } from '../shared/local';
import { LOCAL_SPEAKERS, LOCAL_SUMMARY_LANGUAGES, MODEL_DOWNLOAD_MB, REMOTE_DEFAULTS, SPEEDS, SUMMARY_LANGUAGES, type LocalSpeaker, type RemoteProvider, type RemoteVoice, type SummaryLanguage, type VoiceProvider } from '../shared/voice';
import { mountSelect } from './select';
import type { MuteRule } from '../shared/mutes';

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
const speakerLabel = (speaker: LocalSpeaker): string => speaker.kind === 'en' ? t('英文女声 · {name}', { name: speaker.name }) : t(speaker.kind === 'zhFemale' ? '中文女声 · {name}' : '中文男声 · {name}', { name: speaker.name });
const providerLabels = (): Record<VoiceProvider, string> => ({ local: t('本地模型'), compatible: t('OpenAI 兼容服务'), openai: 'OpenAI', elevenlabs: 'ElevenLabs' });
const remoteOf = (settings: DesktopSettings): RemoteVoice | null => settings.petVoiceProvider === 'local' ? null : settings.petVoiceRemotes[settings.petVoiceProvider] ?? REMOTE_DEFAULTS[settings.petVoiceProvider];
const progressText = (state: LocalState): string => t('正在下载 {percent}%', { percent: Math.round(state.voice.model.progress * 100) });

function discoveryNote(state: LocalState): string {
  const { discovery, models } = state.voice;
  if (discovery.state === 'loading') return t('正在读取服务的模型…');
  if (discovery.state === 'failed') return discovery.error === 'HTTP 401' || /^HTTP 40[13]/.test(discovery.error ?? '') ? t('服务需要 API Key，填好后会自动读取。') : `${discovery.error ?? ''} ${t('可以手动填写。')}`;
  if (discovery.state === 'done' && !models.length) return t('服务没有列出模型，可以手动填写。');
  if (discovery.state === 'idle') return t('填好地址后自动读取。');
  return '';
}
function modelRow(state: LocalState): string {
  const { model } = state.voice;
  const describe = model.state === 'ready' ? t('模型已就绪，在这台电脑上离线运行。')
    : model.state === 'downloading' ? progressText(state)
    : model.state === 'extracting' ? t('正在解压…')
    : model.state === 'unsupported' ? t('此设备不支持本地模型，请选择在线服务。')
    : model.error === 'checksum' ? t('下载的文件校验失败，请重试。')
    : model.error ? t('下载失败，请检查网络后重试。')
    : t('下载 {size} MB 模型并打开语音，之后离线运行。', { size: MODEL_DOWNLOAD_MB });
  const button = model.state === 'ready' ? `<button id="voice-model" data-command="remove">${t('删除模型')}</button>`
    : model.state === 'downloading' ? `<button id="voice-model" data-command="cancel">${t('取消')}</button>`
    : model.state === 'absent' ? `<button id="voice-install" class="primary">${t(model.error ? '重试' : '一键安装')}</button>` : '';
  return `<div class="setting-row"><div><label>${t('本地模型')}</label><p id="voice-model-status">${describe}</p></div>${button}</div>`;
}
export function voiceSection(state: LocalState, picker: (id: string, label: string) => string): string {
  const settings = state.settings, remote = remoteOf(settings), provider = settings.petVoiceProvider as RemoteProvider;
  const field = (id: string, label: string, value: string, placeholder = '', note = ''): string => `<div class="setting-row voice-field"><div><label for="${id}">${label}</label>${note ? `<p>${note}</p>` : ''}</div><input id="${id}" type="text" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" spellcheck="false" autocomplete="off"/></div>`;
  const http = !!remote?.url && remote.url.startsWith('http:');
  const rows = remote ? `
    ${field('voice-url', t('服务地址'), remote.url, provider === 'compatible' ? 'http://127.0.0.1:8091/v1' : REMOTE_DEFAULTS[provider].url, provider === 'compatible' ? t('如 vLLM-Omni，填到 /v1 为止。') : '')}
    <div class="setting-row voice-field"><div><label for="voice-key">API Key</label><p>${state.voice.keySet ? t('已保存在系统钥匙串。') : provider === 'compatible' ? t('服务没有鉴权时留空。') : t('保存在系统钥匙串，只发送给这个地址。')}</p></div><div class="inline-controls"><input id="voice-key" type="password" placeholder="${state.voice.keySet ? '••••••••' : ''}" autocomplete="off"/>${state.voice.keySet ? `<button id="voice-key-clear">${t('清除')}</button>` : ''}</div></div>
    <div class="setting-row voice-field"><div><label for="voice-model-name">${t('模型')}</label><p id="voice-discovery" class="${state.voice.discovery.state === 'failed' ? 'inline-error' : ''}">${escapeHtml(discoveryNote(state))}</p></div><div class="inline-controls">${state.voice.models.length ? picker('voice-model-name', t('模型')) : `<input id="voice-model-name" type="text" value="${escapeHtml(remote.model)}" spellcheck="false" autocomplete="off"/>`}<button id="voice-refresh" class="voice-refresh" title="${t('重新读取')}" aria-label="${t('重新读取')}">↻</button></div></div>
    <div class="setting-row voice-field"><div><label for="voice-name">${t('音色')}</label></div>${state.voice.voices.length ? picker('voice-name', t('音色')) : `<input id="voice-name" type="text" value="${escapeHtml(remote.voice)}" spellcheck="false" autocomplete="off"/>`}</div>
    ${provider === 'elevenlabs' ? '' : field('voice-style', t('风格描述'), remote.style, t('温柔、自然的年轻女声'), t('部分模型用它决定音色。'))}
    <details class="voice-advanced"${remote.extra ? ' open' : ''}><summary>${t('额外参数')}</summary><p>${t('并入请求的 JSON，例如固定音色用的 seed 或 ref_audio。')}</p><textarea id="voice-extra" rows="3" spellcheck="false" placeholder='{"seed": 42}'>${escapeHtml(remote.extra)}</textarea></details>
  ` : `${modelRow(state)}<div class="setting-row"><label for="petVoiceSpeaker">${t('音色')}</label>${picker('petVoiceSpeaker', t('音色'))}</div>`;
  const privacy = remote ? `<p class="voice-note">${t('提醒文字（含线程标题）会发送到这个服务。')}${http ? ` ${t('这是未加密的 HTTP 地址。')}` : ''}</p>` : '';
  return `<div class="setting-row"><div><label for="petAgentAlerts">${t('子线程')}</label><p>${t('子线程等待你处理时仍会提醒')}</p></div>${picker('petAgentAlerts', t('子线程'))}</div>
    <div class="setting-row"><div><label for="petVoice">${t('语音播报')}</label><p>${t('用自然的人声读出提醒。')}</p></div><input id="petVoice" class="switch" type="checkbox" ${settings.petVoice ? 'checked' : ''}/></div>
    <div class="setting-row"><label for="petVoiceProvider">${t('声音来源')}</label>${picker('petVoiceProvider', t('声音来源'))}</div>
    ${rows}
    <div class="setting-row"><label for="petVoiceSpeed">${t('语速')}</label>${picker('petVoiceSpeed', t('语速'))}</div>
    <div class="setting-row voice-preview"><p id="voice-error" class="inline-error" role="alert">${escapeHtml(state.voice.lastError ?? '')}</p><button id="voice-preview" ${!remote && state.voice.model.state !== 'ready' ? 'disabled' : ''}>${t('试听')}</button></div>
    ${privacy}
    ${summaryRows(state, picker)}
    ${muteRows(state, picker)}`;
}
const muteKinds = (): Record<MuteRule['kind'], string> => ({ device: t('设备'), workspace: t('工作区'), thread: t('对话') });
let muteKind: MuteRule['kind'] = 'thread', muteTargetsAsked = false;
function muteRows(state: LocalState, picker: (id: string, label: string) => string): string {
  const { petMutes, petMuteAlerts } = state.settings, kinds = muteKinds();
  const rows = petMutes.map((rule, index) => `<div class="mute-rule"><span class="mute-kind">${kinds[rule.kind]}</span><span class="mute-label" title="${escapeHtml(rule.label)}">${escapeHtml(rule.label)}</span><button class="mute-remove" data-mute-remove="${index}" aria-label="${escapeHtml(t('移除 {name}', { name: rule.label }))}" title="${escapeHtml(t('移除 {name}', { name: rule.label }))}">×</button></div>`).join('');
  return `<div class="setting-row mute-add"><div><label for="mute-target">${t('不播报的范围')}</label><p>${t('这些地方的任务完成时不读出来。需要你处理和失败的提醒不受影响。')}</p></div><div class="inline-controls">${picker('mute-kind', t('类型'))}${picker('mute-target', t('选择要静音的范围'))}</div></div>
    ${rows ? `<div class="mute-rules">${rows}</div>` : ''}
    <div class="setting-row"><div><label for="petMuteAlerts">${t('也不弹完成提醒')}</label><p>${t('这些地方完成时，桌宠也不弹气泡、不响提示音，也不发系统通知。')}</p></div><input id="petMuteAlerts" class="switch" type="checkbox" ${petMuteAlerts ? 'checked' : ''}/></div>`;
}
function bindMutes(root: HTMLElement, state: LocalState, save: (patch: Partial<DesktopSettings>) => Promise<unknown>, action: (value: LocalAction) => Promise<boolean>, mount: (id: string, options: { value: string; label: string }[], value: string, change: (value: string) => void) => void, rerender: () => void): void {
  const rules = state.settings.petMutes, kinds = muteKinds();
  // Asked again on focus, so a device or thread added meanwhile can be chosen.
  if (!muteTargetsAsked) { muteTargetsAsked = true; void action({ type: 'muteTargets' }); window.addEventListener('focus', () => { void action({ type: 'muteTargets' }); }); }
  mount('mute-kind', (Object.keys(kinds) as MuteRule['kind'][]).map(value => ({ value, label: kinds[value] })), muteKind, value => { muteKind = value as MuteRule['kind']; rerender(); });
  const targets = state.summary.muteTargets, list = muteKind === 'device' ? targets?.devices : muteKind === 'workspace' ? targets?.workspaces : targets?.threads;
  const free = (list ?? []).filter(row => !rules.some(rule => rule.kind === muteKind && rule.id === row.id));
  mount('mute-target', [{ value: '', label: targets ? t('请选择') : t('正在读取…') }, ...free.map(row => ({ value: row.id, label: row.label }))], '', value => {
    const row = free.find(candidate => candidate.id === value);
    if (row) void save({ petMutes: [...rules, { kind: muteKind, id: row.id, label: row.label }] });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-mute-remove]').forEach(button => { button.onclick = () => { void save({ petMutes: rules.filter((_, index) => index !== Number(button.dataset.muteRemove)) }); }; });
}
const languageLabels = (): Record<SummaryLanguage, string> => ({ auto: t('跟随界面语言'), 'zh-CN': '中文', en: 'English', ja: '日本語', ko: '한국어', fr: 'Français', de: 'Deutsch', es: 'Español' });
const connectionValue = (deviceId: string, id: string): string => `${deviceId}\n${id}`;
function summaryRows(state: LocalState, picker: (id: string, label: string) => string): string {
  const settings = state.settings, connection = settings.petSummaryConnection, summary = state.summary;
  const toggle = `<div class="setting-row"><div><label for="petVoiceSummary">${t('朗读要点')}</label><p>${t('由模型总结这一轮做成了什么再读出来；关闭时只说“某线程完成了”。')}</p></div><input id="petVoiceSummary" class="switch" type="checkbox" ${settings.petVoiceSummary ? 'checked' : ''}/></div>`;
  if (!settings.petVoiceSummary) return toggle;
  const selected = summary.connections.find(row => row.id === connection?.id && row.deviceId === connection?.deviceId);
  const defaultModel = selected?.model ?? '';
  return `${toggle}
    <div class="setting-row"><div><label for="summary-source">${t('上游')}</label>${selected?.needsUpdate ? `<p class="inline-error">${escapeHtml(t('{device} 的 Supervisor 是 {version}，要更新到 0.13.43 或更新版本才能总结。', { device: selected.deviceName, version: selected.supervisorVersion ?? '' }))}</p>` : `<p>${summary.connections.length ? t('在设置的“上游”页添加和测试。') : t('还没有读到上游，请先在设置的“上游”页添加。')}</p>`}</div><div class="inline-controls"><button type="button" id="summary-source" aria-label="${t('上游')}"></button><button id="open-upstreams" class="${summary.connections.length ? '' : 'primary'}">${t('管理上游')}</button></div></div>
    ${connection ? `<div class="setting-row voice-field"><div><label for="summary-model">${t('模型')}</label>${summary.modelsError ? `<p class="inline-error">${escapeHtml(summary.modelsError)} ${t('可以手动填写。')}</p>` : ''}</div>${summary.models.length ? picker('summary-model', t('模型')) : `<input id="summary-model" type="text" value="${escapeHtml(connection.model)}" placeholder="${escapeHtml(defaultModel)}" spellcheck="false" autocomplete="off"/>`}</div>` : ''}
    <div class="setting-row"><label for="petSummaryLanguage">${t('播报语言')}</label>${picker('petSummaryLanguage', t('播报语言'))}</div>
    <div class="setting-row voice-preview"><p id="summary-result" class="${summary.lastError ? 'inline-error' : 'voice-sample'}" role="status">${escapeHtml(summary.lastError ?? summary.sample ?? '')}</p><button id="summary-test" ${connection ? '' : 'disabled'}>${t('试一试')}</button></div>
    <p class="voice-note">${t('这一轮的用户输入和 agent 回答会发送给所选上游。')}</p>`;
}
const refreshUpstreams = (action: (value: LocalAction) => Promise<boolean>): void => { void action({ type: 'summaryConnections' }); };
let upstreamsWatched = false, discoveryAsked = false;
function bindSummary(root: HTMLElement, state: LocalState, save: (patch: Partial<DesktopSettings>) => Promise<unknown>, action: (value: LocalAction) => Promise<boolean>, mount: (id: string, options: { value: string; label: string }[], value: string, change: (value: string) => void) => void): void {
  const settings = state.settings, summary = state.summary, connection = settings.petSummaryConnection;
  if (!settings.petVoiceSummary) return;
  // Coming back from Settings with a new upstream should just show it.
  if (!upstreamsWatched) { upstreamsWatched = true; refreshUpstreams(action); window.addEventListener('focus', () => refreshUpstreams(action)); }
  // Upstreams that can run now come first; the rest say what they are waiting for.
  const rows = [...summary.connections].sort((a, b) => Number(a.needsUpdate ?? false) - Number(b.needsUpdate ?? false)).map(row => ({ value: connectionValue(row.deviceId, row.id), label: `${row.name} · ${row.deviceName}${row.needsUpdate ? ` · ${t('需更新')}` : ''}` }));
  // A saved choice stays selectable while its device is offline.
  if (connection && !summary.connections.some(row => row.id === connection.id && row.deviceId === connection.deviceId)) rows.unshift({ value: connectionValue(connection.deviceId, connection.id), label: connection.name || connection.id });
  mount('summary-source', connection ? rows : [{ value: '', label: t('请选择') }, ...rows], connection ? connectionValue(connection.deviceId, connection.id) : '', value => {
    const row = summary.connections.find(candidate => connectionValue(candidate.deviceId, candidate.id) === value);
    if (row) void save({ petSummaryConnection: { deviceId: row.deviceId, id: row.id, name: `${row.name} · ${row.deviceName}`, model: '' } });
  });
  const manage = root.querySelector<HTMLButtonElement>('#open-upstreams'); if (manage) manage.onclick = () => { void action({ type: 'openUpstreams' }); };
  const labels = languageLabels(), languages = settings.petVoiceProvider === 'local' ? LOCAL_SUMMARY_LANGUAGES : SUMMARY_LANGUAGES;
  mount('petSummaryLanguage', languages.map(value => ({ value, label: labels[value] })), languages.includes(settings.petSummaryLanguage) ? settings.petSummaryLanguage : 'auto', value => { void save({ petSummaryLanguage: value as SummaryLanguage }); });
  const model = root.querySelector<HTMLInputElement>('input#summary-model');
  if (model && connection) model.onchange = () => { void save({ petSummaryConnection: { ...connection, model: model.value.trim() } }); };
  if (connection && root.querySelector('button#summary-model')) {
    const fallback = summary.connections.find(row => row.id === connection.id && row.deviceId === connection.deviceId)?.model ?? '';
    const listed = summary.models.map(row => ({ value: row.id, label: row.label }));
    mount('summary-model', [{ value: '', label: fallback ? t('默认 · {model}', { model: fallback }) : t('默认') }, ...(connection.model && !listed.some(row => row.value === connection.model) ? [{ value: connection.model, label: connection.model }] : []), ...listed], connection.model, value => { void save({ petSummaryConnection: { ...connection, model: value } }); });
  }
  const test = root.querySelector<HTMLButtonElement>('#summary-test');
  if (test) test.onclick = () => { test.disabled = true; test.textContent = t('总结中…'); void action({ type: 'summaryTest' }).finally(() => { if (test.isConnected) { test.disabled = false; test.textContent = t('试一试'); } }); };
}
export function updateVoiceProgress(root: HTMLElement, state: LocalState): void {
  const note = root.querySelector<HTMLElement>('#voice-discovery');
  if (note) { note.textContent = discoveryNote(state); note.classList.toggle('inline-error', state.voice.discovery.state === 'failed'); }
  const status = root.querySelector<HTMLElement>('#voice-model-status');
  if (status && state.voice.model.state === 'downloading') status.textContent = progressText(state);
}
export function bindVoice(root: HTMLElement, state: LocalState, cleanups: (() => void)[], save: (patch: Partial<DesktopSettings>) => Promise<unknown>, action: (value: LocalAction) => Promise<boolean>, rerender: () => void): void {
  const settings = state.settings, provider = settings.petVoiceProvider;
  const trigger = (id: string): HTMLButtonElement | null => root.querySelector<HTMLButtonElement>(`#${id}`);
  const labels = providerLabels();
  const mount = (id: string, options: { value: string; label: string }[], value: string, change: (value: string) => void): void => { const button = trigger(id); if (button) cleanups.push(mountSelect(button, options, value, change)); };
  mount('petAgentAlerts', [{ value: 'all', label: t('提醒并播报') }, { value: 'silent', label: t('只提醒，不播报') }, { value: 'off', label: t('不提醒') }], settings.petAgentAlerts ?? 'all', value => { void save({ petAgentAlerts: value as DesktopSettings['petAgentAlerts'] }); });
  mount('petVoiceProvider', (Object.keys(labels) as VoiceProvider[]).map(value => ({ value, label: labels[value] })), provider, value => { void save({ petVoiceProvider: value as VoiceProvider }); });
  mount('petVoiceSpeaker', LOCAL_SPEAKERS.map(speaker => ({ value: String(speaker.sid), label: speakerLabel(speaker) })), String(settings.petVoiceSpeaker), value => { void save({ petVoiceSpeaker: Number(value) }); });
  mount('petVoiceSpeed', SPEEDS.map(speed => ({ value: String(speed), label: `${speed}×` })), String(settings.petVoiceSpeed), value => { void save({ petVoiceSpeed: Number(value) }); });
  const remote = remoteOf(settings);
  const update = (patch: Partial<RemoteVoice>): void => { if (provider !== 'local') void save({ petVoiceRemotes: { ...settings.petVoiceRemotes, [provider]: { ...remote!, ...patch } } }); };
  const bindText = (id: string, name: keyof RemoteVoice): void => { const input = root.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`); if (input instanceof HTMLButtonElement) return; if (input) input.onchange = () => { update({ [name]: input.value }); }; };
  // What was chosen stays listed even if the service stops offering it.
  const offered = (list: { id: string; label: string }[], value: string, blank?: string): { value: string; label: string }[] => [...(blank !== undefined ? [{ value: '', label: blank }] : []), ...(value && !list.some(row => row.id === value) ? [{ value, label: value }] : []), ...list.map(row => ({ value: row.id, label: row.label }))];
  if (remote && root.querySelector('button#voice-model-name')) mount('voice-model-name', offered(state.voice.models, remote.model), remote.model, value => { update({ model: value }); });
  if (remote && root.querySelector('button#voice-name')) mount('voice-name', offered(state.voice.voices, remote.voice, provider === 'elevenlabs' ? undefined : t('默认')), remote.voice, value => { update({ voice: value }); });
  if (remote && !discoveryAsked) { discoveryAsked = true; void action({ type: 'voiceDiscover' }); window.addEventListener('focus', () => { void action({ type: 'voiceDiscover' }); }); }
  const refresh = trigger('voice-refresh'); if (refresh) refresh.onclick = () => { void action({ type: 'voiceDiscover' }); };
  bindText('voice-url', 'url'); bindText('voice-model-name', 'model'); bindText('voice-name', 'voice'); bindText('voice-style', 'style'); bindText('voice-extra', 'extra');
  const install = trigger('voice-install'); if (install) install.onclick = () => { void action({ type: 'voiceInstall' }); };
  bindSummary(root, state, save, action, mount);
  bindMutes(root, state, save, action, mount, rerender);
  const key = root.querySelector<HTMLInputElement>('#voice-key');
  if (key) key.onchange = () => { if (key.value.trim()) void action({ type: 'voiceKey', key: key.value }); };
  const clear = trigger('voice-key-clear'); if (clear) clear.onclick = () => { void action({ type: 'voiceKey', key: null }); };
  const model = trigger('voice-model');
  if (model) model.onclick = () => { void action({ type: 'voiceModel', command: model.dataset.command as 'download' | 'cancel' | 'remove' }); };
  const preview = trigger('voice-preview');
  if (preview) preview.onclick = () => {
    preview.disabled = true; preview.textContent = t('合成中…');
    void action({ type: 'voicePreview' }).finally(() => { if (preview.isConnected) { preview.disabled = false; preview.textContent = t('试听'); } });
  };
}
