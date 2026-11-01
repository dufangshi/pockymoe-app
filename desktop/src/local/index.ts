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
const root = document.querySelector<HTMLDivElement>('#app')!;
const view = new URLSearchParams(location.search).get('view') || 'relay';
let state: LocalState;
let section = 'general';
let lastToast: { message: string; error: boolean } | null = null;
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
const toggle = (id: keyof DesktopSettings, title: string, description: string, checked: boolean, disabled = false): string => `<div class="setting-row"><div><label for="${id}">${title}</label><p>${description}</p></div><input class="switch" type="checkbox" id="${id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}/></div>`;
function renderRelay(): void {
  const savedFields = new Map(['origin', 'web-origin', 'relay-origin'].map(id => [id, root.querySelector<HTMLInputElement>(`#${id}`)?.value]));
  const wasAdvanced = root.querySelector<HTMLDetailsElement>('#advanced')?.open || false;
  const image = root.querySelector('.app-icon');
  root.className = 'relay-page';
  root.innerHTML = `<div class="drag-zone"></div><div class="relay-content" data-scroll><img class="app-icon" src="${appIcon}" alt="Pockymoe"/><div class="eyebrow">POCKYMOE</div><h1>${t("你的设备，随时在手边。")}</h1><p class="intro">${t("连接 Pockymoe，继续每一段工作。")}<br/>${t("线程、设备与进展，在这里汇合。")}</p><form id="relay-form"><label for="origin">${t("Pockymoe 地址")}</label><div class="origin-field">${icon('link')}<input id="origin" type="url" required spellcheck="false" autocomplete="url" value="${escapeHtml(state.settings.webOrigin)}" placeholder="https://app.lnz-study.com"/></div><p class="hint">${t("填写网页或 Relay 地址，自动发现连接。")}</p><details id="advanced"><summary>${t("高级")}</summary><div class="advanced-fields"><label for="web-origin">${t("网页地址")}</label><input id="web-origin" type="url" spellcheck="false" value="${escapeHtml(state.settings.webOrigin)}"/><label for="relay-origin">${t("Relay 地址")}</label><input id="relay-origin" type="url" spellcheck="false" value="${escapeHtml(state.settings.relayOrigin)}"/><p class="hint">${t("分别指定网页与 API 地址；同源部署可填写相同地址。")}</p></div></details><button class="primary connect" type="submit">${t("连接")} <span aria-hidden="true">→</span></button><p id="relay-error" class="inline-error" role="alert"></p></form><div class="relay-footer"><span class="secure-dot"></span> ${t("端到端加密 · 密钥保留在你的设备上")}</div></div>`;
  if (image) root.querySelector('.app-icon')!.replaceWith(image);
  for (const [id, value] of savedFields) if (value !== undefined) root.querySelector<HTMLInputElement>(`#${id}`)!.value = value;
  root.querySelector<HTMLDetailsElement>('#advanced')!.open = wasAdvanced;
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
  const brand = root.querySelector('.pref-brand');
  const active = root.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
  const activeId = active?.id;
  const activeSection = active?.dataset.section;
  const draft = active instanceof HTMLInputElement && active.type === 'text' ? { value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
  root.className = 'preferences';
  root.innerHTML = `<aside class="pref-sidebar"><div class="pref-brand"><img src="${appIcon}" alt=""/><div>Pockymoe<small>${t("桌面设置")}</small></div></div><nav aria-label="${t("设置分类")}">${[['general', 'general', t('通用')], ['pet', 'pet', t('桌宠')], ['shortcuts', 'keyboard', t('快捷键')]].map(([id, glyph, label]) => `<button data-section="${id}" aria-pressed="${section === id}" class="nav-item ${section === id ? 'selected' : ''}">${icon(glyph)}${label}</button>`).join('')}</nav><div class="sidebar-bottom">${t('版本 {version}', { version: escapeHtml(state.version) })}<button id="update">${t('检查更新')} ${icon('arrow')}</button></div></aside><main class="pref-main" data-scroll><div class="drag-zone"></div><header><h1>${section === 'general' ? t('通用') : section === 'pet' ? t('桌宠') : t('快捷键')}</h1><p>${section === 'general' ? t('让 Pockymoe 融入你的工作方式。') : section === 'pet' ? t('一个安静的伙伴，替你留意工作的进展。') : t('少一点切换，多一点专注。')}</p></header><div id="pref-content"></div><div class="pref-saved">${icon('check')} ${t('更改会自动保存')}</div></main>`;
  if (brand) { root.querySelector('.pref-brand')!.replaceWith(brand); brand.querySelector('small')!.textContent = t('桌面设置'); }
  document.querySelectorAll<HTMLButtonElement>('[data-section]').forEach(button => { button.onclick = () => { section = button.dataset.section!; renderPreferences(); }; });
  document.querySelector<HTMLButtonElement>('#update')!.onclick = () => { void action({ type: 'checkUpdate' }); };
  const content = document.querySelector<HTMLDivElement>('#pref-content')!, s = state.settings;
  if (section === 'general') content.innerHTML = `<h2>${t("连接")}</h2><div class="setting-card"><div class="connection-row"><div><label>${t("网页地址")}</label><p class="origin-value">${escapeHtml(s.webOrigin)}</p><label>${t("Relay 地址")}</label><p class="origin-value">${escapeHtml(s.relayOrigin)}</p></div><button id="change-relay">${t("更改…")}</button></div></div><h2>${t("启动")}</h2><div class="setting-card">${toggle('launchAtLogin', t('登录时启动'), t('关闭窗口后仍在菜单栏或托盘中运行。'), s.launchAtLogin)}</div><h2>${t("提醒")}</h2><div class="setting-card"><div class="setting-row"><div><label for="alertMode">${t("提醒方式")}</label><p>${t("当前正在查看的线程不会打扰你。")}</p></div><select id="alertMode"><option value="petFirst">${t("桌宠优先")}</option><option value="system">${t("系统通知")}</option><option value="both">${t("两者都用")}</option></select></div><div class="setting-row"><div><label>${t("暂停提醒")}</label><p>${Date.parse(s.snoozeUntil || '') > Date.now() ? t('暂停至 {time}', { time: new Date(s.snoozeUntil!).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }) }) : t('暂时收起气泡和系统通知。')}</p></div><button id="snooze">${Date.parse(s.snoozeUntil || '') > Date.now() ? t('恢复提醒') : t('暂停 1 小时')}</button></div></div>`;
  else if (section === 'pet') content.innerHTML = `<div class="pet-preview"><div class="pet-orbit">${icon('pet')}</div><div><strong>${t("工作有进展，它会告诉你。")}</strong><p>${t("需要你时提醒，专注时安静陪伴。")}</p></div></div><div class="setting-card">${toggle('petVisible', t('显示桌宠'), state.petAvailable ? t('桌宠会出现在桌面上，不抢走焦点。') : t('桌宠模块尚未安装。'), s.petVisible, !state.petAvailable)}<div class="setting-row"><label for="petId">${t("选择宠物")}</label><div class="inline-controls"><select id="petId" ${!state.petAvailable ? 'disabled' : ''}>${(state.petPacks.length ? state.petPacks : [{ id: s.petId, name: t('默认宠物') }]).map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('')}</select><button id="import-pet" ${!state.petAvailable ? 'disabled' : ''}>${t("导入…")}</button></div></div><div class="setting-row"><label for="petSize">${t("大小")}</label><select id="petSize"><option value="S">${t("小 · 96 px")}</option><option value="M">${t("中 · 128 px")}</option><option value="L">${t("大 · 160 px")}</option></select></div>${toggle('petMini', t('Mini 模式'), t('只显示控制条和活动托盘。'), s.petMini)}${toggle('petSound', t('提示音'), t('在有新提醒时播放轻声提示。'), s.petSound)}</div><p class="hint">${t("支持 Codex 宠物包（pet.json 与精灵图），也支持 ZIP。")}</p>`;
  else content.innerHTML = `<h2>${t("全局快捷键")}</h2><div class="setting-card"><label for="quickWindowShortcut">${t("唤起快捷窗口")}</label><p>${t("在任意应用中查看任务，或快速回复。")}</p><div class="shortcut-field"><input id="quickWindowShortcut" value="${escapeHtml(s.quickWindowShortcut)}" spellcheck="false" aria-label="${t("快捷窗口快捷键")}"/><button id="save-shortcut">${t("保存")}</button></div></div><h2>${t("在 Pockymoe 中")}</h2><div class="setting-card key-list">${[[t('搜索'), '⌘ / Ctrl F'], [t('打开地图'), '⌘ / Ctrl 0'], [t('新建线程'), '⌘ / Ctrl N'], [t('设置'), '⌘ / Ctrl ,'], [t('显示 / 隐藏桌宠'), '⌘ / Ctrl ⇧ P'], [t('退出应用'), '⌘ / Ctrl Q']].map(([label, key]) => `<div class="setting-row"><span>${label}</span><kbd>${key}</kbd></div>`).join('')}</div>`;
  for (const id of ['alertMode', 'petId', 'petSize']) { const el = document.getElementById(id) as HTMLSelectElement | null; if (el) { el.value = String(s[id as keyof DesktopSettings]); el.onchange = () => { void save({ [id]: el.value }); }; } }
  document.querySelectorAll<HTMLInputElement>('.switch').forEach(el => { el.onchange = () => { void save({ [el.id]: el.checked }); }; });
  const snooze = document.querySelector<HTMLButtonElement>('#snooze'); if (snooze) snooze.onclick = () => { void save({ snoozeUntil: Date.parse(s.snoozeUntil || '') > Date.now() ? null : new Date(Date.now() + 3600_000).toISOString() }); };
  const relay = document.querySelector<HTMLButtonElement>('#change-relay'); if (relay) relay.onclick = () => { void action({ type: 'changeConnection' }); };
  const shortcut = document.querySelector<HTMLButtonElement>('#save-shortcut'); if (shortcut) shortcut.onclick = () => { void save({ quickWindowShortcut: document.querySelector<HTMLInputElement>('#quickWindowShortcut')!.value }); };
  enhanceScrollbars(root);
  const importer = document.querySelector<HTMLButtonElement>('#import-pet'); if (importer) importer.onclick = () => { void action({ type: 'importPet' }); };
  const replacement = activeId ? document.getElementById(activeId) : activeSection ? root.querySelector<HTMLElement>(`[data-section="${activeSection}"]`) : null;
  if (replacement && active) {
    replacement.focus({ preventScroll: true });
    if (draft && replacement instanceof HTMLInputElement) { replacement.value = draft.value; replacement.setSelectionRange(draft.start, draft.end); }
  }
}
async function save(patch: Partial<DesktopSettings>): Promise<void> { if (await action({ type: 'settings', patch })) toast(t('已保存')); else { state = await localBridge().getState(); renderPreferences(); } }
async function init(): Promise<void> {
  state = await localBridge().getState();
  setLocale(state.locale);
  section = state.preferencesSection;
  applyAppearance(state.appearance);
  const marks = document.createElement('style'); marks.textContent = statusMarkStyles; document.head.append(marks);
  localBridge().onState(next => { setLocale(next.locale); applyAppearance(next.appearance); });
  if (view === 'quick') { mountQuick(root, state); return; }
  if (view === 'preferences') renderPreferences(); else renderRelay();
  localBridge().onState(next => {
    // A repeated request must still reveal its section after the user changed tabs.
    const localeChanged = next.locale !== state.locale;
    const sectionChanged = next.preferencesRequestId !== state.preferencesRequestId;
    if (sectionChanged) section = next.preferencesSection;
    const changed = localeChanged || sectionChanged || JSON.stringify([state.settings, state.petPacks, state.petAvailable]) !== JSON.stringify([next.settings, next.petPacks, next.petAvailable]);
    state = next;
    if (view === 'preferences' && changed) renderPreferences();
    if (view === 'relay' && localeChanged) renderRelay();
    if (localeChanged && lastToast && document.querySelector('#toast.visible')) toast(localizeMessage(lastToast.message), lastToast.error);
  });
}
void init();
document.addEventListener('keydown', e => { if (e.key === 'Escape') void action({ type: 'hide' }); });
export type { ActivityItem };
