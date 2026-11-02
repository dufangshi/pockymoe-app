import { shortcutLabel } from '../shared/platform';
import { t, getLocale, setLocale, localizeMessage } from '../shared/i18n';
// Approved local-UI exception: docs/ui-principles.md (Electron utility windows).
import type { ActivityItem, DesktopSettings } from '../shared/contract';
import { localBridge, type LocalAction, type LocalState } from '../shared/local';
import { mountQuick } from '../quick/view';
import './style.css';
import './themes.css';
import { showError } from './errorMark';
import { applyAppearance } from '../shared/appearance';
import { statusMarkStyles } from '../shared/statusMarks';
import { enhanceScrollbars } from './scrollbars';
import { renderMessage } from './message';
import { mountSelect, type SelectOption } from './select';
import { bindVoice, updateVoiceProgress, voiceSection } from './voice';

const icons: Record<string, string> = {
  general: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M4 10h16M10 10v10"/>',
  pet: '<path d="M8 14c-1 2-3 3-2 5s4 0 6 0 5 2 6 0-1-3-2-5-6-2-8 0Z"/><ellipse cx="5" cy="9" rx="2" ry="3"/><ellipse cx="10" cy="5" rx="2" ry="3"/><ellipse cx="16" cy="5" rx="2" ry="3"/><ellipse cx="21" cy="10" rx="2" ry="3"/>',
  keyboard: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M7 10h.01M11 10h.01M15 10h.01M19 10h.01M7 14h.01M11 14h.01M15 14h.01M8 17h8"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  terminal: '<path d="m5 7 5 5-5 5M13 17h6"/>',
  link: '<path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 2 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/>',
  check: '<path d="m5 12 4 4L19 6"/>'
};
export const icon = (name: string): string => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.general}</svg>`;
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export const appIcon = new URL('../../build/icon.png', import.meta.url).href;
document.documentElement.dataset.platform = navigator.userAgent.includes('Windows') ? 'win32' : '';
const root = document.querySelector<HTMLDivElement>('#app')!;
const view = new URLSearchParams(location.search).get('view') || 'relay';
let state: LocalState;
let section = 'general';
let lastToast: { message: string; error: boolean } | null = null;
let selectCleanups: (() => void)[] = [];
let connecting = false;
let connectionError = '';
let toastTimer: ReturnType<typeof setTimeout>;

export function toast(message: string, error = false): void {
  lastToast = { message, error };
  let el = document.querySelector<HTMLDivElement>('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.role = 'status'; document.body.append(el); }
  if (error) showError(el, message); else el.textContent = message;
  el.className = error ? 'error visible' : 'visible';
  clearTimeout(toastTimer); if (!error) toastTimer = setTimeout(() => el?.classList.remove('visible'), 4000);
}
export async function action(value: LocalAction): Promise<boolean> {
  try { const result = await localBridge().action(value); if (!result.ok) toast(result.error || t('操作失败'), true); return result.ok; }
  catch { toast(t('连接暂时不可用，请重试'), true); return false; }
}
const toggle = (id: keyof DesktopSettings, title: string, description: string, checked: boolean, disabled = false): string => `<div class="setting-row"><div><label for="${id}">${title}</label>${description ? `<p>${description}</p>` : ''}</div><input class="switch" type="checkbox" id="${id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}/></div>`;
function renderRelay(): void {
  const savedFields = new Map(['origin', 'web-origin', 'relay-origin'].map(id => [id, root.querySelector<HTMLInputElement>(`#${id}`)?.value]));
  const wasAdvanced = root.querySelector<HTMLDetailsElement>('#advanced')?.open || false;
  const image = root.querySelector('.app-icon');
  root.className = 'relay-page';
  root.innerHTML = `<div class="drag-zone"></div><div class="relay-content" data-scroll>
    <header class="connection-heading"><img class="app-icon" src="${appIcon}" alt=""/><h1>${t('连接 Pockymoe')}</h1></header>
    <form id="relay-form" novalidate><label for="origin">${t('Pockymoe 地址')}</label>
      <div class="origin-field">${icon('link')}<input id="origin" type="url" required spellcheck="false" autocomplete="url" value="${escapeHtml(state.settings.webOrigin)}" placeholder="https://app.example.com"/></div>
      <p class="hint">${t('填写网页或 Relay 地址，自动发现连接。')}${!state.settings.webOrigin ? ` ${t('此版本不再提供默认地址。请填写你的 Pockymoe 地址以继续。')}` : ''}</p>
      <details id="advanced"><summary>${t('高级')}</summary><div class="advanced-fields"><label for="web-origin">${t('网页地址')}</label><input id="web-origin" type="url" spellcheck="false" value="${escapeHtml(state.settings.webOrigin)}"/><label for="relay-origin">${t('Relay 地址')}</label><input id="relay-origin" type="url" spellcheck="false" value="${escapeHtml(state.settings.relayOrigin)}"/><p class="hint">${t('分别指定网页与 API 地址；同源部署可填写相同地址。')}</p></div></details>
    </form></div><div class="connection-action"><button class="primary connect" type="submit" form="relay-form">${t('连接')} <span aria-hidden="true">→</span></button><p id="relay-error" class="inline-error" role="alert"></p></div>`;
  if (image) root.querySelector('.app-icon')!.replaceWith(image);
  for (const [id, value] of savedFields) if (value !== undefined) root.querySelector<HTMLInputElement>(`#${id}`)!.value = value;
  root.querySelector<HTMLDetailsElement>('#advanced')!.open = wasAdvanced;
  root.querySelector<HTMLDetailsElement>('#advanced')!.ontoggle = event => {
    void localBridge().action({ type: 'connectionSize', expanded: (event.currentTarget as HTMLDetailsElement).open });
  };
  root.querySelector<HTMLElement>('#relay-error')!.textContent = localizeMessage(connectionError);
  const currentButton = root.querySelector<HTMLButtonElement>('.connect')!; currentButton.disabled = connecting;
  if (connecting) currentButton.textContent = t('正在连接…');
  enhanceScrollbars(root);
  document.querySelector<HTMLFormElement>('#relay-form')!.onsubmit = async e => {
    e.preventDefault();
    const origin = document.querySelector<HTMLInputElement>('#origin')!.value.trim();
    const advanced = document.querySelector<HTMLDetailsElement>('#advanced')!.open;
    connecting = true; connectionError = '';
    renderRelay();
    try {
      const result = await localBridge().action({ type: 'connect', origin, ...(advanced ? {
        webOrigin: document.querySelector<HTMLInputElement>('#web-origin')!.value.trim(),
        relayOrigin: document.querySelector<HTMLInputElement>('#relay-origin')!.value.trim()
      } : {}) });
      if (!result.ok) connectionError = result.error || t('连接失败，请重试');
    } catch { connectionError = t('连接暂时不可用，请重试'); }
    finally { connecting = false; renderRelay(); }
  };
}
function renderPreferences(): void {
  for (const cleanup of selectCleanups) cleanup(); selectCleanups = [];
  const active = root.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
  const activeId = active?.id, activeSection = active?.dataset.section;
  const draft = active instanceof HTMLInputElement && ['text', 'password'].includes(active.type) ? { value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
  const scroll = root.querySelector('.pref-main')?.scrollTop || 0;
  root.className = 'preferences';
  root.innerHTML = `<div class="drag-zone"></div><aside class="pref-sidebar"><div class="pref-brand"><img src="${appIcon}" alt=""/><div>Pockymoe<small>${t('桌面设置')}</small></div></div>
    <nav aria-label="${t('设置分类')}">${[['general', 'general', t('通用')], ['pet', 'pet', t('桌宠')], ['shortcuts', 'keyboard', t('快捷键')]].map(([id, glyph, label]) => `<button data-section="${id}" aria-label="${label}" aria-pressed="${section === id}" class="nav-item ${section === id ? 'selected' : ''}">${icon(glyph)}<span>${label}</span></button>`).join('')}</nav>
    <div class="sidebar-bottom"><span>${t('版本 {version}', { version: escapeHtml(state.version) })}</span><button id="update">${t('检查更新')} ${icon('arrow')}</button></div></aside>
    <main class="pref-main" data-scroll><header><h1>${section === 'general' ? t('通用') : section === 'pet' ? t('桌宠') : t('快捷键')}</h1></header><div id="pref-content"></div></main>`;
  document.querySelectorAll<HTMLButtonElement>('[data-section]').forEach(button => { button.onclick = () => { section = button.dataset.section!; renderPreferences(); }; });
  document.querySelector<HTMLButtonElement>('#update')!.onclick = () => { void action({ type: 'checkUpdate' }); };
  const content = root.querySelector<HTMLDivElement>('#pref-content')!, s = state.settings;
  const picker = (id: string, label: string, disabled = false): string => `<button type="button" id="${id}" aria-label="${label}" ${disabled ? 'disabled' : ''}></button>`;
  if (section === 'general') content.innerHTML = `<h2>${t('连接')}</h2><section class="settings-group"><div class="connection-row"><div><label>${t('网页地址')}</label><p class="origin-value">${escapeHtml(s.webOrigin)}</p><label>${t('Relay 地址')}</label><p class="origin-value">${escapeHtml(s.relayOrigin)}</p></div><button id="change-relay">${t('更改…')}</button></div></section>
    <h2>${t('启动')}</h2><section class="settings-group">${toggle('launchAtLogin', t('登录时启动'), t(state.platform === 'win32' ? '关闭窗口后仍在通知区域中运行。' : '关闭窗口后仍在菜单栏中运行。'), s.launchAtLogin)}</section>
    <h2>${t('提醒')}</h2><section class="settings-group"><div class="setting-row"><div><label for="alertMode">${t('提醒方式')}</label><p>${t('当前正在查看的线程不会打扰你。')}${state.platform === 'win32' ? ` ${t('Windows 仅在 Pockymoe 运行时提供提醒。')}` : ''}</p></div>${picker('alertMode', t('提醒方式'))}</div>
    <div class="setting-row"><div><label>${t('暂停提醒')}</label><p>${Date.parse(s.snoozeUntil || '') > Date.now() ? t('暂停至 {time}', { time: new Date(s.snoozeUntil!).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }) }) : t('暂时收起气泡和系统通知。')}</p></div><button id="snooze">${Date.parse(s.snoozeUntil || '') > Date.now() ? t('恢复提醒') : t('暂停 1 小时')}</button></div></section>`;
  else if (section === 'pet') {
    const pack = state.petPacks.find(pack => pack.id === s.petId);
    content.innerHTML = `<section class="settings-group">${toggle('petVisible', t('显示桌宠'), state.petAvailable ? '' : t('桌宠模块尚未安装。'), s.petVisible, !state.petAvailable)}
      <div class="setting-row pet-picker-row"><label for="petId">${t('选择宠物')}</label><div class="inline-controls">${picker('petId', t('选择宠物'), !state.petAvailable)}<button id="import-pet" title="${t('导入…')}" aria-label="${t('导入…')}" ${!state.petAvailable ? 'disabled' : ''}>＋</button></div></div>
      ${pack?.thumbnail ? `<div class="pet-credit"><span class="pet-thumbnail"><img src="${escapeHtml(pack.thumbnail)}" style="height:${(pack.rows || 9) * 100}%" alt="${escapeHtml(pack.name)}"/></span><span><strong>${escapeHtml(pack.name)}</strong><small>${escapeHtml(pack.author || '')}${pack.license ? ` · <button class="text-link" data-external="${escapeHtml(pack.licenseUrl!)}">${escapeHtml(pack.license)}</button>` : ''}${pack.source ? ` · <button class="text-link" data-external="${escapeHtml(pack.source)}">${t('来源')}</button>` : ''}</small></span></div>` : ''}
      <div class="setting-row"><label for="petSize">${t('大小')}</label>${picker('petSize', t('宠物大小'))}</div>
      ${toggle('petEdgeHide', t('贴边自动隐藏'), t('靠近屏幕边缘时收起，指针靠近时探出。'), s.petEdgeHide)}
      ${toggle('petMini', t('Mini 模式'), t('桌宠变小，占更少屏幕。'), s.petMini)}
      ${toggle('petSound', t('提示音'), t('点击桌宠和收到提醒时播放，打开时试听。'), s.petSound)}
      </section><h2>${t('语音')}</h2><section class="settings-group voice-group">${voiceSection(state, picker)}</section>`;
  } else content.innerHTML = `<h2>${t('全局快捷键')}</h2><section class="settings-group"><label for="quickWindowShortcut">${t('唤起快捷窗口')}</label><div class="shortcut-field"><input id="quickWindowShortcut" value="${escapeHtml(s.quickWindowShortcut)}" spellcheck="false" aria-label="${t('快捷窗口快捷键')}"/><button id="save-shortcut">${t('保存')}</button></div></section>
    <h2>${t('在 Pockymoe 中')}</h2><section class="settings-group key-list">${[[t('搜索'), shortcutLabel(state.platform ?? 'darwin', 'F')], [t('打开地图'), shortcutLabel(state.platform ?? 'darwin', '0')], [t('新建线程'), shortcutLabel(state.platform ?? 'darwin', 'N')], [t('设置'), shortcutLabel(state.platform ?? 'darwin', ',')], [t('显示 / 隐藏桌宠'), shortcutLabel(state.platform ?? 'darwin', 'P', true)], [t('退出应用'), shortcutLabel(state.platform ?? 'darwin', 'Q')]].map(([label, key]) => `<div class="setting-row"><span>${label}</span><kbd>${key}</kbd></div>`).join('')}</section>`;
  const bindPicker = (id: keyof DesktopSettings, options: SelectOption[]): void => {
    const trigger = document.getElementById(id) as HTMLButtonElement | null;
    if (trigger) selectCleanups.push(mountSelect(trigger, options, String(s[id]), value => { void save({ [id]: value }); }));
  };
  bindPicker('alertMode', [{ value: 'petFirst', label: t('桌宠优先') }, { value: 'system', label: t('系统通知') }, { value: 'both', label: t('两者都用') }]);
  bindPicker('petSize', [{ value: 'S', label: t('小 · 96 px') }, { value: 'M', label: t('中 · 128 px') }, { value: 'L', label: t('大 · 160 px') }]);
  bindPicker('petId', state.petPacks.map(pack => ({ value: pack.id, label: pack.name, description: [pack.author, pack.license].filter(Boolean).join(' · '), image: pack.thumbnail, rows: pack.rows })));
  if (section === 'pet') bindVoice(root, state, selectCleanups, save, action, renderPreferences);
  root.querySelectorAll<HTMLInputElement>('.switch').forEach(el => { el.onchange = () => { void save({ [el.id]: el.checked }); }; });
  const snooze = root.querySelector<HTMLButtonElement>('#snooze'); if (snooze) snooze.onclick = () => { void save({ snoozeUntil: Date.parse(s.snoozeUntil || '') > Date.now() ? null : new Date(Date.now() + 3600_000).toISOString() }); };
  const relay = root.querySelector<HTMLButtonElement>('#change-relay'); if (relay) relay.onclick = () => { void action({ type: 'changeConnection' }); };
  const shortcut = root.querySelector<HTMLButtonElement>('#save-shortcut'); if (shortcut) shortcut.onclick = () => { void save({ quickWindowShortcut: root.querySelector<HTMLInputElement>('#quickWindowShortcut')!.value }); };
  const importer = root.querySelector<HTMLButtonElement>('#import-pet'); if (importer) importer.onclick = () => { void action({ type: 'importPet' }); };
  root.querySelectorAll<HTMLButtonElement>('[data-external]').forEach(button => { button.onclick = () => { void action({ type: 'external', url: button.dataset.external! }); }; });
  if (state.platform === 'win32') root.querySelectorAll('textarea').forEach(element => element.setAttribute('data-scroll', ''));
  enhanceScrollbars(root); root.querySelector('.pref-main')!.scrollTop = scroll;
  const replacement = activeId ? document.getElementById(activeId) : activeSection ? root.querySelector<HTMLElement>(`[data-section="${activeSection}"]`) : null;
  if (replacement && active) {
    replacement.focus({ preventScroll: true });
    if (draft && replacement instanceof HTMLInputElement) { replacement.value = draft.value; replacement.setSelectionRange(draft.start, draft.end); }
  }
}
function renderAbout(): void {
  root.className = 'about-page';
  root.innerHTML = `<div class="drag-zone"></div><img class="app-icon" src="${appIcon}" alt=""/><h1>Pockymoe</h1><p>${t('版本 {version}', { version: escapeHtml(state.version) })}</p><section><h2>${t('宠物署名')}</h2>${state.petPacks.filter(pack => pack.author).map(pack => `<p><strong>${escapeHtml(pack.name)}</strong> · ${escapeHtml(pack.author!)}${pack.license ? ` · <button class="text-link" data-external="${escapeHtml(pack.licenseUrl!)}">${escapeHtml(pack.license)}</button>` : ''}${pack.source ? ` · <button class="text-link" data-external="${escapeHtml(pack.source)}">${t('来源')}</button>` : ''}</p>`).join('')}</section>`;
  root.querySelectorAll<HTMLButtonElement>('[data-external]').forEach(button => { button.onclick = () => { void action({ type: 'external', url: button.dataset.external! }); }; });
}
// A render replaces the page, which would close a list someone has open. It can wait until they choose.
let renderWaiting = false;
function renderWhenClosed(): void {
  if (!document.querySelector('.custom-select[aria-expanded="true"]')) { renderWaiting = false; renderPreferences(); return; }
  if (renderWaiting) return;
  renderWaiting = true;
  const check = (): void => { if (document.querySelector('.custom-select[aria-expanded="true"]')) setTimeout(check, 150); else { renderWaiting = false; renderPreferences(); } };
  setTimeout(check, 150);
}
async function save(patch: Partial<DesktopSettings>): Promise<void> { if (await action({ type: 'settings', patch })) toast(t('已保存')); else { state = await localBridge().getState(); renderPreferences(); } }
async function init(): Promise<void> {
  state = await localBridge().getState();
  document.documentElement.dataset.glassFallback = String(!!state.glassFallback);
  document.documentElement.dataset.view = view;
  setLocale(state.locale);
  section = state.preferencesSection;
  applyAppearance(state.appearance);
  const messageResponse = (id: number, response: number): void => { void action({ type: 'messageResponse', id, response }); };
  renderMessage(state.message, messageResponse);
  const marks = document.createElement('style'); marks.textContent = statusMarkStyles; document.head.append(marks);
  localBridge().onState(next => { setLocale(next.locale); applyAppearance(next.appearance); renderMessage(next.message, messageResponse); });
  if (view === 'quick') { mountQuick(root, state); return; }
  if (view === 'preferences') renderPreferences(); else if (view === 'about') renderAbout(); else renderRelay();
  localBridge().onState(next => {
    // A repeated request must still reveal its section after the user changed tabs.
    const localeChanged = next.locale !== state.locale;
    const sectionChanged = next.preferencesRequestId !== state.preferencesRequestId;
    if (sectionChanged) section = next.preferencesSection;
    // Download progress updates its own text; a full render would close an open picker every percent.
    // Reading a service's lists updates its note in place; only different lists need a new page.
    const voiceShape = (value: LocalState) => ({ ...value.voice, model: { ...value.voice.model, progress: 0 }, discovery: null, summary: value.summary });
    const changed = localeChanged || sectionChanged || JSON.stringify([state.settings, state.petPacks, state.petAvailable, voiceShape(state)]) !== JSON.stringify([next.settings, next.petPacks, next.petAvailable, voiceShape(next)]);
    state = next;
    if (view === 'preferences') updateVoiceProgress(root, next);
    if (view === 'preferences' && changed) renderWhenClosed();
    if (view === 'relay' && localeChanged) renderRelay();
    if (view === 'about' && changed) renderAbout();
    if (localeChanged && lastToast && document.querySelector('#toast.visible')) toast(localizeMessage(lastToast.message), lastToast.error);
  });
}
void init();
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) void action({ type: 'hide' }); });
export type { ActivityItem };
