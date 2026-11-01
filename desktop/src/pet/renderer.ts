import './styles.css';
import lucideNotice from './NOTICE?raw';
// Preserve the copied Web rail icon's licence in the distributed renderer.
document.head.append(document.createComment(lucideNotice));
import { ANIMATIONS, frameAt, type SpriteState } from './animation';
import { activityStatus, statusMarkStyles, statusMarkSvg, type StatusMark } from '../shared/statusMarks';
import { activitySecondary, conversationTitle, groupActivities, isAgentActivity, type ActivityGroup } from '../shared/activityGroups';
import { bubbleConversationCount } from './bubbles';
import { applyAppearance } from '../shared/appearance';
import { accentForeground, bubbleOutline, escapeHtml, requestSummaryHtml } from './presentation';
import { formatList, getLocale, setLocale, t, type MessageKey } from '../shared/i18n';
import { showError } from '../local/errorMark';
import { commandErrorMessage } from './errors';
import { scrollGeometry } from './scroll';
import type { ActivityItem, HostCommandResult } from '../shared/contract';
import type { PetAction, PetBridge, PetViewState } from './bridge';
const bridge = (window as unknown as { rcDesktop: { pet: PetBridge } }).rcDesktop.pet;
const root = document.querySelector<HTMLElement>('#app')!;
const markStyle = document.createElement('style'); markStyle.textContent = statusMarkStyles; document.head.append(markStyle);
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let state: PetViewState | null = null, menu = false, near = false, review = false, hit = false;
type ActionSurface = 'bubble' | 'tray' | 'chat' | 'general';
interface ActionFailure { result: HostCommandResult; key?: string; requestId?: string; surface: ActionSurface }
const failures = new Map<string, ActionFailure>();
const pendingActions = new Map<string, PetAction['type']>();
let bubbleAlertId: string | null = null;
let draft = '', sendState: 'idle' | 'sending' | 'sent' | 'error' = 'idle';
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
const escape = escapeHtml;
const paths: Record<string, string> = { chat: '<path d="M3 3.5h10v7H7l-4 3z"/>', tasks: '<rect x="3" y="2.5" width="10" height="11" rx="2"/><path d="M6 6h4M6 9h4"/>', home: '<path d="m2 7 6-5 6 5M4 6v8h8V6M7 14v-4h2v4"/>', more: '<circle cx="3" cy="8" r=".6"/><circle cx="8" cy="8" r=".6"/><circle cx="13" cy="8" r=".6"/>', close: '<path d="m5 5 6 6M11 5l-6 6"/>', send: '<path d="M8 13V3m-4 4 4-4 4 4"/>', previous: '<path d="m10 4-4 4 4 4"/>', next: '<path d="m6 4 4 4-4 4"/>', check: '<path d="m3 8 3 3 7-7"/>', map: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>', moon: '<path d="M12.5 10A5 5 0 0 1 6 3a5 5 0 1 0 6.5 7Z"/>' };
// LayoutDashboard matches the Web rail in DesktopShell/MatterWorkbench (Lucide, ISC; see NOTICE).
const icon = (name: string): string => `<svg viewBox="${name === 'map' ? '0 0 24 24' : '0 0 16 16'}" ${name === 'map' ? 'class="map-icon" data-icon="thread-map"' : ''} aria-hidden="true">${paths[name] ?? paths.tasks}</svg>`;
function requestHeading(item: ActivityItem): string { return item.request?.kind === 'approval' ? t('需要你批准') : t('需要你回答'); }
function status(item: ActivityItem): string {
  const kind = activityStatus(item);
  const labels: Record<StatusMark, MessageKey> = { running: '运行中', unread: '已完成，未读', failed: '失败', interrupted: '已中断', waiting: '等待你', idle: '已读，空闲', 'agents-running': '智能体线程运行中', unknown: '状态未知' };
  return statusMarkSvg(kind, t(labels[kind]));
}
function elapsed(milliseconds: number): string { const seconds = Math.floor(Math.max(0, milliseconds) / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function button(action: string, label: string, body = escape(label), extra = ''): string { return `<button type="button" data-action="${action}" aria-label="${escape(label)}" title="${escape(label)}" ${extra}>${body}</button>`; }
function itemTitle(item: ActivityItem): string { return conversationTitle(item, state?.items); }
function groupTitle(group: ActivityGroup): string { return itemTitle(group.items[0]); }
function errorId(surface: ActionSurface, key?: string): string { return `${surface}:${key ?? ''}`; }
function errorSlot(surface: ActionSurface, item?: ActivityItem): string {
  const id = errorId(surface, item?.key);
  const failure = failures.get(id);
  return failure && (!failure.requestId || failure.requestId === item?.request?.id) ? `<span class="pet-error-slot" data-error-id="${escape(id)}" role="alert"></span>` : '';
}
function decisionButtons(item: ActivityItem, surface: ActionSurface): string {
  const pending = pendingActions.get(errorId(surface, item.key)), disabled = pending ? ' disabled' : '';
  return button('approve', pending === 'approve' ? t('正在批准…') : t('批准'), undefined, `class="primary"${disabled}`)
    + button('deny', pending === 'deny' ? t('正在拒绝…') : t('拒绝'), undefined, disabled);
}
function itemSecondary(item: ActivityItem): string { return activitySecondary(item); }
function taskCard(item: ActivityItem): string {
  const waiting = item.state === 'needsInput';
  const approval = waiting && item.request?.kind === 'approval';
  const actions = (approval ? decisionButtons(item, 'tray') : '')
    + button('open', t('打开')) + (item.state === 'completed' || item.request?.kind === 'input' ? button('target', t('回复')) : '') + errorSlot('tray', item) + button('revealInMap', t('在地图中显示'), icon('map'), 'class="map-action"');
  const title = `<div class="task-title">${waiting ? '' : status(item)}<strong title="${escape(itemTitle(item))}">${escape(itemTitle(item))}</strong>${item.state === 'running' ? `<span class="timer" data-since="${escape(item.since)}">${elapsed(Date.now() - Date.parse(item.since))}</span>` : ''}</div>`;
  const summary = item.request?.summary ?? item.resultSummary;
  const summaryHtml = summary ? `<div class="summary ${waiting ? 'request-summary' : ''}" title="${escape(summary)}">${waiting ? requestSummaryHtml(summary) : escape(summary)}</div>` : '';
  const meta = `<div class="meta" title="${escape(itemSecondary(item))}">${escape(itemSecondary(item))}</div>`;
  return `<article class="task ${waiting ? 'waiting' : ''} ${isAgentActivity(item) ? 'agent-task' : ''}" data-key="${escape(item.key)}">${waiting ? `<div class="request-kicker">${status(item)}${escape(requestHeading(item))}</div>` : ''}${title}${waiting && !isAgentActivity(item) ? summaryHtml + meta : meta + summaryHtml}<div class="actions">${actions}</div></article>`;
}
function conversationCard(group: ActivityGroup): string {
  return `<section class="conversation" role="group" aria-label="${escape(groupTitle(group))}" data-conversation-key="${escape(group.key)}">${group.items.map(taskCard).join('')}</section>`;
}
function activeBubbleEvent() {
  const events = state?.bubble?.events ?? [];
  return events.find((event) => event.alertId === bubbleAlertId) ?? events.at(-1);
}
function bubbleText(): string {
  const bubble = state?.bubble, event = activeBubbleEvent();
  if (!bubble || !event) return '';
  const count = bubbleConversationCount(bubble);
  if (count > 1) return t('{count} 个对话完成', { count });
  const item = event.item, title = itemTitle(item);
  if (event.type === 'needsInput') return `${requestHeading(item)}\n${title}\n${itemSecondary(item)}\n${item.request?.summary ?? ''}`;
  if (event.type === 'failed') return `${title} · ${item.resultSummary || t('遇到了一点问题')}`;
  return `${title} ${t('完成了')}${item.durationMs ? ` · ${elapsed(item.durationMs)}` : ''}`;
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
  const sections: [string, ActivityItem[]][] = [ [t('需要你'), state.items.filter((i) => i.state === 'needsInput' || i.state === 'failed' || i.state === 'interrupted')], [t('进行中'), state.items.filter((i) => i.state === 'running')], [t('刚完成'), state.items.filter((i) => i.state === 'completed')] ];
  const groups = sections.map(([name, items]) => [name, groupActivities(items, state!.items)] as const);
  const conversations = groupActivities(state.items);
  const bubble = state.bubble?.events.length ? state.bubble : null;
  const bubbleEvent = activeBubbleEvent();
  const bubbleItem = bubbleEvent?.item;
  if (bubbleEvent) bubbleAlertId = bubbleEvent.alertId;
  const bubbleGroups = bubble ? groupActivities(bubble.events.map((event) => event.item), state.items) : [];
  const bubbleTitle = bubbleGroups.length > 1 ? bubbleText() : bubbleItem ? itemTitle(bubbleItem) : '';
  const bubbleSummary = bubbleGroups.length > 1 ? formatList(bubbleGroups.map(groupTitle)) : bubbleItem?.request?.summary ?? bubbleItem?.resultSummary;
  const bubbleEventIndex = bubbleEvent && bubble ? bubble.events.indexOf(bubbleEvent) : -1;
  const bubbleApproval = bubbleItem?.state === 'needsInput' && bubbleItem.request?.kind === 'approval';
  const target = state.targets.find((item) => item.key === state!.targetKey) ?? state.targets[0];
  const tilt = state.edge ? (state.edge === 'left' || state.edge === 'bottom' ? 12 : -12) * state.dockAmount : 0;
  root.className = state.settings.petMini ? 'mini' : '';
  root.dataset.dockEdge = state.edge ?? ''; root.dataset.dockAmount = String(state.dockAmount);
  root.innerHTML = `${!state.settings.petMini ? `<div id="character" role="button" tabindex="0" aria-label="${escape(t('桌宠，点击查看任务，拖动以移动'))}" class="${drag?.moved ? 'dragging' : ''} ${state.mood === 'sleeping' ? 'sleeping' : ''}" style="left:${pet.x}px;top:${pet.y}px;width:${pet.width}px;height:${pet.height}px;transform:rotate(${tilt}deg)"><div id="sprite"></div>${state.mood === 'sleeping' ? '<svg class="sleep-motes" viewBox="0 0 36 48" aria-hidden="true"><path d="M7 34h6l-6 6h6"/><path d="M17 24h7l-7 7h7"/><path d="M23 13h5l-5 5h5"/></svg>' : ''}</div>` : ''}
    <nav class="controls surface ${near || menu || state.tray || state.chat ? 'visible' : ''}" aria-label="${escape(t('桌宠控制'))}" style="left:${cx}px;top:${cy}px;width:${controlsWidth}px">${button('toggleChat', t('聊天'), icon('chat') + escape(t('聊天')), `aria-pressed="${state.chat}"`)}${button('toggleTray', t('任务'), icon('tasks') + escape(t('任务')) + `<span class="task-count">${conversations.length || ''}</span>`, `aria-pressed="${state.tray}"`)}${button('openMain', t('打开主窗口'), icon('home'), 'class="icon-only"')}${button('more', t('更多'), icon('more'), `class="icon-only" id="pet-more-trigger" aria-haspopup="menu" aria-expanded="${menu}"`)}${errorSlot('general')}</nav>
    <div class="stack ${state.panelAbove ? 'above' : 'below'}" style="top:${stackTop}px;bottom:${stackBottom}px;${state.panelAbove ? 'justify-content:flex-end' : ''}">
    ${state.error ? `<div class="surface error-banner" role="alert">${escape(commandErrorMessage({ ok: false, error: state.error }, state.locale))}</div>` : ''}
    ${state.tray ? `<section class="tray surface" aria-label="${escape(t('活动任务'))}" style="max-height:${state.panelHeight}px"><header class="tray-header"><span class="tray-title">${escape(t('活动'))}</span><span class="tray-subtitle">${escape(t('跨设备 · 跨工作区'))}</span>${button('toggleTray', t('关闭任务'), icon('close'), 'class="close"')}</header><div class="scroll-frame" data-scroll-area><div class="task-list scroll-content" id="pet-task-list">${state.items.length ? groups.filter(([, list]) => list.length).map(([name, list]) => `<div class="group-label">${name}<span>${list.length}</span></div>${list.map(conversationCard).join('')}`).join('') : `<div class="empty">${icon('check')}<div>${escape(t('一切就绪，交给我吧'))}</div></div>`}</div><div class="scroll-track" role="scrollbar" aria-label="${escape(t('滚动活动任务'))}" aria-controls="pet-task-list" aria-orientation="vertical" aria-valuemin="0" tabindex="0" hidden><div class="scroll-thumb"></div></div></div></section>` : ''}
    ${bubble ? `<aside class="bubble surface" data-key="${escape(bubbleItem?.key ?? '')}" data-alert-id="${escape(bubbleEvent?.alertId ?? '')}"><svg class="bubble-frame" aria-hidden="true"><path fill="var(--theme-bg)" stroke="var(--theme-border)" stroke-width="1" vector-effect="non-scaling-stroke"/></svg><div class="bubble-kicker">${status(bubbleItem ?? bubble.events[0].item)}${escape(bubble.sticky && bubbleItem ? requestHeading(bubbleItem) : t('任务动态'))}</div>${button('bubbleOpen', bubbleTitle, escape(bubbleTitle), 'class="bubble-title"')}${bubbleItem && bubbleGroups.length <= 1 ? `<div class="bubble-secondary" title="${escape(itemSecondary(bubbleItem))}">${escape(itemSecondary(bubbleItem))}</div>` : ''}${bubbleSummary ? `<div class="request-summary" title="${escape(bubbleSummary)}">${bubble.sticky ? requestSummaryHtml(bubbleSummary) : escape(bubbleSummary)}</div>` : ''}${bubbleGroups.length === 1 && bubble.events.length > 1 ? `<nav class="bubble-pages" aria-label="${escape(t('同一对话的提醒'))}">${button('bubblePrevious', t('上一条提醒'), icon('previous'))}<span>${escape(t('提醒'))} ${bubbleEventIndex + 1} / ${bubble.events.length}</span>${button('bubbleNext', t('下一条提醒'), icon('next'))}</nav>` : ''}<div class="bubble-actions">${bubbleApproval && bubbleItem ? decisionButtons(bubbleItem, 'bubble') : ''}${errorSlot('bubble', bubbleItem)}${button('revealInMap', t('在地图中显示'), icon('map'), 'class="map-action"')}</div>${button('dismiss', t('关闭提醒'), icon('close'), 'class="close"')}</aside>` : ''}
    ${state.chat ? `<form class="chat surface" id="chat-form"><label class="chat-target">${target ? status(target) : icon('chat')}<select id="target-select" aria-label="${escape(t('回复目标线程'))}">${groupActivities(state.targets, state.items).map((group) => `<optgroup label="${escape(groupTitle(group))}">${group.items.map((item) => `<option value="${escape(item.key)}" ${item.key === target?.key ? 'selected' : ''}>${escape(itemTitle(item))}${isAgentActivity(item) ? ` · ${escape(t('智能体'))}${item.agentName ? ` ${escape(item.agentName)}` : ''}` : ''}</option>`).join('')}</optgroup>`).join('')}</select></label>${target ? `<div class="chat-target-meta">${escape(itemSecondary(target))}</div>` : ''}<div class="chat-input-row"><input id="reply-input" aria-label="${escape(t('回复'))}" placeholder="${escape(target ? t('继续这个任务…') : t('暂无活动线程'))}" value="${escape(draft)}" autocomplete="off" maxlength="16000" ${!target || sendState === 'sending' ? 'disabled' : ''}>${errorSlot('chat', target)}<button class="send" aria-label="${escape(t('发送回复'))}" ${!target || sendState === 'sending' ? 'disabled' : ''}>${icon(sendState === 'sent' ? 'check' : 'send')}</button></div><div class="chat-status ${sendState === 'error' ? 'error' : ''}" role="status">${escape(sendState === 'sending' ? t('正在发送…') : sendState === 'sent' ? t('已发送') : sendState === 'error' ? t('未发送') : t('Enter 发送'))}</div></form>` : ''}</div>
    ${menu ? `<section class="more surface" role="menu" aria-label="${escape(t('宠物偏好'))}" style="left:${Math.min(innerWidth - 216, Math.max(16, cx + 44))}px;${cy > innerHeight / 2 ? `bottom:${innerHeight - cy + 8}px` : `top:${cy + 44}px`};max-height:${innerHeight - 28}px;overflow:auto">${button('mini', t('Mini 模式'), escape(t('Mini 模式')) + (state.settings.petMini ? icon('check') : ''))}<div class="more-label">${escape(t('宠物大小'))}</div><div class="sizes">${(['S', 'M', 'L'] as const).map((size) => button(`size-${size}`, size, size, `class="${state!.settings.petSize === size ? 'selected' : ''}"`)).join('')}</div><label class="more-label" for="pack-select">${escape(t('选择宠物'))}</label><select class="pack-select" id="pack-select">${state.packs.map((pack) => `<option value="${escape(pack.id)}" ${pack.id === state!.settings.petId ? 'selected' : ''}>${escape(pack.displayName)}</option>`).join('')}</select>${button('importFolder', t('导入文件夹…'))}${button('importZip', t('导入 ZIP…'))}<hr>${button('sound', t('轻触提示音'), escape(t('轻触提示音')) + (state.settings.petSound ? icon('check') : ''))}${button('preferences', t('偏好设置…'))}${button('hide', t('隐藏桌宠'))}</section>` : ''}<div class="live-announcement" aria-live="polite">${escape(bubbleText())}</div>`;
  if (focused === 'reply-input' && state.chat) { const input = document.querySelector<HTMLInputElement>('#reply-input'); input?.focus(); if (selection !== null) input?.setSelectionRange(selection, selection); }
  for (const button of root.querySelectorAll('.more button')) button.setAttribute('role', 'menuitem');
  if (menu && focusedMenuAction) root.querySelector<HTMLElement>(`.more [data-action="${focusedMenuAction}"]`)?.focus();
  else if (focused && focused !== 'reply-input') document.getElementById(focused)?.focus();
  const list = document.querySelector<HTMLElement>('.task-list'); if (list) list.scrollTop = savedScroll;
  installErrorMarks();
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
function installErrorMarks(): void {
  for (const slot of root.querySelectorAll<HTMLElement>('[data-error-id]')) {
    const failure = failures.get(slot.dataset.errorId!); if (!failure) continue;
    const reason = commandErrorMessage(failure.result, state?.locale ?? getLocale());
    showError(slot, reason, failure.key ? () => { void act({ type: 'open', key: failure.key! }, failure.surface); } : undefined,
      { actionLabel: t('在线程中打开') });
  }
}
async function runItemAction(action: PetAction & { key: string }, surface: ActionSurface): Promise<HostCommandResult> {
  const account = state?.accountId, requestId = ['approve', 'deny'].includes(action.type) ? state?.items.find((item) => item.key === action.key)?.request?.id : undefined;
  const id = errorId(surface, action.key); failures.delete(id); pendingActions.set(id, action.type); render();
  let result: HostCommandResult;
  try { result = await bridge.action(action); } catch { result = { ok: false }; }
  if (state?.accountId !== account) return result;
  pendingActions.delete(id);
  if (!result.ok) { failures.set(id, { result, key: action.key, requestId, surface }); while (failures.size > 40) failures.delete(failures.keys().next().value!); }
  render(); return result;
}
async function act(action: PetAction, surface: ActionSurface = 'general'): Promise<void> {
  if ('key' in action) { await runItemAction(action, surface); return; }
  try { const result = await bridge.action(action); if (!result.ok && !['review', 'reducedMotion', 'measure', 'dragStart', 'dragMove', 'dragEnd'].includes(action.type)) { failures.set(errorId('general'), { result, surface: 'general' }); render(); } } catch { /* Item commands retain their explicit error path above. */ }
}
root.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (menu && !(event.target as HTMLElement).closest('.more') && button?.dataset.action !== 'more') { menu = false; void act({ type: 'menu', value: false }); render(); }
  if (!button || !state) return;
  const type = button.dataset.action!, key = button.closest<HTMLElement>('[data-key]')?.dataset.key;
  const surface: ActionSurface = button.closest('.bubble') ? 'bubble' : button.closest('.task') ? 'tray' : button.closest('.chat') ? 'chat' : 'general';
  sound();
  if (type === 'bubblePrevious' || type === 'bubbleNext') { const events = state.bubble?.events ?? [], index = events.findIndex((event) => event.alertId === bubbleAlertId); bubbleAlertId = events[(index + (type === 'bubbleNext' ? 1 : -1) + events.length) % events.length]?.alertId ?? null; render(); }
  else if (type === 'more') { menu = !menu; void act({ type: 'menu', value: menu }); render(); if (menu) root.querySelector<HTMLElement>('.more button')?.focus(); }
  else if (type.startsWith('size-')) void act({ type: 'setSize', size: type.slice(5) as 'S' | 'M' | 'L' });
  else if (type === 'mini') { menu = false; void act({ type: 'menu', value: false }); void act({ type: 'setMini', value: !state.settings.petMini }); }
  else if (type === 'sound') void act({ type: 'setSound', value: !state.settings.petSound });
  else if (type === 'hide') void act({ type: 'setVisible', value: false });
  else if (type === 'bubbleOpen') { const targetKey = key ?? activeBubbleEvent()?.item.key; if (targetKey) void act({ type: 'open', key: targetKey }, 'bubble'); }
  else if (key && ['open', 'approve', 'deny', 'target', 'revealInMap'].includes(type)) void act({ type: type as 'open' | 'approve' | 'deny' | 'target' | 'revealInMap', key }, surface);
  else void act({ type } as PetAction);
});
root.addEventListener('input', (event) => { if ((event.target as HTMLElement).id === 'reply-input') { draft = (event.target as HTMLInputElement).value; sendState = 'idle'; const status = document.querySelector('.chat-status'); if (status) { status.textContent = t('Enter 发送'); status.classList.remove('error'); } const send = document.querySelector('.send'); if (send) send.innerHTML = icon('send'); } });
root.addEventListener('change', (event) => { const select = event.target as HTMLSelectElement; if (select.id === 'target-select') { sendState = 'idle'; void act({ type: 'target', key: select.value }); } if (select.id === 'pack-select') void act({ type: 'setPack', id: select.value }); });
root.addEventListener('submit', (event) => {
  event.preventDefault(); if (!state || sendState === 'sending' || !draft.trim()) return;
  const target = state.targets.find((item) => item.key === state!.targetKey) ?? state.targets[0]; if (!target) return;
  sendState = 'sending'; const sentText = draft, account = state.accountId; render();
  void runItemAction({ type: 'reply', key: target.key, text: sentText }, 'chat').then((result) => { if (state?.accountId !== account) return; sendState = result.ok ? 'sent' : 'error'; if (result.ok && draft === sentText) draft = ''; render(); });
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
  const interactive = !!drag || !!element.closest('.tray,.bubble,.chat,.error-banner,.more,.error-popover') || (!!element.closest('.controls') && (near || menu || state.tray || state.chat || state.settings.petMini)) || opaqueAt(event);
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
  const moodOnly = state && state.mood !== 'sleeping' && next.mood !== 'sleeping' && JSON.stringify({ ...state, mood: null }) === JSON.stringify({ ...next, mood: null });
  if (state && state.accountId !== next.accountId) { failures.clear(); pendingActions.clear(); draft = ''; sendState = 'idle'; }
  state = next; setLocale(next.locale); document.documentElement.lang = next.locale;
  applyAppearance(next.appearance);
  document.title = `Pockymoe · ${t('桌宠')}`;
  root.setAttribute('aria-label', document.title);
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
  if (moodOnly) { paintSprite(); return; }
  render(); if (next.chat && !previousChat) document.querySelector<HTMLInputElement>('#reply-input')?.focus();
});
function animate(now: number): void {
  // Three calm breathing/blinking loops per 46 seconds, with varied rest intervals.
  const elapsedMs = now - animationStart;
  const idleTime = elapsedMs % 46000;
  const idleCycle = animationState === 'idle' ? idleTime >= 31000 ? idleTime - 31000 : idleTime >= 14000 ? idleTime - 14000 : idleTime : elapsedMs;
  let nextFrame = frameAt(animationState, animationState === 'idle' && idleCycle > 1100 ? 0 : idleCycle, motion.matches);
  if (animationState === 'sleeping' && state?.sleeping && !motion.matches) { const durations = state.sleeping.durationsMs; let remainder = elapsedMs % durations.reduce((a, b) => a + b, 0); nextFrame = 0; while (remainder >= durations[nextFrame] && nextFrame < durations.length - 1) { remainder -= durations[nextFrame]; nextFrame++; } }
  if (frame !== nextFrame) { frame = nextFrame; paintSprite(); if (lastPointer && !drag) { const element = document.elementFromPoint(lastPointer.clientX, lastPointer.clientY); const interactive = !!element?.closest('.tray,.bubble,.chat,.error-banner,.more,.error-popover') || (!!element?.closest('.controls') && (near || menu || !!state?.tray || !!state?.chat || !!state?.settings.petMini)) || opaqueAt(lastPointer); if (interactive !== hit) { hit = interactive; bridge.hitTest(hit); } } }
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
