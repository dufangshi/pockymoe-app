import { VideoClipPlayer } from './videoPlayer';
document.documentElement.dataset.platform = navigator.userAgent.includes('Windows') ? 'win32' : '';
import './styles.css';
import lucideNotice from './NOTICE?raw';
document.head.append(document.createComment(lucideNotice));
import { ANIMATIONS, frameAt, type SpriteState } from './animation';
import { activityStatus, statusMarkStyles, statusMarkSvg, type StatusMark } from '../shared/statusMarks';
import { conversationTitle, alertTitle } from '../shared/activityGroups';
import { panelConversations, petConversations, petMetadata, replyTarget as conversationReplyTarget, type PetConversation } from './conversations';
import { applyAppearance } from '../shared/appearance';
import { accentForeground, escapeHtml as escape, requestSummaryHtml } from './presentation';
import { getLocale, setLocale, t, type MessageKey } from '../shared/i18n';
import { showError } from '../local/errorMark';
import { commandErrorMessage } from './errors';
import { scrollGeometry } from './scroll';
import { playSound, playSpeech, speechMouth, speechPlaying } from './sounds';
import { isMuted } from '../shared/mutes';
import { dockedPose, dockTilt, peekPose, DEFAULT_FACE_BOX } from './geometry';
import { ClipSequencer } from './clipSequence';
import type { PetClip } from './packs';
import type { ActivityItem, HostCommandResult } from '../shared/contract';
import type { PetAction, PetBridge, PetViewState } from './bridge';
const bridge = (window as unknown as { rcDesktop: { pet: PetBridge } }).rcDesktop.pet;
const root = document.querySelector<HTMLElement>('#app')!;
const markStyle = document.createElement('style'); markStyle.textContent = statusMarkStyles; document.head.append(markStyle);
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let state: PetViewState | null = null, signature = '', lastMeasure = '';
let draft = '', sendState: 'idle' | 'sending' | 'sent' | 'error' = 'idle';
let selected: string | null = null, selectedRequest: string | null = null;
const collapsedRequests = new Set<string>();
const failures = new Map<string, { result: HostCommandResult; key?: string }>(), pending = new Set<string>();
let drag: { id: number; x: number; y: number; moved: boolean } | null = null;
let scrollDrag: { id: number; grab: number } | null = null;
let animationState: SpriteState = 'idle', animationStart = performance.now(), frame = 0;
let spriteImage: HTMLImageElement | null = null, alpha: Uint8ClampedArray | null = null, lastImage = '', hit = false;
let lastPointer: { clientX: number; clientY: number } | null = null;
let lastEpoch = 0;
const canvas = document.createElement('canvas'), context = canvas.getContext('2d', { willReadFrequently: true })!;
const paths: Record<string, string> = {
  robot: '<rect x="3" y="4" width="10" height="9" rx="2"/><path d="M8 2v2M1 7v3M15 7v3M6 10h4"/><circle cx="6" cy="7.5" r=".6"/><circle cx="10" cy="7.5" r=".6"/>', chevron: '<path d="m6 4 4 4-4 4"/>',
  tasks: '<rect x="3" y="2.5" width="10" height="11" rx="2"/><path d="M6 6h4M6 9h4"/>',
  sound: '<path d="M2.5 6v4h2.5l3.5 3V3L5 6zM11 5.5a3.5 3.5 0 0 1 0 5"/>', muted: '<path d="M2.5 6v4h2.5l3.5 3V3L5 6zM11 6l3 4M14 6l-3 4"/>',
  home: '<path d="m2 7 6-5 6 5M4 6v8h8V6M7 14v-4h2v4"/>', more: '<circle cx="3" cy="8" r=".6"/><circle cx="8" cy="8" r=".6"/><circle cx="13" cy="8" r=".6"/>',
  close: '<path d="m5 5 6 6M11 5l-6 6"/>', send: '<path d="M8 13V3m-4 4 4-4 4 4"/>', check: '<path d="m3 8 3 3 7-7"/>',
  open: '<path d="M6 3h7v7M13 3l-9 9M3 5v8h8"/>',
  map: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
};
// LayoutDashboard is the Web rail's canonical map icon (Lucide, ISC; see NOTICE).
const icon = (name: string): string => `<svg viewBox="${name === 'map' ? '0 0 24 24' : '0 0 16 16'}" aria-hidden="true">${paths[name] ?? paths.tasks}</svg>`;
const button = (action: string, label: string, body: string, extra = '') => `<button type="button" data-action="${action}" title="${escape(label)}" aria-label="${escape(label)}" ${extra}>${body}</button>`;
function status(item: ActivityItem): string {
  const kind = activityStatus(item), labels: Record<StatusMark, MessageKey> = { running: '运行中', unread: '已完成，未读', failed: '失败', interrupted: '已中断', waiting: '等待你', idle: '已读，空闲', 'agents-running': '运行中', unknown: '状态未知' };
  return statusMarkSvg(kind, t(labels[kind]));
}
const title = (item: ActivityItem) => conversationTitle(item, state?.items);
/** Split the middle of the conversation with CSS so its agent suffix never ellipsizes. */
function alertHeading(items: ActivityItem[]): string {
  const full = alertTitle(items, state?.items), conversation = conversationTitle(items[0], state?.items);
  const suffix = full.slice(conversation.length);
  return middleName(conversation, full) + `<span class="alert-suffix">${escape(suffix)}</span>`;
}
function middleName(value: string, label = value): string {
  const chars = Array.from(value), split = Math.ceil(chars.length / 2);
  return `<span class="alert-name" title="${escape(label)}"><span class="alert-head">${escape(chars.slice(0, split).join(''))}</span><span class="alert-tail">${escape(chars.slice(split).join(''))}</span></span>`;
}
function errorSlot(id: string): string { return failures.has(id) ? `<span class="pet-error-slot" data-error-id="${escape(id)}" role="alert"></span>` : ''; }
function decisions(item: ActivityItem, surface: string): string {
  const disabled = pending.has(`${surface}:${item.key}`) ? ' disabled aria-busy="true"' : '';
  return `<span class="decisions">${button('approve', t('批准'), icon('check'), `class="primary"${disabled}`)}${button('deny', t('拒绝'), icon('close'), disabled)}</span>`;
}
function controls(): string {
  return `<nav class="controls" aria-label="${escape(t('桌宠控制'))}">${button('toggleTray', t('活动面板'), icon('tasks') + (state?.items.length ? `<span class="task-count">${petConversations(state.items).length}</span>` : ''), `aria-expanded="${state?.mode === 'panel'}"`)}${button('openMain', t('打开主窗口'), icon('home'))}${button('openMap', t('在地图中显示'), icon('map'))}${button('more', t('更多'), icon('more'), `aria-haspopup="menu" aria-expanded="${state?.mode === 'menu'}"`)}</nav>`;
}
function orderedRows(): PetConversation[] { return state ? panelConversations(state.items, state.recent) : []; }
function robotBadge(group: PetConversation): string {
  if (!group.children.length) return '';
  const names = group.children.map(item => item.agentName || item.title).join(', ');
  return `<span class="children-count" title="${escape(names)}" aria-label="${escape(`${t('{count} 个子线程', { count: group.children.length })}: ${names}`)}">${icon('robot')}<span>${group.children.length}</span></span>`;
}
function requestLine(item: ActivityItem, group: PetConversation, actions: boolean, extra = ''): string {
  const owner = item.key !== group.key ? item.agentName || item.title : '';
  return `<div class="request-row ${actions ? '' : 'request-summary-row'} ${selected === group.key && selectedRequest === item.key ? 'selected' : ''}" data-key="${escape(item.key)}" data-request-key="${escape(item.key)}" data-conversation-key="${escape(group.key)}" role="option" aria-selected="${selected === group.key && selectedRequest === item.key}" tabindex="0" title="${escape([owner, item.request?.summary, petMetadata(item)].filter(Boolean).join(' · '))}">${owner ? `<span class="request-owner">${escape(owner)}</span>` : ''}<span class="request-copy">${requestSummaryHtml(item.request?.summary ?? '')}</span>${extra}${actions && item.request?.kind === 'approval' ? decisions(item, 'row') : ''}${actions ? errorSlot(`row:${item.key}`) : ''}</div>`;
}
function muteButton(group: PetConversation): string {
  const muted = state ? isMuted(group.root, state.settings.petMutes) : false;
  const label = t(muted ? '恢复播报此对话' : '不再播报此对话');
  return button('toggleMute', label, icon(muted ? 'muted' : 'sound'), `aria-pressed="${muted}"`);
}
function taskRow(group: PetConversation): string {
  const item = group.statusItem, waiting = group.requests.length > 0, active = selected === group.key;
  const expanded = active && group.requests.length > 1 && !collapsedRequests.has(group.key), primary = group.requests[0];
  const toggle = group.requests.length > 1 ? button('toggleRequests', t(expanded ? '收起「{title}」的线程' : '展开「{title}」的线程', { title: group.title }), icon('chevron'), `class="request-toggle ${expanded ? 'expanded' : ''}" aria-expanded="${expanded}"`) : '';
  return `<article class="conversation-row ${waiting ? 'waiting' : ''}" data-conversation-key="${escape(group.key)}"><div class="task-row ${active && !selectedRequest ? 'selected' : ''} ${item.state === 'idle' ? 'recent' : ''}" data-key="${escape(group.key)}" role="option" aria-selected="${active && !selectedRequest}" tabindex="0" title="${escape(`${group.title} · ${petMetadata(group.root)}`)}"><div class="row-main">${toggle}${status(item)}<span class="row-title">${alertHeading([item])}</span><span class="row-meta"> · ${escape(item.deviceName)}</span><span class="row-actions">${muteButton(group)}${button('open', t('打开'), icon('open'))}${button('revealInMap', t('在地图中显示'), icon('map'))}</span>${robotBadge(group)}${primary && !expanded && primary.request?.kind === 'approval' ? `<span data-key="${escape(primary.key)}">${decisions(primary, 'row')}${errorSlot(`row:${primary.key}`)}</span>` : errorSlot(`row:${group.key}`)}</div></div>${expanded ? `<div class="request-lines">${group.requests.map(request => requestLine(request, group, true)).join('')}</div>` : primary ? requestLine(primary, group, false, group.requests.length > 1 ? button('toggleRequests', `${t('活动面板')} (${group.requests.length})`, `+${group.requests.length - 1}`, 'class="request-more"') : '') : ''}</article>`;
}
/** Everything running on the account, one row per conversation. */
function runningList(): string {
  const groups = petConversations((state?.items ?? []).filter(item => item.state === 'running'), state?.items ?? []);
  const rows = groups.length ? groups.slice(0, 4).map(group => `<div data-key="${escape(group.root.key)}"><button type="button" class="running-row" data-action="open" title="${escape(`${group.title} · ${petMetadata(group.root)}`)}" aria-label="${escape(group.title)}">${status(group.statusItem)}<span class="running-title">${middleName(group.title)}</span><span class="running-device"> · ${escape(group.root.deviceName)}</span></button></div>`).join('') : `<div class="empty">${icon('check')}${escape(t('没有运行中的线程'))}</div>`;
  const more = groups.length > 4 ? button('toggleTray', t('其余 {n} 个', { n: groups.length - 4 }), escape(t('其余 {n} 个', { n: groups.length - 4 })), 'class="running-more"') : '';
  return `<section class="running-list" aria-label="${escape(t('运行中的线程'))}"><div class="scroll-frame" data-scroll-area><div class="task-list scroll-content" id="pet-running-list">${rows}${more}</div><div class="scroll-track" role="scrollbar" aria-label="${escape(t('滚动活动任务'))}" aria-controls="pet-running-list" aria-orientation="vertical" aria-valuemin="0" tabindex="0" hidden><div class="scroll-thumb"></div></div></div></section>`;
}
function renderGlass(): void {
  if (!state || state.surface !== 'glass') return;
  const input = document.querySelector<HTMLInputElement>('#reply-input'), focused = document.activeElement === input;
  const selection = input?.selectionStart ?? null, savedScroll = document.querySelector('.task-list')?.scrollTop ?? 0;
  const readingSummary = root.querySelector('.bubble-full-text')?.textContent;
  const summaryFocused = document.activeElement?.matches('.bubble-title');
  const rows = orderedRows();
  if (!rows.some(group => group.key === selected)) { selected = rows[0]?.key ?? null; selectedRequest = null; }
  const selectedGroup = rows.find(group => group.key === selected);
  if (selectedRequest && !selectedGroup?.requests.some(item => item.key === selectedRequest)) selectedRequest = null;
  const target = selectedGroup ? conversationReplyTarget(selectedGroup, selectedRequest) : undefined;
  root.className = `glass mode-${state.mode}${state.mode === 'controls' && state.pinned ? ' has-running' : ''}`;
  let content = state.mode === 'controls' && state.pinned ? runningList() + controls() : controls();
  if (state.mode === 'panel') content = `<section class="panel" aria-label="${escape(t('活动面板'))}"><header class="panel-header"><span aria-hidden="true">${icon('tasks')}</span>${button('close', t('关闭任务'), icon('close'))}</header><div class="scroll-frame" data-scroll-area><div class="task-list scroll-content" role="listbox" aria-label="${escape(t('活动任务'))}" id="pet-task-list">${rows.length ? rows.map(group => taskRow(group)).join('') : `<div class="empty">${icon('check')}${escape(t('一切就绪'))}</div>`}</div><div class="scroll-track" role="scrollbar" aria-label="${escape(t('滚动活动任务'))}" aria-controls="pet-task-list" aria-orientation="vertical" aria-valuemin="0" tabindex="0" hidden><div class="scroll-thumb"></div></div></div>${target ? `<form id="chat-form" class="chat" data-key="${escape(target?.key ?? '')}"><input id="reply-input" aria-label="${escape(t('发送回复'))}" placeholder="${escape(t('回复 {title}…', { title: title(target) }))}" value="${escape(draft)}" maxlength="16000" autocomplete="off" ${sendState === 'sending' ? 'disabled' : ''}>${errorSlot(`chat:${target?.key}`)}${button('send', sendState === 'sent' ? t('已发送') : sendState === 'sending' ? t('正在发送…') : t('发送回复'), sendState === 'sent' ? icon('check') : icon('send'), `class="send ${sendState === 'sending' ? 'sending' : ''}" ${!target || !draft.trim() || sendState === 'sending' ? 'disabled' : ''}`)}</form>` : ''}<span class="live-announcement" role="status">${sendState === 'error' ? escape(t('未发送')) : sendState === 'sent' ? escape(t('已发送')) : ''}</span></section>`;
  if (state.mode === 'menu') content = `<section class="more" role="menu" aria-label="${escape(t('宠物偏好'))}">${button('mini', t('Mini 模式'), `${escape(t('Mini 模式'))}${state.settings.petMini ? icon('check') : ''}`, 'role="menuitemcheckbox" aria-checked="'+state.settings.petMini+'"')}<div class="menu-sizes" role="group" aria-label="${escape(t('宠物大小'))}">${(['S', 'M', 'L'] as const).map(size => button(`size-${size}`, size, size, `role="menuitemradio" aria-checked="${state!.settings.petSize === size}"`)).join('')}</div>${button('edgeHide', t('贴边时缩到边缘'), `<span class="menu-copy">${escape(t('贴边时缩到边缘'))}</span>` + (state.edgeHide ? icon('check') : ''), `role="menuitemcheckbox" aria-checked="${state.edgeHide}"`)}${button('sound', t('提示音'), `<span class="menu-copy">${escape(t('提示音'))}</span>` + (state.settings.petSound ? icon('check') : ''), `role="menuitemcheckbox" aria-checked="${state.settings.petSound}"`)}${button('voice', t('语音播报'), `<span class="menu-copy">${escape(t('语音播报'))}</span>` + (state.settings.petVoice ? icon('check') : ''), `role="menuitemcheckbox" aria-checked="${state.settings.petVoice}"`)}<hr>${button('preferences', t('偏好设置…'), escape(t('偏好设置…')), 'role="menuitem"')}${button('hide', t('隐藏桌宠'), escape(t('隐藏桌宠')), 'role="menuitem"')}</section>`;
  const bubble = state.bubble;
  const bubbleGroups = bubble ? petConversations(bubble.events.map(event => event.item), state.items) : [];
  const group = bubbleGroups[0];
  if (state.mode === 'bubble' && bubble && group) {
    const item = group.requests[0] ?? group.statusItem, count = bubbleGroups.length, event = bubble.events.find(event => event.item.key === item.key) ?? bubble.events[0];
    const heading = count > 1 ? t('{count} 完成', { count }) : alertTitle(group.items, state.items);
    content = `<aside class="bubble ${bubble.sticky ? 'sticky' : ''}" data-key="${escape(group.key)}" data-conversation-key="${escape(group.key)}" data-alert-id="${escape(event.alertId)}"><div class="bubble-line">${status(group.statusItem)}${button('open', heading, (count > 1 ? escape(heading) : alertHeading(group.items)), `class="bubble-title"${bubble.sticky && item.request?.summary ? ' aria-describedby="bubble-summary"' : ''}`)}<span class="bubble-device" title="${escape(petMetadata(group.root))}"> · ${escape(item.deviceName)}</span>${bubble.sticky && item.request?.kind === 'approval' ? `<span data-key="${escape(item.key)}">${decisions(item, 'bubble')}${errorSlot(`bubble:${item.key}`)}</span>` : errorSlot(`bubble:${item.key}`)}</div>${bubble.sticky && item.request?.summary ? `<div class="bubble-request-line"><div class="request-summary" id="bubble-summary" title="${escape(item.request.summary)}" aria-label="${escape(item.request.summary)}">${requestSummaryHtml(item.request.summary)}</div>${group.requests.length > 1 ? button('showConversation', `${t('活动面板')} (${group.requests.length})`, `+${group.requests.length - 1}`, 'class="request-more"') : ''}</div>` : ''}</aside>${state.near ? controls() : ''}`;
  }
  root.innerHTML = content;
  root.querySelectorAll<HTMLElement>('[data-error-id]').forEach(slot => {
    const failure = failures.get(slot.dataset.errorId!); if (!failure) return;
    showError(slot, commandErrorMessage(failure.result, state?.locale ?? getLocale()), failure.key ? () => { void itemAction({ type: 'open', key: failure.key! }, 'row'); } : undefined, { actionLabel: t('在线程中打开') });
  });
  const list = document.querySelector<HTMLElement>('.task-list'); if (list) list.scrollTop = savedScroll;
  if (focused) { const next = document.querySelector<HTMLInputElement>('#reply-input'); next?.focus(); if (selection !== null) next?.setSelectionRange(selection, selection); }
  if (summaryFocused) root.querySelector<HTMLElement>('.bubble-title')?.focus();
  if (readingSummary && root.querySelector('.request-summary')?.getAttribute('aria-label') === readingSummary) showFullSummary();
  requestAnimationFrame(() => { updateScrollArea(); measure(); });
}
// Reading the clipped summary must not replace DOM, steal focus or move the anchor.
function showFullSummary(): void {
  const summary = root.querySelector<HTMLElement>('.request-summary');
  if (!summary || (summary.scrollHeight <= summary.clientHeight + 1 && summary.scrollWidth <= summary.clientWidth + 1) || root.querySelector('.bubble-full-text')) return;
  const detail = document.createElement('div'); detail.className = 'bubble-full-text'; detail.setAttribute('role', 'tooltip');
  detail.textContent = summary.getAttribute('aria-label') || summary.title;
  root.append(detail);
}
root.addEventListener('pointerover', event => { if ((event.target as Element).closest('.request-summary,.bubble-title')) showFullSummary(); });
root.addEventListener('pointerleave', () => { if (!root.contains(document.activeElement)) root.querySelector('.bubble-full-text')?.remove(); });
root.addEventListener('focusin', event => { if ((event.target as Element).closest('.bubble-title')) showFullSummary(); });
root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget as Node | null)) root.querySelector('.bubble-full-text')?.remove(); });
function measure(): void {
  const rect = root.getBoundingClientRect(), value = { type: 'surfaceMeasure' as const, width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
  const next = JSON.stringify(value); if (next !== lastMeasure) { lastMeasure = next; void bridge.action(value); }
}
async function itemAction(action: PetAction & { key: string }, surface: string): Promise<HostCommandResult> {
  const id = `${surface}:${action.key}`, account = state?.accountId; failures.delete(id); pending.add(id); renderGlass();
  let result: HostCommandResult; try { result = await bridge.action(action); } catch { result = { ok: false }; }
  if (state?.accountId !== account) return result;
  pending.delete(id); if (!result.ok) failures.set(id, { result, key: action.key }); renderGlass(); return result;
}
function selectActivityRow(row: HTMLElement): void {
  selected = row.closest<HTMLElement>('[data-conversation-key]')?.dataset.conversationKey ?? row.dataset.key ?? null;
  selectedRequest = row.dataset.requestKey ?? null;
  if (selected) collapsedRequests.delete(selected);
  const group = orderedRows().find(group => group.key === selected), target = group ? conversationReplyTarget(group, selectedRequest) : null;
  if (target) void bridge.action({ type: 'target', key: target.key });
  renderGlass();
}
root.addEventListener('click', event => {
  const element = event.target as HTMLElement, control = element.closest<HTMLElement>('[data-action]');
  const row = element.closest<HTMLElement>('.task-row,.request-row');
  if (!control && row) { selectActivityRow(row); return; }
  if (!control || !state) return;
  const type = control.dataset.action!, key = control.closest<HTMLElement>('[data-key]')?.dataset.key;
  const surface = control.closest('.bubble') ? 'bubble' : 'row';
  if (type === 'toggleRequests') {
    const groupKey = control.closest<HTMLElement>('[data-conversation-key]')?.dataset.conversationKey; if (!groupKey) return;
    if (selected === groupKey && !collapsedRequests.has(groupKey)) collapsedRequests.add(groupKey); else collapsedRequests.delete(groupKey);
    selected = groupKey; selectedRequest = null; renderGlass(); return;
  }
  if (type === 'showConversation' && key) { void bridge.action({ type: 'showConversation', key }); return; }
  if (type === 'toggleMute' && key) { void bridge.action({ type: 'toggleMute', key }); return; }
  if (key && ['approve', 'deny', 'open', 'revealInMap'].includes(type)) { void itemAction({ type: type as 'approve' | 'deny' | 'open' | 'revealInMap', key }, surface); return; }
  if (type === 'send') { document.querySelector<HTMLFormElement>('#chat-form')?.requestSubmit(); return; }
  const action: PetAction = type === 'more' ? { type: 'menu', value: true } : type.startsWith('size-') ? { type: 'setSize', size: type.slice(5) as 'S' | 'M' | 'L' } : type === 'mini' ? { type: 'setMini', value: !state.settings.petMini } : type === 'edgeHide' ? { type: 'setEdgeHide', value: !state.edgeHide } : type === 'sound' ? { type: 'setSound', value: !state.settings.petSound } : type === 'voice' ? { type: 'setVoice', value: !state.settings.petVoice } : type === 'hide' ? { type: 'setVisible', value: false } : { type } as PetAction;
  void bridge.action(action);
});
root.addEventListener('dblclick', event => { const row = (event.target as HTMLElement).closest<HTMLElement>('.task-row,.request-row'); if (row?.dataset.key) void itemAction({ type: 'open', key: row.dataset.key }, 'row'); });
root.addEventListener('input', event => { if ((event.target as HTMLElement).id !== 'reply-input') return; draft = (event.target as HTMLInputElement).value; sendState = 'idle'; const send = root.querySelector<HTMLButtonElement>('.send'); if (send) { send.disabled = !draft.trim(); send.innerHTML = icon('send'); } });
root.addEventListener('submit', event => {
  event.preventDefault(); if (!selected || !draft.trim() || sendState === 'sending') return;
  const group = orderedRows().find(group => group.key === selected); if (!group) return;
  const target = conversationReplyTarget(group, selectedRequest);
  sendState = 'sending'; const text = draft, account = state?.accountId; renderGlass();
  void itemAction({ type: 'reply', key: target.key, text }, 'chat').then(result => { if (state?.accountId !== account) return; sendState = result.ok ? 'sent' : 'error'; if (result.ok && draft === text) draft = ''; renderGlass(); });
});
let peekSource: HTMLImageElement | null = null;
let dockClipHeld = false;
function paintPeek(): void {
  const ch = root.querySelector('#character'); if (!state || !ch) return;
  let c = ch.querySelector<HTMLCanvasElement>('#peek-art');
  if (!state.peekArt || state.edge !== 'left' && state.edge !== 'right') { c?.remove(); return; }
  if (!c) { c = document.createElement('canvas'); c.id = 'peek-art'; ch.append(c); }
  const art = state.peekArt, src = art.imageUrl;
  if (!peekSource || peekSource.src !== src) { peekSource = new Image(); peekSource.onload = () => { paintPeek(); updateHit(); }; peekSource.src = src; }
  if (!peekSource.complete || !peekSource.naturalWidth) return;
  c.width = Math.round(state.pet.width * devicePixelRatio); c.height = Math.round(state.pet.height * devicePixelRatio);
  const ctx = c.getContext('2d', { willReadFrequently: true })!, r = peekPose(state.pet.width, state.pet.height, state.edge, state.dockAmount || 1, state.faceBox ?? DEFAULT_FACE_BOX, art);
  ctx.scale(devicePixelRatio, devicePixelRatio); ctx.imageSmoothingQuality = 'high';
  if (state.edge === 'left') { ctx.translate(state.pet.width, 0); ctx.scale(-1, 1); ctx.drawImage(peekSource, state.pet.width - r.x - r.width, r.y, r.width, r.height); }
  else ctx.drawImage(peekSource, r.x, r.y, r.width, r.height);
}
function renderSprite(): void {
  if (!state) return;
  if (!root.querySelector('#character')) root.innerHTML = `<div id="character" role="button" tabindex="0"><div id="sprite-old"></div><div id="sprite"></div><canvas id="clip"></canvas><canvas id="talk" aria-hidden="true"></canvas><svg class="sleep-motes" viewBox="0 0 36 48" aria-hidden="true"><path d="M7 34h6l-6 6h6"/><path d="M17 24h7l-7 7h7"/><path d="M23 13h5l-5 5h5"/></svg></div>`;
  const character = root.querySelector<HTMLElement>('#character')!;
  character.setAttribute('aria-label', t('桌宠，点击查看任务，拖动以移动'));
  character.style.width = `${state.pet.width}px`; character.style.height = `${state.pet.height}px`;
  // Leaning out from the edge; at the top she hangs upside down, so it is still her head that shows.
  const sideArt = !!state.peekArt && (state.edge === 'left' || state.edge === 'right');
  const tilt = sideArt ? 0 : dockTilt(state.edge, state.dockAmount);
  const pose = dockedPose(state.pet.width, state.pet.height, state.edge, state.dockAmount, state.faceBox, state.peekArt);
  character.style.transformOrigin = `${pose.pivot.x}px ${pose.pivot.y}px`;
  const feather = pose.clip ? `linear-gradient(to bottom, #000 0px, #000 ${Math.max(0, pose.clip.y + pose.clip.height - 12)}px, transparent ${pose.clip.y + pose.clip.height}px)` : state.dockAmount > 0 ? `linear-gradient(to bottom, #000 0px, #000 ${state.pet.height - 12}px, transparent ${state.pet.height}px)` : '';
  character.style.maskImage = sideArt ? '' : feather;
  character.style.clipPath = sideArt ? '' : pose.clip ? `inset(${pose.clip.y}px ${state.pet.width - pose.clip.x - pose.clip.width}px ${state.pet.height - pose.clip.y - pose.clip.height}px ${pose.clip.x}px)` : '';
  character.style.transform = `translate(${state.pet.x}px,${state.pet.y}px) rotate(${tilt}deg)`;
  character.classList.toggle('has-peek', sideArt);
  const tuckedArt = sideArt && state.dockAmount > 0;
  // Out, then in: each direction has exactly one visible representation.
  const wasTucked = character.classList.contains('art-tucked');
  character.classList.toggle('art-tucked', tuckedArt);
  if (wasTucked !== tuckedArt) character.dataset.peekTransition = tuckedArt ? 'docking' : 'undocking';
  character.style.setProperty('--body-slide', sideArt && tuckedArt ? `${state.edge === 'right' ? state.pet.width : -state.pet.width}px` : '0px');
  paintPeek();
  character.classList.toggle('docked-rest', state.dockAmount === 1);
  character.classList.toggle('sleeping', state.mood === 'sleeping');
  character.classList.toggle('peeking', state.dockAmount > 0 && state.dockAmount < 1);
  root.dataset.mood = state.mood; root.dataset.edge = state.edge ?? ''; root.dataset.dockAmount = String(state.dockAmount);
  const moodChanged = animationState !== state.mood || lastEpoch !== state.moodEpoch;
  if (moodChanged) {
    lastEpoch = state.moodEpoch;
    const old = root.querySelector<HTMLElement>('#sprite-old')!, sprite = root.querySelector<HTMLElement>('#sprite')!;
    old.style.cssText = sprite.style.cssText; old.style.opacity = state.dockAmount === 1 ? '0' : '1'; sprite.style.opacity = motion.matches || state.dockAmount === 1 ? '1' : '0';
    animationState = state.mood; animationStart = performance.now(); frame = 0; paintSprite(); leaveClip();
    requestAnimationFrame(() => { old.style.opacity = '0'; sprite.style.opacity = '1'; });
  }
  const image = state.dockAmount !== 1 && state.mood === 'sleeping' && state.sleeping ? state.sleeping.imageUrl : state.imageUrl;
  if (image !== lastImage) {
    lastImage = image; alpha = null; const source = spriteImage = new Image();
    source.onload = () => { if (spriteImage !== source) return; canvas.width = source.width; canvas.height = source.height; context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(source, 0, 0); alpha = context.getImageData(0, 0, source.width, source.height).data; };
    source.src = image;
  }
  const hold = !!state.clips && !!state.edge && state.dockAmount > 0;
  if (hold !== dockClipHeld) { dockClipHeld = hold; if (!moodChanged) playClips(); }
  paintSprite(); videoPlayer?.invalidate();
}
// A pack's clips replace the atlas for the states they cover; any other state, or a clip that
// fails to decode, draws from the atlas. Sheets are decoded when needed and few are kept.
const CLIP_CACHE = 6, ONE_SHOT = ['failed', 'waving', 'jumping', 'poked', 'landing'], LEAVE_MS = 600;
const clipCache = new Map<string, Promise<ImageBitmap | null>>();
let clipSequence: ClipSequencer | null = null;
let clipPlayer: { clip: PetClip; bitmap: ImageBitmap; start: number; drawn: number; leaving?: { from: number; to: number; start: number; ms: number } } | null = null, clipToken = 0, clipPack = '';
function decodeClip(path: string): Promise<ImageBitmap | null> {
  return bridge.clip(path).then(bytes => bytes ? createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/webp' })) : null).catch(() => null);
}
function loadClip(path: string): Promise<ImageBitmap | null> {
  let loading = clipCache.get(path);
  if (!loading) {
    loading = decodeClip(path);
    clipCache.set(path, loading);
    if (clipCache.size > CLIP_CACHE) { const [oldest, entry] = clipCache.entries().next().value!; clipCache.delete(oldest); void entry.then(bitmap => { if (clipPlayer?.bitmap !== bitmap) bitmap?.close(); }); }
  }
  return loading;
}
let videoPlayer: VideoClipPlayer | null = null;
function videoCanvas(video: HTMLVideoElement): void {
  const c = root.querySelector<HTMLCanvasElement>('#clip'); if (!c || !state) return;
  const w = Math.round(state.pet.width * devicePixelRatio), h = Math.round(state.pet.height * devicePixelRatio);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  clipContext ??= c.getContext('2d', { willReadFrequently: true }); if (!clipContext) return;
  c.dataset.clipPath = videoPlayer?.path ?? ''; c.dataset.renderMode = dockRestClip() ? 'dock-rest' : 'playing';
  c.dataset.mediaSource = video.src; c.dataset.mediaFrame = String(Math.floor(video.currentTime * (state.clips?.format.fps ?? 24) + .001));
  clipContext.globalCompositeOperation = 'copy'; clipContext.imageSmoothingQuality = 'high'; const frame = new VideoFrame(video);
  try { clipContext.drawImage(frame, 0, 0, w, h); } finally { frame.close(); }
  updateHit();
}
function dockRestClip(): PetClip | null {
  if (!state?.clips || !state.edge || state.dockAmount <= 0) return null;
  return state.clips.states.idle?.find(c => !c.role) ?? state.clips.states[animationState]?.find(c => !c.role) ?? Object.values(state.clips.states).flat().find(c => !c?.role) ?? null;
}
function playClips(): void {
  const token = ++clipToken;
  clipSequence ??= state?.clips ? new ClipSequencer(state.clips.states) : null;
  const docked = dockRestClip();
  const clip = docked ?? (!clipSequence ? null : motion.matches ? clipSequence.still(animationState) : clipSequence.next(animationState, Date.now()));
  if (!clip) { videoPlayer?.dispose(); clipPlayer = null; root.querySelector('#character')?.classList.remove('clips'); return; }
  if (state?.clips?.format.mediaType === 'webm-vp9-alpha') {
    videoPlayer ??= new VideoClipPlayer(path => state?.clips?.urls?.[path] ?? '', video => { root.querySelector('#character')?.classList.add('clips'); videoCanvas(video); }, () => { if (!ONE_SHOT.includes(animationState) || videoPlayer?.role) playClips(); }, () => { root.querySelector('#character')?.classList.remove('clips'); paintSprite(); });
    void videoPlayer.play(clip, state.clips.format.fps, motion.matches || !!docked).then(() => {
      if (token !== clipToken) return;
      const next = docked ? null : clipSequence?.upcoming(animationState); videoPlayer?.preload(next ?? null);
    });
    return;
  }
  // Keep showing the current frame until the next clip is ready, so nothing ever blanks.
  void loadClip(clip.path).then(bitmap => {
    if (token !== clipToken) return;
    if (!bitmap) { clipPlayer = null; root.querySelector('#character')?.classList.remove('clips'); paintSprite(); return; }
    clipPlayer = { clip, bitmap, start: performance.now(), drawn: -1 };
    if (docked) { clipPlayer.drawn = 0; drawClip(0); }
    root.querySelector('#character')?.classList.add('clips');
    const next = clipSequence?.upcoming(animationState); if (next && next !== clip) void loadClip(next.path);
  });
}
// Every clip starts and ends on the state's resting pose, so a change of state hurries the current
// clip to the nearer end instead of cutting away from the middle of a movement. An intro has to
// reach its end, because what follows starts there, and an outro simply finishes.
function leaveClip(): void {
  if (dockRestClip()) { playClips(); return; }
  const format = state?.clips?.format;
  if (format?.mediaType && videoPlayer?.playing && !motion.matches) { videoPlayer.leave(); return; }
  if (!clipPlayer || !format || motion.matches || !state?.clips?.states[animationState]) { playClips(); return; }
  const { clip, drawn } = clipPlayer;
  if (clip.role === 'outro' || clipPlayer.leaving) return;
  const last = clip.frames - 1, to = clip.role === 'intro' || last - drawn <= drawn ? last : 0, distance = Math.abs(to - drawn);
  if (drawn < 0 || distance <= 1) { playClips(); return; }
  clipPlayer.leaving = { from: drawn, to, start: performance.now(), ms: Math.min(LEAVE_MS, distance / (format.fps * 3) * 1000) };
}
// Talking uses the closed/rest frame as a stable body. A fixed face box cannot align
// arbitrary bent/lying poses (paint_face only searches ±8 px), so use the documented
// rest-pose fallback rather than painting a detached face over those poses.
const faceCanvas = document.createElement('canvas'), faceMask = document.createElement('canvas'), talkBase = document.createElement('canvas');
let talkBaseKey = '';
let talkBitmap: ImageBitmap | null = null, talkLoading = '', talkFrame = -1;
function paintTalk(now: number): void {
  const element = root.querySelector<HTMLCanvasElement>('#talk'), character = root.querySelector('#character');
  const talk = state?.talk, format = state?.clips?.format, box = state?.faceBox;
  if (!element) return;
  const level = speechMouth(now); element.dataset.level = String(level);
  if (!talk || !format || !box || !speechPlaying()) {
    element.style.display = 'none'; talkFrame = -1; character?.classList.remove('talking'); return;
  }
  const key = `${clipPack}:${talk.path}`;
  if (talkLoading !== key) {
    talkLoading = key; talkBitmap = null;
    void decodeClip(talk.path).then(bitmap => { if (talkLoading === key) talkBitmap = bitmap; else bitmap?.close(); });
  }
  if (!talkBitmap) return;
  character?.classList.add('talking');
  const index = level === 2 && talk.frames > 3 ? 2 + Math.floor(now / 180) % (talk.frames - 2) : level;
  if (index === talkFrame && element.width === Math.round(state!.pet.width * devicePixelRatio) && element.height === Math.round(state!.pet.height * devicePixelRatio)) { element.style.display = ''; return; }
  const { width, height, columns } = format;
  faceCanvas.width = faceMask.width = width;
  faceCanvas.height = faceMask.height = height;
  element.width = Math.round(state!.pet.width * devicePixelRatio);
  element.height = Math.round(state!.pet.height * devicePixelRatio);
  const work = faceCanvas.getContext('2d')!, mask = faceMask.getContext('2d')!;
  const x0 = Math.floor(box[0] * width), y0 = Math.floor(box[1] * height), x1 = Math.floor(box[2] * width), y1 = Math.floor(box[3] * height);
  work.drawImage(talkBitmap, index % columns * width, Math.floor(index / columns) * height, width, height, 0, 0, width, height);
  mask.filter = `blur(${(y1 - y0) / 8}px)`; mask.fillRect(x0, y0, x1 - x0, y1 - y0);
  work.globalCompositeOperation = 'destination-in'; work.drawImage(faceMask, 0, 0); work.globalCompositeOperation = 'source-over';
  const context = element.getContext('2d', { willReadFrequently: true })!;
  const baseKey = `${key}:${element.width}:${element.height}`;
  if (baseKey !== talkBaseKey) {
    talkBaseKey = baseKey; talkBase.width = element.width; talkBase.height = element.height;
    const base = talkBase.getContext('2d', { willReadFrequently: true })!; base.imageSmoothingQuality = 'high';
    base.drawImage(talkBitmap, 0, 0, width, height, 0, 0, element.width, element.height);
  }
  context.imageSmoothingQuality = 'high';
  context.drawImage(talkBase, 0, 0);
  context.save(); context.beginPath(); context.rect(0, 0, element.width, Math.min(element.height, Math.ceil((y1 + (y1 - y0) / 2) / height * element.height))); context.clip();
  context.drawImage(faceCanvas, 0, 0, element.width, element.height); context.restore();
  element.style.display = ''; talkFrame = index; updateHit();
}
let clipContext: CanvasRenderingContext2D | null = null;
function drawClip(index: number): void {
  const element = root.querySelector<HTMLCanvasElement>('#clip'), format = state?.clips?.format;
  if (!element || !format || !clipPlayer || !state) return;
  const scale = window.devicePixelRatio || 1, width = Math.round(state.pet.width * scale), height = Math.round(state.pet.height * scale);
  if (element.width !== width || element.height !== height) { element.width = width; element.height = height; clipContext = null; }
  clipContext ??= element.getContext('2d', { willReadFrequently: true });
  if (!clipContext) return;
  element.dataset.clipPath = clipPlayer.clip.path; element.dataset.mediaFrame = String(index); element.dataset.renderMode = dockRestClip() ? 'dock-rest' : 'playing';
  clipContext.clearRect(0, 0, width, height); clipContext.imageSmoothingQuality = 'high';
  clipContext.drawImage(clipPlayer.bitmap, (index % format.columns) * format.width, Math.floor(index / format.columns) * format.height, format.width, format.height, 0, 0, width, height);
}
function stepClip(now: number): void {
  if (state?.clips?.format.mediaType) { videoPlayer?.tick(now, state.clips.format.fps, motion.matches || !!dockRestClip()); return; }
  if (!clipPlayer || !state?.clips) return;
  const format = state.clips.format, { clip } = clipPlayer;
  if (dockRestClip()) { if (clipPlayer.drawn !== 0) { clipPlayer.drawn = 0; drawClip(0); updateHit(); } return; }
  const { leaving } = clipPlayer;
  if (leaving) {
    const amount = Math.min(1, (now - leaving.start) / leaving.ms), index = Math.round(leaving.from + (leaving.to - leaving.from) * amount);
    if (index !== clipPlayer.drawn) { clipPlayer.drawn = index; drawClip(index); updateHit(); }
    if (amount >= 1) { const player = clipPlayer; clipPlayer = { clip: player.clip, bitmap: player.bitmap, drawn: player.drawn, start: Infinity }; playClips(); }
    return;
  }
  let index = motion.matches ? 0 : Math.floor((now - clipPlayer.start) / 1000 * format.fps);
  if (index >= clip.frames) {
    index = clip.frames - 1;
    // Clips start and end on the same pose, so the next one follows without a jump.
    if (clip.role || !ONE_SHOT.includes(animationState)) { const player = clipPlayer; clipPlayer = { ...player, start: Infinity, drawn: player.drawn }; playClips(); }
  }
  if (index !== clipPlayer.drawn && index >= 0) { clipPlayer.drawn = index; drawClip(index); updateHit(); }
}
function paintSprite(): void {
  const sprite = root.querySelector<HTMLElement>('#sprite'); if (!sprite || !state) return;
  const docked = state.dockAmount === 1;
  const sleeping = !docked && animationState === 'sleeping' ? state.sleeping : undefined;
  sprite.style.backgroundImage = `url("${sleeping?.imageUrl ?? state.imageUrl}")`;
  sprite.style.backgroundSize = `${state.pet.width * (sleeping?.frames ?? 8)}px ${state.pet.height * (sleeping ? 1 : state.atlasRows)}px`;
  sprite.style.backgroundPosition = `${-(docked ? 0 : frame) * state.pet.width}px ${sleeping || docked ? 0 : -ANIMATIONS[animationState].row * state.pet.height}px`;
}
function opaqueAt(point: { clientX: number; clientY: number }): boolean {
  if (!state || !(alpha || clipPlayer || videoPlayer?.playing)) return false;
  if (state.peekArt && state.dockAmount > 0 && (state.edge === 'left' || state.edge === 'right')) {
    const c = root.querySelector<HTMLCanvasElement>('#peek-art');
    const x = Math.floor(point.clientX * devicePixelRatio), y = Math.floor(point.clientY * devicePixelRatio);
    return !!c && x >= 0 && y >= 0 && x < c.width && y < c.height && c.getContext('2d')!.getImageData(x, y, 1, 1).data[3]! > 24;
  }
  const character = root.querySelector<HTMLElement>('#character'); if (!character) return false;
  const [centerX, centerY] = getComputedStyle(character).transformOrigin.split(' ').map(Number.parseFloat);
  const matrix = new DOMMatrix(getComputedStyle(character).transform).inverse();
  const pointInBody = new DOMPoint(point.clientX - centerX, point.clientY - centerY).matrixTransform(matrix);
  const x = Math.floor((pointInBody.x + centerX) / state.pet.width * 192);
  const y = Math.floor((pointInBody.y + centerY) / state.pet.height * 208);
  if (x < 0 || x >= 192 || y < 0 || y >= 208) return false;
  const clip = dockedPose(state.pet.width, state.pet.height, state.edge, state.dockAmount, state.faceBox).clip;
  const localX = x / 192 * state.pet.width, localY = y / 208 * state.pet.height;
  if (clip && (localX < clip.x || localX > clip.x + clip.width || localY < clip.y || localY > clip.y + clip.height)) return false;
  const bottom = clip ? clip.y + clip.height : state.pet.height;
  const feather = state.dockAmount > 0 ? Math.min(1, Math.max(0, (bottom - localY) / 12)) : 1;
  if (feather === 0) return false;
  const threshold = 24 / feather;
  const talk = root.querySelector<HTMLCanvasElement>('#talk');
  if (character.classList.contains('talking') && talk) return talk.getContext('2d')!.getImageData(Math.floor(x / 192 * talk.width), Math.floor(y / 208 * talk.height), 1, 1).data[3]! > threshold;
  if ((clipPlayer || videoPlayer?.playing) && clipContext) { const element = clipContext.canvas; return clipContext.getImageData(Math.floor(x / 192 * element.width), Math.floor(y / 208 * element.height), 1, 1).data[3]! > threshold; }
  if (!alpha) return false;
  const row = state.dockAmount === 1 || animationState === 'sleeping' && state.sleeping ? 0 : ANIMATIONS[animationState].row;
  return alpha[((row * 208 + y) * (spriteImage?.width ?? 1536) + (state.dockAmount === 1 ? 0 : frame) * 192 + x) * 4 + 3] > threshold;
}
function updateHit(): void { const next = !!drag || !!lastPointer && opaqueAt(lastPointer); if (next !== hit) { hit = next; bridge.hitTest(hit); } }
window.addEventListener('pointermove', event => {
  if (scrollDrag) { scrollToPointer(event.clientY); return; }
  if (state?.surface !== 'sprite') return;
  lastPointer = { clientX: event.clientX, clientY: event.clientY }; updateHit();
  if (drag) { if (Math.hypot(event.screenX - drag.x, event.screenY - drag.y) >= 4) drag.moved = true; if (drag.moved) void bridge.action({ type: 'dragMove', x: event.screenX, y: event.screenY }); }
});
root.addEventListener('pointerdown', event => {
  const track = (event.target as HTMLElement).closest<HTMLElement>('.scroll-track');
  if (track) { const thumb = track.querySelector<HTMLElement>('.scroll-thumb')!; scrollDrag = { id: event.pointerId, grab: (event.target as HTMLElement).closest('.scroll-thumb') ? event.clientY - thumb.getBoundingClientRect().top : thumb.offsetHeight / 2 }; root.setPointerCapture(event.pointerId); event.preventDefault(); scrollToPointer(event.clientY); return; }
  if (state?.surface !== 'sprite' || !opaqueAt(event)) return;
  event.preventDefault(); drag = { id: event.pointerId, x: event.screenX, y: event.screenY, moved: false }; root.setPointerCapture(event.pointerId); root.querySelector('#character')?.classList.add('dragging'); void bridge.action({ type: 'dragStart', x: event.screenX, y: event.screenY });
});
function release(event: PointerEvent, cancelled = false): void {
  if (scrollDrag) { if (root.hasPointerCapture(scrollDrag.id)) root.releasePointerCapture(scrollDrag.id); scrollDrag = null; return; }
  if (!drag) return;
  const clicked = !drag.moved && !cancelled; if (root.hasPointerCapture(drag.id)) root.releasePointerCapture(drag.id); drag = null; root.querySelector('#character')?.classList.remove('dragging');
  void bridge.action({ type: 'dragEnd', x: event.screenX, y: event.screenY }); if (clicked) void bridge.action({ type: 'click' });
}
root.addEventListener('pointerup', event => release(event)); root.addEventListener('pointercancel', event => release(event, true));
window.addEventListener('pointerleave', () => { lastPointer = null; updateHit(); });
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); void bridge.action({ type: 'close' }); return; }
  if (!state) return;
  if (state.surface === 'sprite' && ['Enter', ' '].includes(event.key)) { event.preventDefault(); void bridge.action({ type: 'click' }); }
  if (state.mode === 'menu' && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    const items = [...root.querySelectorAll<HTMLElement>('[role^="menuitem"]')], index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    event.preventDefault(); items[next]?.focus();
  }
  if ((event.target as HTMLElement).closest('button')) return;
  const row = (event.target as HTMLElement).closest<HTMLElement>('.task-row,.request-row');
  if (row && ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(event.key)) {
    event.preventDefault(); const rows = [...root.querySelectorAll<HTMLElement>('.task-row,.request-row')], index = rows.indexOf(row), next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : event.key === 'Enter' ? index : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    const destination = rows[next]; if (!destination) return;
    const key = destination.dataset.key, request = destination.classList.contains('request-row'); selectActivityRow(destination);
    root.querySelector<HTMLElement>(`.${request ? 'request-row' : 'task-row'}[data-key="${CSS.escape(key ?? '')}"]`)?.focus();
  }
});
bridge.onCue(cue => {
  if (state?.surface !== 'sprite') return;
  void playSound(cue.sound).then(audio => { root.dataset.lastCue = `${cue.sound}:${audio}`; });
});
bridge.onSpeech(audio => {
  if (state?.surface !== 'sprite') return;
  void playSpeech(audio).then(() => { root.dataset.lastSpeech = String(audio.byteLength); }, () => { root.dataset.lastSpeech = 'undecodable'; });
});
bridge.onState(next => {
  const old = state, changedMode = old?.mode !== next.mode;
  if (old && old.accountId !== next.accountId) { failures.clear(); pending.clear(); draft = ''; sendState = 'idle'; selected = null; selectedRequest = null; collapsedRequests.clear(); }
  state = next; document.documentElement.dataset.glassFallback = String(!!next.glassFallback); setLocale(next.locale); applyAppearance(next.appearance); document.title = `Pockymoe · ${t('桌宠')}`; root.setAttribute('aria-label', document.title);
  const accent = next.appearance.accent; canvas.width = 1; canvas.height = 1; context.clearRect(0, 0, 1, 1); context.fillStyle = accent; context.fillRect(0, 0, 1, 1); const [r, g, b] = context.getImageData(0, 0, 1, 1).data; document.documentElement.style.setProperty('--accent-fg', accentForeground(r, g, b));
  document.body.dataset.surface = next.surface; root.dataset.visible = String(next.near || next.mode !== 'controls');
  if (next.surface === 'sprite') {
    // Another pack's sheets share nothing with this one's.
    const packKey = `${next.packName}#${next.clips?.epoch ?? 0}`;
    if (packKey !== clipPack) { videoPlayer?.dispose(); videoPlayer = null; clipContext = null; peekSource = null; talkBaseKey = ''; talkBitmap?.close(); talkLoading = ''; talkBitmap = null; talkFrame = -1; clipPack = packKey; for (const entry of clipCache.values()) void entry.then(bitmap => bitmap?.close()); clipCache.clear(); dockClipHeld = false; clipSequence = null; clipPlayer = null; clipToken++; lastEpoch = -1; }
    renderSprite(); updateHit(); return;
  }
  if (old?.detailOpen && !next.detailOpen) root.querySelector<HTMLButtonElement>('.error-mark[aria-expanded="true"]')?.click();
  if (changedMode && next.mode === 'panel') { selected = next.targetKey; selectedRequest = null; collapsedRequests.clear(); }
  const contentKey = JSON.stringify([next.accountId, next.items, next.recent, next.mode, next.pinned, next.mode === 'bubble' && next.near, next.bubble, next.settings, next.locale, next.appearance, next.edgeHide]);
  if (signature !== contentKey) { signature = contentKey; renderGlass(); }
  if (changedMode && next.mode === 'menu') root.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
});
function animate(now: number): void {
  if (state?.surface === 'sprite') { stepClip(now); paintTalk(now); }
  if (state?.surface === 'sprite' && !clipPlayer && !videoPlayer?.playing) {
    const elapsedMs = now - animationStart, idleTime = elapsedMs % 46000;
    const cycle = animationState === 'idle' ? idleTime >= 31000 ? idleTime - 31000 : idleTime >= 14000 ? idleTime - 14000 : idleTime : elapsedMs;
    let next = frameAt(animationState, animationState === 'idle' && cycle > 1100 * state.frameScale ? 0 : cycle, motion.matches, state.frameScale, ONE_SHOT.includes(animationState));
    if (animationState === 'sleeping' && state.sleeping && !motion.matches) { const durations = state.sleeping.durationsMs; let remaining = elapsedMs / state.frameScale % durations.reduce((a, b) => a + b, 0); next = 0; while (remaining >= durations[next] && next < durations.length - 1) { remaining -= durations[next]; next++; } }
    if (frame !== next) { frame = next; paintSprite(); updateHit(); }
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
function updateScrollArea(): void {
  const area = root.querySelector<HTMLElement>('[data-scroll-area]'), content = area?.querySelector<HTMLElement>('.scroll-content'), track = area?.querySelector<HTMLElement>('.scroll-track'), thumb = area?.querySelector<HTMLElement>('.scroll-thumb');
  if (!area || !content || !track || !thumb) return;
  const geometry = scrollGeometry(content.clientHeight, content.scrollHeight, content.scrollTop, area.clientHeight - 8);
  area.dataset.overflowTop = String(!geometry.atStart); area.dataset.overflowBottom = String(!geometry.atEnd); track.hidden = !geometry.overflowing;
  track.setAttribute('aria-valuemax', String(Math.round(geometry.maximum))); track.setAttribute('aria-valuenow', String(Math.round(geometry.offset))); thumb.style.height = `${geometry.thumbSize}px`; thumb.style.transform = `translateY(${geometry.thumbOffset}px)`;
}
function scrollToPointer(y: number): void {
  const list = root.querySelector<HTMLElement>('.task-list'), track = root.querySelector<HTMLElement>('.scroll-track'), thumb = root.querySelector<HTMLElement>('.scroll-thumb');
  if (!list || !track || !thumb || !scrollDrag) return;
  list.scrollTop = (y - track.getBoundingClientRect().top - scrollDrag.grab) / Math.max(1, track.clientHeight - thumb.offsetHeight) * (list.scrollHeight - list.clientHeight); updateScrollArea();
}
root.addEventListener('scroll', updateScrollArea, true);
root.addEventListener('keydown', event => { if (!(event.target as HTMLElement).closest('.scroll-track')) return; const list = root.querySelector<HTMLElement>('.task-list'); if (!list) return; const delta = event.key === 'ArrowDown' ? 30 : event.key === 'ArrowUp' ? -30 : event.key === 'PageDown' ? list.clientHeight : event.key === 'PageUp' ? -list.clientHeight : 0; if (delta || ['Home', 'End'].includes(event.key)) { event.preventDefault(); list.scrollTop = event.key === 'Home' ? 0 : event.key === 'End' ? list.scrollHeight : list.scrollTop + delta; updateScrollArea(); } });

bridge.ready(); void bridge.action({ type: 'reducedMotion', value: motion.matches });
motion.addEventListener('change', () => { void bridge.action({ type: 'reducedMotion', value: motion.matches }); frame = 0; paintSprite(); });

// ErrorMark's shared popup gets additional room in the same glass child, never in the sprite window.
let detailAnnounced = false;
new MutationObserver(() => {
  if (state?.surface !== 'glass') return;
  const popup = document.querySelector<HTMLElement>('.error-popover'), anchor = document.querySelector<HTMLElement>('.error-mark[aria-expanded="true"]');
  if (detailAnnounced !== !!popup) { detailAnnounced = !!popup; void bridge.action({ type: 'detail', value: detailAnnounced }); }
  const summary = root.querySelector<HTMLElement>('.bubble-full-text');
  const base = root.offsetHeight - (parseFloat(root.style.paddingBottom) || 0);
  if (summary) summary.style.top = `${base}px`;
  const extra = popup && anchor ? Math.max(0, Math.ceil(anchor.getBoundingClientRect().bottom + 14 + popup.offsetHeight - base)) : 0;
  const space = Math.max(extra, summary ? summary.offsetHeight : 0);
  const padding = space ? `${space}px` : '';
  if (root.style.paddingBottom !== padding) { root.style.paddingBottom = padding; requestAnimationFrame(measure); }
}).observe(document.body, { childList: true, subtree: true });
