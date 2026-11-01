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
let toastTimer: ReturnType<typeof setTimeout>;

export function toast(message: string, error = false): void {
  let el = document.querySelector<HTMLDivElement>('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.role = 'status'; document.body.append(el); }
  if (error) showError(el, message); else el.textContent = message;
  el.className = error ? 'error visible' : 'visible';
  clearTimeout(toastTimer); if (!error) toastTimer = setTimeout(() => el?.classList.remove('visible'), 4000);
}
export async function action(value: LocalAction): Promise<boolean> {
  try { const result = await localBridge().action(value); if (!result.ok) toast(result.error || '操作失败', true); return result.ok; }
  catch { toast('连接暂时不可用，请重试', true); return false; }
}
const toggle = (id: keyof DesktopSettings, title: string, description: string, checked: boolean, disabled = false): string => `<div class="setting-row"><div><label for="${id}">${title}</label><p>${description}</p></div><input class="switch" type="checkbox" id="${id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}/></div>`;
function renderRelay(): void {
  root.className = 'relay-page';
  root.innerHTML = `<div class="drag-zone"></div><div class="relay-content" data-scroll><img class="app-icon" src="${appIcon}" alt="Pockymoe"/><div class="eyebrow">POCKYMOE</div><h1>你的设备，随时在手边。</h1><p class="intro">连接 Pockymoe，继续每一段工作。<br/>线程、设备与进展，在这里汇合。</p><form id="relay-form"><label for="origin">Pockymoe 地址</label><div class="origin-field">${icon('link')}<input id="origin" type="url" required spellcheck="false" autocomplete="url" value="${escapeHtml(state.settings.webOrigin)}" placeholder="https://app.lnz-study.com"/></div><p class="hint">填写网页或 Relay 地址，自动发现连接。</p><details id="advanced"><summary>高级</summary><div class="advanced-fields"><label for="web-origin">网页地址</label><input id="web-origin" type="url" spellcheck="false" value="${escapeHtml(state.settings.webOrigin)}"/><label for="relay-origin">Relay 地址</label><input id="relay-origin" type="url" spellcheck="false" value="${escapeHtml(state.settings.relayOrigin)}"/><p class="hint">分别指定网页与 API 地址；同源部署可填写相同地址。</p></div></details><button class="primary connect" type="submit">连接 <span aria-hidden="true">→</span></button><p id="relay-error" class="inline-error" role="alert"></p></form><div class="relay-footer"><span class="secure-dot"></span> 端到端加密 · 密钥保留在你的设备上</div></div>`;
  enhanceScrollbars(root);
  document.querySelector<HTMLFormElement>('#relay-form')!.onsubmit = async e => {
    e.preventDefault();
    const origin = document.querySelector<HTMLInputElement>('#origin')!.value.trim();
    const advanced = document.querySelector<HTMLDetailsElement>('#advanced')!.open;
    const button = document.querySelector<HTMLButtonElement>('.connect')!;
    const error = document.querySelector<HTMLElement>('#relay-error')!;
    error.textContent = ''; button.disabled = true; button.textContent = '正在连接…';
    try {
      const result = await localBridge().action({ type: 'connect', origin, ...(advanced ? {
        webOrigin: document.querySelector<HTMLInputElement>('#web-origin')!.value.trim(),
        relayOrigin: document.querySelector<HTMLInputElement>('#relay-origin')!.value.trim()
      } : {}) });
      if (!result.ok) error.textContent = result.error || '连接失败，请重试';
    } catch { error.textContent = '连接暂时不可用，请重试'; }
    finally { button.disabled = false; button.innerHTML = '连接 <span aria-hidden="true">→</span>'; }
  };
}
function renderPreferences(): void {
  const brand = root.querySelector('.pref-brand');
  const active = root.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
  const activeId = active?.id;
  const activeSection = active?.dataset.section;
  const draft = active instanceof HTMLInputElement && active.type === 'text' ? { value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
  root.className = 'preferences';
  root.innerHTML = `<aside class="pref-sidebar"><div class="pref-brand"><img src="${appIcon}" alt=""/><div>Pockymoe<small>桌面设置</small></div></div><nav aria-label="设置分类">${[['general', 'general', '通用'], ['pet', 'pet', '桌宠'], ['shortcuts', 'keyboard', '快捷键']].map(([id, glyph, label]) => `<button data-section="${id}" aria-pressed="${section === id}" class="nav-item ${section === id ? 'selected' : ''}">${icon(glyph)}${label}</button>`).join('')}</nav><div class="sidebar-bottom">版本 ${escapeHtml(state.version)}<button id="update">检查更新 ${icon('arrow')}</button></div></aside><main class="pref-main" data-scroll><div class="drag-zone"></div><header><h1>${section === 'general' ? '通用' : section === 'pet' ? '桌宠' : '快捷键'}</h1><p>${section === 'general' ? '让 Pockymoe 融入你的工作方式。' : section === 'pet' ? '一个安静的伙伴，替你留意工作的进展。' : '少一点切换，多一点专注。'}</p></header><div id="pref-content"></div><div class="pref-saved">${icon('check')} 更改会自动保存</div></main>`;
  if (brand) root.querySelector('.pref-brand')!.replaceWith(brand);
  document.querySelectorAll<HTMLButtonElement>('[data-section]').forEach(button => { button.onclick = () => { section = button.dataset.section!; renderPreferences(); }; });
  document.querySelector<HTMLButtonElement>('#update')!.onclick = () => { void action({ type: 'checkUpdate' }); };
  const content = document.querySelector<HTMLDivElement>('#pref-content')!, s = state.settings;
  if (section === 'general') content.innerHTML = `<h2>连接</h2><div class="setting-card"><div class="connection-row"><div><label>网页地址</label><p class="origin-value">${escapeHtml(s.webOrigin)}</p><label>Relay 地址</label><p class="origin-value">${escapeHtml(s.relayOrigin)}</p></div><button id="change-relay">更改…</button></div></div><h2>启动</h2><div class="setting-card">${toggle('launchAtLogin', '登录时启动', '关闭窗口后仍在菜单栏或托盘中运行。', s.launchAtLogin)}</div><h2>提醒</h2><div class="setting-card"><div class="setting-row"><div><label for="alertMode">提醒方式</label><p>当前正在查看的线程不会打扰你。</p></div><select id="alertMode"><option value="petFirst">桌宠优先</option><option value="system">系统通知</option><option value="both">两者都用</option></select></div><div class="setting-row"><div><label>暂停提醒</label><p>${Date.parse(s.snoozeUntil || '') > Date.now() ? `暂停至 ${new Date(s.snoozeUntil!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '暂时收起气泡和系统通知。'}</p></div><button id="snooze">${Date.parse(s.snoozeUntil || '') > Date.now() ? '恢复提醒' : '暂停 1 小时'}</button></div></div>`;
  else if (section === 'pet') content.innerHTML = `<div class="pet-preview"><div class="pet-orbit">${icon('pet')}</div><div><strong>工作有进展，它会告诉你。</strong><p>需要你时提醒，专注时安静陪伴。</p></div></div><div class="setting-card">${toggle('petVisible', '显示桌宠', state.petAvailable ? '桌宠会出现在桌面上，不抢走焦点。' : '桌宠模块尚未安装。', s.petVisible, !state.petAvailable)}<div class="setting-row"><label for="petId">选择宠物</label><div class="inline-controls"><select id="petId" ${!state.petAvailable ? 'disabled' : ''}>${(state.petPacks.length ? state.petPacks : [{ id: s.petId, name: '默认宠物' }]).map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('')}</select><button id="import-pet" ${!state.petAvailable ? 'disabled' : ''}>导入…</button></div></div><div class="setting-row"><label for="petSize">大小</label><select id="petSize"><option value="S">小 · 96 px</option><option value="M">中 · 128 px</option><option value="L">大 · 160 px</option></select></div>${toggle('petMini', 'Mini 模式', '只显示控制条和活动托盘。', s.petMini)}${toggle('petSound', '提示音', '在有新提醒时播放轻声提示。', s.petSound)}</div><p class="hint">支持 Codex 宠物包（pet.json 与精灵图），也支持 ZIP。</p>`;
  else content.innerHTML = `<h2>全局快捷键</h2><div class="setting-card"><label for="quickWindowShortcut">唤起快捷窗口</label><p>在任意应用中查看任务，或快速回复。</p><div class="shortcut-field"><input id="quickWindowShortcut" value="${escapeHtml(s.quickWindowShortcut)}" spellcheck="false" aria-label="快捷窗口快捷键"/><button id="save-shortcut">保存</button></div></div><h2>在 Pockymoe 中</h2><div class="setting-card key-list">${[['搜索', '⌘ / Ctrl F'], ['打开地图', '⌘ / Ctrl 0'], ['新建线程', '⌘ / Ctrl N'], ['设置', '⌘ / Ctrl ,'], ['显示 / 隐藏桌宠', '⌘ / Ctrl ⇧ P'], ['退出应用', '⌘ / Ctrl Q']].map(([label, key]) => `<div class="setting-row"><span>${label}</span><kbd>${key}</kbd></div>`).join('')}</div>`;
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
async function save(patch: Partial<DesktopSettings>): Promise<void> { if (await action({ type: 'settings', patch })) toast('已保存'); else { state = await localBridge().getState(); renderPreferences(); } }
async function init(): Promise<void> {
  state = await localBridge().getState();
  section = state.preferencesSection;
  applyAppearance(state.appearance);
  const marks = document.createElement('style'); marks.textContent = statusMarkStyles; document.head.append(marks);
  localBridge().onState(next => applyAppearance(next.appearance));
  if (view === 'quick') { mountQuick(root, state); return; }
  if (view === 'preferences') renderPreferences(); else renderRelay();
  localBridge().onState(next => {
    // A repeated request must still reveal its section after the user changed tabs.
    const sectionChanged = next.preferencesRequestId !== state.preferencesRequestId;
    if (sectionChanged) section = next.preferencesSection;
    const changed = sectionChanged || JSON.stringify([state.settings, state.petPacks, state.petAvailable]) !== JSON.stringify([next.settings, next.petPacks, next.petAvailable]);
    state = next;
    if (view === 'preferences' && changed) renderPreferences();
  });
}
void init();
document.addEventListener('keydown', e => { if (e.key === 'Escape') void action({ type: 'hide' }); });
export type { ActivityItem };
