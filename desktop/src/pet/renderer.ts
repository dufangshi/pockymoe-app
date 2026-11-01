import './styles.css';
import lucideNotice from './NOTICE?raw';
// Preserve the copied Web rail icon's licence in the distributed renderer.
document.head.append(document.createComment(lucideNotice));
import { ANIMATIONS, frameAt, type SpriteState } from './animation';
import { activityStatus, statusMarkStyles, statusMarkSvg, type StatusMark } from '../shared/statusMarks';
import { applyAppearance } from '../shared/appearance';
import { accentForeground, bubbleOutline, escapeHtml, requestSummaryHtml } from './presentation';
import { scrollGeometry } from './scroll';
import type { ActivityItem } from '../shared/contract';
import type { PetAction, PetBridge, PetViewState } from './bridge';
const bridge = (window as unknown as { rcDesktop: { pet: PetBridge } }).rcDesktop.pet;
const root = document.querySelector<HTMLElement>('#app')!;
const markStyle = document.createElement('style'); markStyle.textContent = statusMarkStyles; document.head.append(markStyle);
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let state: PetViewState | null = null, menu = false, near = false, review = false, hit = false;
let actionError = '';
let draft = '', sendState: 'idle' | 'sending' | 'sent' | 'error' = 'idle', sendError = '';
let scrollDrag: { id: number; grab: number } | null = null;
let drag: { id: number; x: number; y: number; moved: boolean } | null = null;
let animationState: SpriteState = 'idle', animationStart = performance.now(), frame = 0, spriteImage: HTMLImageElement | null = null;
let lastMeasure = '';
let lastPointer: { clientX: number; clientY: number } | null = null;
let alpha: Uint8ClampedArray | null = null, lastImage = '', lastSound = 0, lastBubble = '';
let lastAccent = '';
const accentCanvas = document.createElement('canvas'); accentCanvas.width = 1; accentCanvas.height = 1;
const accentContext = accentCanvas.getContext('2d', { willReadFrequently: true })!;
const canvas = document.createElement('canvas'), context = canvas.getContext('2d', { willReadFrequently: true })!;
const text = (zh: string, en: string): string => state?.locale.startsWith('zh') ? zh : en;
const escape = escapeHtml;
const paths: Record<string, string> = { chat: '<path d="M3 3.5h10v7H7l-4 3z"/>', tasks: '<rect x="3" y="2.5" width="10" height="11" rx="2"/><path d="M6 6h4M6 9h4"/>', home: '<path d="m2 7 6-5 6 5M4 6v8h8V6M7 14v-4h2v4"/>', more: '<circle cx="3" cy="8" r=".6"/><circle cx="8" cy="8" r=".6"/><circle cx="13" cy="8" r=".6"/>', close: '<path d="m5 5 6 6M11 5l-6 6"/>', send: '<path d="M8 13V3m-4 4 4-4 4 4"/>', check: '<path d="m3 8 3 3 7-7"/>', map: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>', moon: '<path d="M12.5 10A5 5 0 0 1 6 3a5 5 0 1 0 6.5 7Z"/>' };
// LayoutDashboard matches the Web rail in DesktopShell/MatterWorkbench (Lucide, ISC; see NOTICE).
const icon = (name: string): string => `<svg viewBox="${name === 'map' ? '0 0 24 24' : '0 0 16 16'}" ${name === 'map' ? 'class="map-icon" data-icon="thread-map"' : ''} aria-hidden="true">${paths[name] ?? paths.tasks}</svg>`;
function requestHeading(item: ActivityItem): string { return item.request?.kind === 'approval' ? text('需要你批准', 'Approval needed') : text('需要你回答', 'Answer needed'); }
function status(item: ActivityItem): string {
  const kind = activityStatus(item);
  const labels: Record<StatusMark, [string, string]> = { running: ['运行中', 'Running'], unread: ['已完成，未读', 'Completed, unread'], failed: ['失败', 'Failed'], interrupted: ['已中断', 'Interrupted'], waiting: ['等待你', 'Waiting for you'], idle: ['已读，空闲', 'Read, idle'], 'agents-running': ['智能体线程运行中', 'Agents running'], unknown: ['状态未知', 'Unknown status'] };
  return statusMarkSvg(kind, text(...labels[kind]));
}
function elapsed(milliseconds: number): string { const seconds = Math.floor(Math.max(0, milliseconds) / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function button(action: string, label: string, body = escape(label), extra = ''): string { return `<button type="button" data-action="${action}" aria-label="${escape(label)}" title="${escape(label)}" ${extra}>${body}</button>`; }
function taskCard(item: ActivityItem): string {
  const waiting = item.state === 'needsInput';
  const approval = waiting && item.request?.kind === 'approval';
  const actions = (approval ? button('approve', text('批准', 'Approve'), undefined, 'class="primary"') + button('deny', text('拒绝', 'Deny')) : '')
    + button('open', text('打开', 'Open')) + (item.state === 'completed' || item.request?.kind === 'input' ? button('target', text('回复', 'Reply')) : '') + button('revealInMap', text('在地图中显示', 'Show in map'), icon('map'), 'class="map-action"');
  const title = `<div class="task-title">${waiting ? '' : status(item)}<strong title="${escape(item.title)}">${escape(item.title)}</strong>${item.state === 'running' ? `<span class="timer" data-since="${escape(item.since)}">${elapsed(Date.now() - Date.parse(item.since))}</span>` : ''}</div>`;
  const summary = item.request?.summary ?? item.resultSummary;
  const summaryHtml = summary ? `<div class="summary ${waiting ? 'request-summary' : ''}" title="${escape(summary)}">${waiting ? requestSummaryHtml(summary) : escape(summary)}</div>` : '';
  const meta = `<div class="meta" title="${escape(item.deviceName + ' · ' + item.workspaceLabel)}">${escape(item.deviceName)} · ${escape(item.workspaceLabel)}</div>`;
  return `<article class="task ${waiting ? 'waiting' : ''}" data-key="${escape(item.key)}">${waiting ? `<div class="request-kicker">${status(item)}${escape(requestHeading(item))}</div>` : ''}${title}${waiting ? summaryHtml + meta : meta + summaryHtml}<div class="actions">${actions}</div></article>`;
}
function bubbleText(): string {
  const events = state?.bubble?.events ?? [], event = events[events.length - 1];
  if (!event) return '';
  if (events.length > 1) return text(`${events.length} 个任务完成`, `${events.length} tasks completed`);
  const item = event.item;
  if (event.type === 'needsInput') return `${requestHeading(item)}\n${item.title}\n${item.request?.summary ?? ''}`;
  if (event.type === 'failed') return `${item.title} · ${item.resultSummary || text('遇到了一点问题', 'Something went wrong')}`;
  return `${item.title} ${text('完成了', 'completed')}${item.durationMs ? ` · ${elapsed(item.durationMs)}` : ''}`;
}
function render(): void {
  if (!state) return;
  const savedScroll = document.querySelector<HTMLElement>('.task-list')?.scrollTop ?? 0;
  const focusedElement = document.activeElement as HTMLElement | null;
  const focusedMenuAction = focusedElement?.closest('.more') ? focusedElement.dataset.action : null;
  const focused = document.activeElement?.id, selection = focused === 'reply-input' ? (document.activeElement as HTMLInputElement).selectionStart : null;
  const pet = state.pet, controlsWidth = 252;
  const cx = Math.max(12, Math.min(innerWidth - controlsWidth - 12, pet.x + pet.width / 2 - controlsWidth / 2));
  const controlBelow = pet.y + pet.height + 42 < innerHeight;
  const cy = Math.max(12, Math.min(innerHeight - 48, state.settings.petMini ? Math.min(innerHeight - 48, pet.y) : controlBelow ? pet.y + pet.height + 4 : pet.y - 40));
  const stackTop = state.panelAbove ? 16 : Math.min(innerHeight - 100, (state.settings.petMini ? cy + 48 : pet.y + pet.height + (controlBelow ? 48 : 12)));
  const stackBottom = state.panelAbove ? Math.max(12, innerHeight - (controlBelow ? pet.y - 10 : cy - 12)) : 12;
  const groups: [string, ActivityItem[]][] = [ [text('需要你', 'Needs you'), state.items.filter((i) => i.state === 'needsInput' || i.state === 'failed' || i.state === 'interrupted')], [text('进行中', 'Running'), state.items.filter((i) => i.state === 'running')], [text('刚完成', 'Just finished'), state.items.filter((i) => i.state === 'completed')] ];
  const bubble = state.bubble;
  const bubbleItem = bubble?.events.at(-1)?.item;
  const bubbleApproval = bubbleItem?.state === 'needsInput' && bubbleItem.request?.kind === 'approval';
  const target = state.targets.find((item) => item.key === state!.targetKey) ?? state.targets[0];
  const tilt = state.edge ? (state.edge === 'left' || state.edge === 'bottom' ? 12 : -12) * state.dockAmount : 0;
  root.className = state.settings.petMini ? 'mini' : '';
  root.dataset.dockEdge = state.edge ?? ''; root.dataset.dockAmount = String(state.dockAmount);
  root.innerHTML = `${!state.settings.petMini ? `<div id="character" role="button" tabindex="0" aria-label="${escape(text('桌宠，点击查看任务，拖动以移动', 'Pet: click for tasks, drag to move'))}" class="${drag?.moved ? 'dragging' : ''} ${state.mood === 'sleeping' ? 'sleeping' : ''}" style="left:${pet.x}px;top:${pet.y}px;width:${pet.width}px;height:${pet.height}px;transform:rotate(${tilt}deg)"><div id="sprite"></div>${state.mood === 'sleeping' ? '<svg class="sleep-motes" viewBox="0 0 36 48" aria-hidden="true"><path d="M7 34h6l-6 6h6"/><path d="M17 24h7l-7 7h7"/><path d="M23 13h5l-5 5h5"/></svg>' : ''}</div>` : ''}
    <nav class="controls surface ${near || menu || state.tray || state.chat ? 'visible' : ''}" aria-label="${escape(text('桌宠控制', 'Pet controls'))}" style="left:${cx}px;top:${cy}px;width:${controlsWidth}px">${button('toggleChat', text('聊天', 'Chat'), icon('chat') + escape(text('聊天', 'Chat')), `aria-pressed="${state.chat}"`)}${button('toggleTray', text('任务', 'Tasks'), icon('tasks') + escape(text('任务', 'Tasks')) + `<span class="task-count">${state.items.length || ''}</span>`, `aria-pressed="${state.tray}"`)}${button('openMain', text('打开主窗口', 'Open main window'), icon('home'), 'class="icon-only"')}${button('more', text('更多', 'More'), icon('more'), `class="icon-only" id="pet-more-trigger" aria-haspopup="menu" aria-expanded="${menu}"`)}</nav>
    <div class="stack ${state.panelAbove ? 'above' : 'below'}" style="top:${stackTop}px;bottom:${stackBottom}px;${state.panelAbove ? 'justify-content:flex-end' : ''}">
    ${state.error || actionError ? `<div class="surface error-banner" role="alert">${escape(state.error || actionError)}</div>` : ''}
    ${state.tray ? `<section class="tray surface" aria-label="${escape(text('活动任务', 'Activity'))}" style="max-height:${state.panelHeight}px"><header class="tray-header"><span class="tray-title">${escape(text('活动', 'Activity'))}</span><span class="tray-subtitle">${escape(text('跨设备 · 跨工作区', 'Across your workspaces'))}</span>${button('toggleTray', text('关闭任务', 'Close tasks'), icon('close'), 'class="close"')}</header><div class="scroll-frame" data-scroll-area><div class="task-list scroll-content" id="pet-task-list">${state.items.length ? groups.filter(([, list]) => list.length).map(([name, list]) => `<div class="group-label">${name}<span>${list.length}</span></div>${list.map(taskCard).join('')}`).join('') : `<div class="empty">${icon('check')}<div>${escape(text('一切就绪，交给我吧', 'All caught up. Ready when you are.'))}</div></div>`}</div><div class="scroll-track" role="scrollbar" aria-label="${escape(text('滚动活动任务', 'Scroll activity'))}" aria-controls="pet-task-list" aria-orientation="vertical" aria-valuemin="0" tabindex="0" hidden><div class="scroll-thumb"></div></div></div></section>` : ''}
    ${bubble ? `<aside class="bubble surface" data-key="${escape(bubbleItem?.key ?? '')}"><svg class="bubble-frame" aria-hidden="true"><path fill="var(--theme-bg)" stroke="var(--theme-border)" stroke-width="1" vector-effect="non-scaling-stroke"/></svg><div class="bubble-kicker">${status(bubble.events[0].item)}${escape(bubble.sticky && bubbleItem ? requestHeading(bubbleItem) : text('任务动态', 'Task update'))}</div>${button('bubbleOpen', bubble.sticky && bubbleItem ? bubbleItem.title : bubbleText(), escape(bubble.sticky && bubbleItem ? bubbleItem.title : bubbleText()), `class="${bubble.sticky ? 'bubble-title' : 'bubble-text'}"`)}${bubble.sticky && bubbleItem?.request?.summary ? `<div class="request-summary" title="${escape(bubbleItem.request.summary)}">${requestSummaryHtml(bubbleItem.request.summary)}</div>` : ''}<div class="bubble-actions">${bubbleApproval ? button('approve', text('批准', 'Approve'), undefined, 'class="primary"') + button('deny', text('拒绝', 'Deny')) : ''}${button('revealInMap', text('在地图中显示', 'Show in map'), icon('map'), 'class="map-action"')}</div>${button('dismiss', text('关闭提醒', 'Dismiss alert'), icon('close'), 'class="close"')}</aside>` : ''}
    ${state.chat ? `<form class="chat surface" id="chat-form"><label class="chat-target">${target ? status(target) : icon('chat')}<select id="target-select" aria-label="${escape(text('回复目标线程', 'Target thread'))}">${state.targets.map((item) => `<option value="${escape(item.key)}" ${item.key === target?.key ? 'selected' : ''}>${escape(item.title)}</option>`).join('')}</select></label><div class="chat-input-row"><input id="reply-input" aria-label="${escape(text('回复', 'Reply'))}" placeholder="${escape(target ? text('继续这个任务…', 'Continue this task…') : text('暂无活动线程', 'No active threads'))}" value="${escape(draft)}" autocomplete="off" maxlength="16000" ${!target || sendState === 'sending' ? 'disabled' : ''}><button class="send" aria-label="${escape(text('发送回复', 'Send reply'))}" ${!target || sendState === 'sending' ? 'disabled' : ''}>${icon(sendState === 'sent' ? 'check' : 'send')}</button></div><div class="chat-status ${sendState === 'error' ? 'error' : ''}" role="status">${escape(sendState === 'sending' ? text('正在发送…', 'Sending…') : sendState === 'sent' ? text('已发送', 'Sent') : sendState === 'error' ? sendError : text('Enter 发送', 'Enter to send'))}</div></form>` : ''}</div>
    ${menu ? `<section class="more surface" role="menu" aria-label="${escape(text('宠物偏好', 'Pet preferences'))}" style="left:${Math.min(innerWidth - 216, Math.max(16, cx + 44))}px;${cy > innerHeight / 2 ? `bottom:${innerHeight - cy + 8}px` : `top:${cy + 44}px`};max-height:${innerHeight - 28}px;overflow:auto">${button('mini', text('Mini 模式', 'Mini mode'), escape(text('Mini 模式', 'Mini mode')) + (state.settings.petMini ? icon('check') : ''))}<div class="more-label">${escape(text('宠物大小', 'Pet size'))}</div><div class="sizes">${(['S', 'M', 'L'] as const).map((size) => button(`size-${size}`, size, size, `class="${state!.settings.petSize === size ? 'selected' : ''}"`)).join('')}</div><label class="more-label" for="pack-select">${escape(text('选择宠物', 'Choose pet'))}</label><select class="pack-select" id="pack-select">${state.packs.map((pack) => `<option value="${escape(pack.id)}" ${pack.id === state!.settings.petId ? 'selected' : ''}>${escape(pack.displayName)}</option>`).join('')}</select>${button('importFolder', text('导入文件夹…', 'Import folder…'))}${button('importZip', text('导入 ZIP…', 'Import ZIP…'))}<hr>${button('sound', text('轻触提示音', 'Soft click sound'), escape(text('轻触提示音', 'Soft click sound')) + (state.settings.petSound ? icon('check') : ''))}${button('preferences', text('偏好设置…', 'Preferences…'))}${button('hide', text('隐藏桌宠', 'Hide pet'))}</section>` : ''}<div class="live-announcement" aria-live="polite">${escape(bubbleText())}</div>`;
  if (focused === 'reply-input' && state.chat) { const input = document.querySelector<HTMLInputElement>('#reply-input'); input?.focus(); if (selection !== null) input?.setSelectionRange(selection, selection); }
  for (const button of root.querySelectorAll('.more button')) button.setAttribute('role', 'menuitem');
  if (menu && focusedMenuAction) root.querySelector<HTMLElement>(`.more [data-action="${focusedMenuAction}"]`)?.focus();
  else if (focused && focused !== 'reply-input') document.getElementById(focused)?.focus();
  const list = document.querySelector<HTMLElement>('.task-list'); if (list) list.scrollTop = savedScroll;
  paintSprite();
  updateBubbleFrame();
  requestAnimationFrame(() => {
    updateBubbleFrame();
    updateScrollArea();
    const list = document.querySelector<HTMLElement>('.task-list'), header = document.querySelector<HTMLElement>('.tray-header');
    const measured = { type: 'measure' as const, tray: list && header ? list.scrollHeight + header.offsetHeight : 0, bubble: document.querySelector<HTMLElement>('.bubble')?.offsetHeight ?? 0, chat: document.querySelector<HTMLElement>('.chat')?.offsetHeight ?? 0 };
    const signature = JSON.stringify(measured);
    if (signature !== lastMeasure) { lastMeasure = signature; void bridge.action(measured); }
  });
}
function paintSprite(): void {
  const sprite = document.querySelector<HTMLElement>('#sprite');
  if (!sprite || !state) return;
  const row = ANIMATIONS[animationState].row;
  const sleeping = animationState === 'sleeping' ? state.sleeping : undefined;
  sprite.style.backgroundImage = `url("${sleeping?.imageUrl ?? state.imageUrl}")`;
  sprite.style.backgroundSize = `${state.pet.width * (sleeping?.frames ?? 8)}px ${state.pet.height * (sleeping ? 1 : 9)}px`;
  sprite.style.backgroundPosition = `${-frame * state.pet.width}px ${sleeping ? 0 : -row * state.pet.height}px`;
}
function sound(): void {
  if (!state?.settings.petSound || Date.now() - lastSound < 1500) return;
  lastSound = Date.now();
  const audio = new AudioContext(), oscillator = audio.createOscillator(), gain = audio.createGain();
  oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(620, audio.currentTime); oscillator.frequency.exponentialRampToValueAtTime(420, audio.currentTime + .07);
  gain.gain.setValueAtTime(.018, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + .09);
  oscillator.connect(gain).connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + .1); oscillator.onended = () => { void audio.close(); };
}
async function act(action: PetAction): Promise<void> { const result = await bridge.action(action); if (!result.ok) { sendState = 'error'; sendError = result.error || text('操作失败，请重试', 'Action failed. Try again.'); actionError = sendError; render(); } }
root.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (menu && !(event.target as HTMLElement).closest('.more') && button?.dataset.action !== 'more') { menu = false; void act({ type: 'menu', value: false }); render(); }
  if (!button || !state) return;
  const type = button.dataset.action!, key = button.closest<HTMLElement>('[data-key]')?.dataset.key;
  sound();
  if (type === 'more') { menu = !menu; void act({ type: 'menu', value: menu }); render(); if (menu) root.querySelector<HTMLElement>('.more button')?.focus(); }
  else if (type.startsWith('size-')) void act({ type: 'setSize', size: type.slice(5) as 'S' | 'M' | 'L' });
  else if (type === 'mini') { menu = false; void act({ type: 'menu', value: false }); void act({ type: 'setMini', value: !state.settings.petMini }); }
  else if (type === 'sound') void act({ type: 'setSound', value: !state.settings.petSound });
  else if (type === 'hide') void act({ type: 'setVisible', value: false });
  else if (type === 'bubbleOpen') { const key = state.bubble?.events.at(-1)?.item.key; if (key) void act({ type: 'open', key }); }
  else if (key && ['open', 'approve', 'deny', 'target', 'revealInMap'].includes(type)) void act({ type: type as 'open' | 'approve' | 'deny' | 'target' | 'revealInMap', key });
  else void act({ type } as PetAction);
});
root.addEventListener('input', (event) => { if ((event.target as HTMLElement).id === 'reply-input') { draft = (event.target as HTMLInputElement).value; sendState = 'idle'; const status = document.querySelector('.chat-status'); if (status) { status.textContent = text('Enter 发送', 'Enter to send'); status.classList.remove('error'); } const send = document.querySelector('.send'); if (send) send.innerHTML = icon('send'); } });
root.addEventListener('change', (event) => { const select = event.target as HTMLSelectElement; if (select.id === 'target-select') { sendState = 'idle'; void act({ type: 'target', key: select.value }); } if (select.id === 'pack-select') void act({ type: 'setPack', id: select.value }); });
root.addEventListener('submit', (event) => {
  event.preventDefault(); if (!state || sendState === 'sending' || !draft.trim()) return;
  const target = state.targets.find((item) => item.key === state!.targetKey) ?? state.targets[0]; if (!target) return;
  sendState = 'sending'; const sentText = draft; render();
  void bridge.action({ type: 'reply', key: target.key, text: sentText }).then((result) => { sendState = result.ok ? 'sent' : 'error'; sendError = result.error || text('发送失败，请重试', 'Could not send. Try again.'); if (result.ok && draft === sentText) draft = ''; render(); }).catch(() => { sendState = 'error'; sendError = text('发送失败，请重试', 'Could not send. Try again.'); render(); });
});
function opaqueAt(event: { clientX: number; clientY: number }): boolean {
  const character = document.querySelector<HTMLElement>('#character');
  if (!character || !state || !alpha) return false;
  // Invert the rotated character transform around its CSS transform origin before sampling alpha.
  const centerX = state.pet.x + state.pet.width / 2, centerY = state.pet.y + state.pet.height * .65;
  const rotation = state.edge ? (state.edge === 'left' || state.edge === 'bottom' ? 12 : -12) * state.dockAmount * Math.PI / 180 : 0;
  const dx = event.clientX - centerX, dy = event.clientY - centerY;
  const x = Math.floor((Math.cos(rotation) * dx + Math.sin(rotation) * dy + state.pet.width / 2) / state.pet.width * 192);
  const y = Math.floor((-Math.sin(rotation) * dx + Math.cos(rotation) * dy + state.pet.height * .65) / state.pet.height * 208);
  if (x < 0 || x >= 192 || y < 0 || y >= 208) return false;
  return alpha[((((animationState === 'sleeping' && state.sleeping ? 0 : ANIMATIONS[animationState].row) * 208 + y) * (spriteImage?.width ?? 1536)) + frame * 192 + x) * 4 + 3] > 24;
}
window.addEventListener('pointermove', (event) => {
  if (!state) return;
  if (scrollDrag) { scrollToPointer(event.clientY); return; }
  lastPointer = { clientX: event.clientX, clientY: event.clientY };
  const element = event.target as HTMLElement;
  const rect = document.querySelector('#character')?.getBoundingClientRect();
  const proximity = !!rect && Math.hypot(Math.max(rect.left - event.clientX, 0, event.clientX - rect.right), Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom)) <= 60;
  if (near !== proximity) { near = proximity; document.querySelector('.controls')?.classList.toggle('visible', near || menu || state.tray || state.chat); }
  const overCard = !!element.closest('.task');
  if (review !== overCard && !drag) { review = overCard; void act({ type: 'review', value: review }); }
  const interactive = !!drag || !!element.closest('.tray,.bubble,.chat,.error-banner,.more') || (!!element.closest('.controls') && (near || menu || state.tray || state.chat || state.settings.petMini)) || opaqueAt(event);
  if (interactive !== hit) { hit = interactive; bridge.hitTest(hit); }
  if (drag) {
    if (Math.hypot(event.screenX - drag.x, event.screenY - drag.y) >= 4) drag.moved = true;
    if (drag.moved) { document.querySelector('#character')?.classList.add('dragging'); void bridge.action({ type: 'dragMove', x: event.screenX, y: event.screenY }); }
  }
});
root.addEventListener('pointerdown', (event) => {
  const track = (event.target as HTMLElement).closest<HTMLElement>('.scroll-track');
  if (track) {
    const thumb = track.querySelector<HTMLElement>('.scroll-thumb')!;
    scrollDrag = { id: event.pointerId, grab: (event.target as HTMLElement).closest('.scroll-thumb') ? event.clientY - thumb.getBoundingClientRect().top : thumb.offsetHeight / 2 };
    track.classList.add('dragging'); root.setPointerCapture(event.pointerId); event.preventDefault(); scrollToPointer(event.clientY); return;
  }
  if (!(event.target as HTMLElement).closest('#character') || !opaqueAt(event)) return;
  event.preventDefault();
  drag = { id: event.pointerId, x: event.screenX, y: event.screenY, moved: false };
  root.setPointerCapture(event.pointerId); void bridge.action({ type: 'dragStart', x: event.screenX, y: event.screenY });
});
function endDrag(event: PointerEvent, cancelled = false): void {
  if (scrollDrag) { if (root.hasPointerCapture(scrollDrag.id)) root.releasePointerCapture(scrollDrag.id); scrollDrag = null; document.querySelector('.scroll-track')?.classList.remove('dragging'); return; }
  if (!drag) return;
  const clicked = !drag.moved && !cancelled;
  if (root.hasPointerCapture(drag.id)) root.releasePointerCapture(drag.id);
  drag = null; void act({ type: 'dragEnd', x: event.screenX, y: event.screenY });
  if (clicked) { sound(); void act({ type: 'click' }); }
}
root.addEventListener('pointerup', (event) => endDrag(event));
root.addEventListener('pointercancel', (event) => endDrag(event, true));
window.addEventListener('pointerleave', () => { if (!drag) { hit = false; near = false; bridge.hitTest(false); document.querySelector('.controls')?.classList.toggle('visible', !!state?.tray || !!state?.chat || menu); } });
window.addEventListener('keydown', (event) => { if (event.key === 'Escape') { if (menu) { menu = false; void act({ type: 'menu', value: false }); render(); document.querySelector<HTMLElement>('#pet-more-trigger')?.focus(); } else if (state?.chat) void act({ type: 'toggleChat' }); else if (state?.tray) void act({ type: 'toggleTray' }); } if ((event.key === 'Enter' || event.key === ' ') && (event.target as HTMLElement).id === 'character') { event.preventDefault(); void act({ type: 'click' }); } });
bridge.onState((next) => {
  const previousChat = state?.chat;
  state = next; document.documentElement.lang = next.locale;
  applyAppearance(next.appearance);
  const accent = document.documentElement.style.getPropertyValue('--theme-accent-solid');
  if (accent !== lastAccent) {
    lastAccent = accent; accentContext.clearRect(0, 0, 1, 1); accentContext.fillStyle = accent; accentContext.fillRect(0, 0, 1, 1);
    const [red, green, blue] = accentContext.getImageData(0, 0, 1, 1).data;
    document.documentElement.style.setProperty('--theme-accent-solid-fg', accentForeground(red, green, blue));
  }
  if (animationState !== next.mood) { animationState = next.mood; animationStart = performance.now(); frame = 0; }
  const activeImage = next.mood === 'sleeping' && next.sleeping ? next.sleeping.imageUrl : next.imageUrl;
  if (lastImage !== activeImage) {
    lastImage = activeImage; spriteImage = new Image(); const source = spriteImage;
    source.onload = () => { if (source !== spriteImage) return; canvas.width = source.width; canvas.height = source.height; context.drawImage(source, 0, 0); alpha = context.getImageData(0, 0, source.width, source.height).data; };
    source.src = activeImage;
  }
  if (next.bubble?.id && lastBubble !== next.bubble.id) { lastBubble = next.bubble.id; sound(); }
  render(); if (next.chat && !previousChat) document.querySelector<HTMLInputElement>('#reply-input')?.focus();
});
function animate(now: number): void {
  // Three calm breathing/blinking loops per 46 seconds, with varied rest intervals.
  const elapsedMs = now - animationStart;
  const idleTime = elapsedMs % 46000;
  const idleCycle = animationState === 'idle' ? idleTime >= 31000 ? idleTime - 31000 : idleTime >= 14000 ? idleTime - 14000 : idleTime : elapsedMs;
  let nextFrame = frameAt(animationState, animationState === 'idle' && idleCycle > 1100 ? 0 : idleCycle, motion.matches);
  if (animationState === 'sleeping' && state?.sleeping && !motion.matches) { const durations = state.sleeping.durationsMs; let remainder = elapsedMs % durations.reduce((a, b) => a + b, 0); nextFrame = 0; while (remainder >= durations[nextFrame] && nextFrame < durations.length - 1) { remainder -= durations[nextFrame]; nextFrame++; } }
  if (frame !== nextFrame) { frame = nextFrame; paintSprite(); if (lastPointer && !drag) { const element = document.elementFromPoint(lastPointer.clientX, lastPointer.clientY); const interactive = !!element?.closest('.tray,.bubble,.chat,.error-banner,.more') || (!!element?.closest('.controls') && (near || menu || !!state?.tray || !!state?.chat || !!state?.settings.petMini)) || opaqueAt(lastPointer); if (interactive !== hit) { hit = interactive; bridge.hitTest(hit); } } }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
let resizeScheduled = false;
window.addEventListener('resize', () => { if (resizeScheduled) return; resizeScheduled = true; requestAnimationFrame(() => { resizeScheduled = false; render(); }); });
setInterval(() => document.querySelectorAll<HTMLElement>('[data-since]').forEach((element) => { element.textContent = elapsed(Date.now() - Date.parse(element.dataset.since!)); }), 1000);
bridge.ready();
void bridge.action({ type: 'reducedMotion', value: motion.matches });
motion.addEventListener('change', () => { void bridge.action({ type: 'reducedMotion', value: motion.matches }); frame = 0; paintSprite(); });

function updateScrollArea(): void {
  const area = document.querySelector<HTMLElement>('[data-scroll-area]'), content = area?.querySelector<HTMLElement>('.scroll-content'), track = area?.querySelector<HTMLElement>('.scroll-track'), thumb = area?.querySelector<HTMLElement>('.scroll-thumb');
  if (!area || !content || !track || !thumb) return;
  const geometry = scrollGeometry(content.clientHeight, content.scrollHeight, content.scrollTop, Math.max(0, area.clientHeight - 16));
  area.dataset.overflowTop = String(!geometry.atStart); area.dataset.overflowBottom = String(!geometry.atEnd);
  track.hidden = !geometry.overflowing; track.setAttribute('aria-valuemax', String(Math.round(geometry.maximum))); track.setAttribute('aria-valuenow', String(Math.round(geometry.offset)));
  thumb.style.height = `${geometry.thumbSize}px`; thumb.style.transform = `translateY(${geometry.thumbOffset}px)`;
}
function scrollToPointer(clientY: number): void {
  const content = document.querySelector<HTMLElement>('.scroll-content'), track = document.querySelector<HTMLElement>('.scroll-track'), thumb = document.querySelector<HTMLElement>('.scroll-thumb');
  if (!content || !track || !thumb || !scrollDrag) return;
  const travel = Math.max(1, track.clientHeight - thumb.offsetHeight);
  content.scrollTop = (clientY - track.getBoundingClientRect().top - scrollDrag.grab) / travel * (content.scrollHeight - content.clientHeight);
  updateScrollArea();
}
root.addEventListener('scroll', (event) => { if ((event.target as HTMLElement).classList.contains('scroll-content')) updateScrollArea(); }, true);
root.addEventListener('keydown', (event) => {
  if (!(event.target as HTMLElement).closest('.scroll-track')) return;
  const list = document.querySelector<HTMLElement>('.task-list'); if (!list) return;
  const destination = event.key === 'Home' ? 0 : event.key === 'End' ? list.scrollHeight : event.key === 'ArrowDown' ? list.scrollTop + 40 : event.key === 'ArrowUp' ? list.scrollTop - 40 : event.key === 'PageDown' ? list.scrollTop + list.clientHeight : event.key === 'PageUp' ? list.scrollTop - list.clientHeight : null;
  if (destination !== null) { event.preventDefault(); list.scrollTop = destination; updateScrollArea(); }
});

// Local DOM equivalent of useMenuKeyboard: the pet has no remote React runtime.
window.addEventListener('keydown', (event) => {
  if (!menu || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || document.activeElement?.tagName === 'SELECT') return;
  const items = [...root.querySelectorAll<HTMLElement>('.more button:not(:disabled),.more select')];
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  event.preventDefault(); items[next]?.focus();
});

function updateBubbleFrame(): void {
  const bubble = root.querySelector<HTMLElement>('.bubble'), frame = bubble?.querySelector<SVGSVGElement>('.bubble-frame'), path = frame?.querySelector('path');
  if (!bubble || !frame || !path || !state) return;
  const bounds = bubble.getBoundingClientRect(), character = root.querySelector('#character')?.getBoundingClientRect();
  const headX = (character ? character.left + character.width / 2 : state.pet.x + state.pet.width / 2) - bounds.left;
  const outline = bubbleOutline(bounds.width, bounds.height, headX, state.panelAbove);
  frame.setAttribute('viewBox', `0 0 ${bounds.width} ${outline.canvasHeight}`);
  frame.style.height = `${outline.canvasHeight}px`; frame.style.top = `${outline.offsetTop}px`;
  path.setAttribute('d', outline.path); bubble.dataset.tailX = String(outline.tailX); bubble.dataset.headX = String(headX);
}
