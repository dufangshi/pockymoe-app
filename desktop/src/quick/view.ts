import { t, localizeMessage } from '../shared/i18n';
// Approved local-UI exception: docs/ui-principles.md (Electron utility windows).
import type { ActivityItem } from '../shared/contract';
import { activitySecondary, conversationTitle, groupActivities, isAgentActivity } from '../shared/activityGroups';
import { activityStatus, statusMarkSvg } from '../shared/statusMarks';
import { showError } from '../local/errorMark';
import { enhanceScrollbars } from '../local/scrollbars';
import { localBridge, type LocalState } from '../shared/local';
// This renderer only consumes sanitized activity summaries; replies return to the
// relay page through the main process, which owns the command acknowledgement.
export function mountQuick(root: HTMLElement, initial: LocalState): void {
  let state = initial, selected: string | null = null, query = '';
  let visible: ActivityItem[] = [];
  const expanded = new Set<string>();
  root.className = 'quick';
  root.innerHTML = `<div class="quick-search"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><input id="search" placeholder="${t("搜索活动线程…")}" aria-label="${t("搜索活动线程")}" autocomplete="off"/><kbd>esc</kbd></div><div id="quick-list" data-scroll role="listbox" aria-label="${t("活动线程")}"></div><form id="reply-form"><span class="reply-arrow" aria-hidden="true">↳</span><input id="reply" placeholder="${t("给选中的线程快速回复…")}" aria-label="${t("快速回复")}" autocomplete="off"/><button id="send" type="submit" title="${t("发送回复")}" aria-label="${t("发送回复")}">↑</button></form><footer class="quick-footer"><span><span class="brand-mark">›_</span> Pockymoe</span><span><kbd>↑</kbd><kbd>↓</kbd> ${t("选择")} <kbd>↵</kbd> ${t("打开")}</span></footer>`;
  enhanceScrollbars(root);
  const list = root.querySelector<HTMLDivElement>('#quick-list')!;
  const search = root.querySelector<HTMLInputElement>('#search')!;
  const reply = root.querySelector<HTMLInputElement>('#reply')!;
  const send = root.querySelector<HTMLButtonElement>('#send')!;
  let lastStatus: { message: string; error: boolean; openKey?: string } | null = null;
  const status = (message: string, error = false, openKey?: string): void => {
    lastStatus = { message, error, openKey };
    const footer = root.querySelector<HTMLElement>('.quick-footer')!;
    footer.dataset.error = String(error);
    if (error) showError(footer.firstElementChild as HTMLElement, message, () => { void run('reply'); });
    else footer.firstElementChild!.textContent = message;
    if (openKey) {
      const open = document.createElement('button'); open.className = 'open-in-thread'; open.textContent = t('在线程中打开');
      open.onclick = () => { void localBridge().action({ type: 'open', key: openKey }).then(result => { if (!result.ok) status(result.error || t('操作失败'), true, openKey); }); };
      footer.firstElementChild!.append(open);
    }
  };
  const run = async (type: 'open' | 'reply'): Promise<void> => {
    if (!selected) return;
    const targetKey = selected;
    send.disabled = true;
    try {
      const result = await localBridge().action(type === 'open' ? { type, key: targetKey } : { type, key: targetKey, text: reply.value });
      if (result.ok && type === 'reply') { reply.value = ''; status(t('回复已发送')); }
      else if (!result.ok) status(result.error || t('操作失败，请重试'), true, result.code === 'needsThread' ? targetKey : undefined);
    } catch { status(t('连接暂时不可用'), true); }
    finally { send.disabled = false; }
  };
  const select = (key: string): void => {
    selected = key;
    for (const row of list.querySelectorAll<HTMLElement>('[role="option"]')) { const active = row.dataset.key === key; row.classList.toggle('selected', active); row.setAttribute('aria-selected', String(active)); }
    const item = visible.find(i => i.key === selected); reply.placeholder = item ? t('回复「{title}」{agent}…', { title: conversationTitle(item, state.snapshot?.items), agent: isAgentActivity(item) ? ` · ${t('智能体')}${item.agentName ? ` ${item.agentName}` : ''}` : '' }) : t('给选中的线程快速回复…');
  };
  const render = (): void => {
    const groups: [string, ActivityItem[]][] = [
      [t('需要你'), state.snapshot?.items.filter(i => i.state === 'needsInput' || ['failed', 'interrupted'].includes(i.state) && i.unread) || []],
      [t('进行中'), state.snapshot?.items.filter(i => i.state === 'running') || []],
      [t('刚完成'), state.snapshot?.items.filter(i => i.state === 'completed' && i.unread) || []]
    ];
    const all = state.snapshot?.items || [];
    for (const group of groups) group[1] = group[1].filter(i => `${conversationTitle(i, all)} ${i.title} ${i.agentName || ''} ${i.deviceName} ${i.workspaceLabel}`.toLocaleLowerCase().includes(query));
    visible = [];
    const scrollTop = list.scrollTop;
    list.replaceChildren();
    if (!groups.some(([, items]) => items.length)) {
      const empty = document.createElement('div'); empty.className = 'quick-empty';
      const symbol = document.createElement('span'); symbol.className = 'empty-symbol'; symbol.textContent = query ? '⌕' : '✓';
      const title = document.createElement('strong'); title.textContent = query ? t('没有找到匹配的线程') : t('一切就绪，安静专注。');
      const description = document.createElement('p'); description.textContent = query ? t('试试线程名、智能体、设备名或工作区。') : t('活动线程会自动出现在这里。');
      empty.append(symbol, title, description); list.append(empty);
    }
    for (const [title, items] of groups) {
      const conversations = groupActivities(items, all);
      if (!conversations.length) continue;
      const heading = document.createElement('h2'); heading.textContent = `${title}  ${conversations.length}`; list.append(heading);
      for (const conversation of conversations) {
        const container = document.createElement('div'); container.className = 'quick-conversation'; container.role = 'group'; container.setAttribute('aria-label', conversation.title);
        const open = expanded.has(conversation.key) || !!query;
        const appendRow = (item: ActivityItem, nested = false): void => {
          visible.push(item);
          const row = document.createElement('div'); row.className = `quick-row ${nested ? 'agent-row' : 'conversation-summary'}`; row.role = 'option'; row.tabIndex = -1; row.dataset.key = item.key;
          row.title = `${conversation.title}\n${activitySecondary(item)}`;
          const dot = document.createElement('span'); dot.className = 'row-status'; dot.innerHTML = statusMarkSvg(activityStatus(item));
          const copy = document.createElement('div'); copy.className = 'row-copy';
          const name = document.createElement('strong'); name.textContent = conversation.title;
          const meta = document.createElement('span'); meta.textContent = activitySecondary(item);
          copy.append(name, meta);
          const detail = document.createElement('span'); detail.className = 'row-detail'; detail.textContent = item.request ? item.request.kind === 'approval' ? t('审批') : t('输入') : item.state === 'running' ? elapsed(item.since) : item.resultSummary || t('已完成');
          if (item.state === 'running') { detail.classList.add('elapsed'); detail.dataset.since = item.since; }
          if (item.state === 'interrupted') detail.textContent = t('已中断');
          row.append(dot, copy, detail);
          row.onclick = () => { select(item.key); void run('open'); };
          row.onmousemove = () => select(item.key);
          container.append(row);
        };
        appendRow(conversation.items[0]);
        if (conversation.items.length > 1) {
          const toggle = document.createElement('button'); toggle.className = 'conversation-toggle'; toggle.type = 'button'; toggle.dataset.conversation = conversation.key;
          toggle.setAttribute('aria-label', t(open ? '收起「{title}」的线程' : '展开「{title}」的线程', { title: conversation.title })); toggle.setAttribute('aria-expanded', String(open));
          toggle.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="${open ? 'm4 6 4 4 4-4' : 'm6 4 4 4-4 4'}"/></svg>`;
          toggle.onclick = e => {
            if (open) expanded.delete(conversation.key); else expanded.add(conversation.key);
            render();
            if (e.detail === 0) [...list.querySelectorAll<HTMLButtonElement>('[data-conversation]')].find(button => button.dataset.conversation === conversation.key)?.focus();
          };
          container.append(toggle);
          const count = document.createElement('span'); count.className = 'conversation-count'; count.textContent = t('{count} 个线程', { count: conversation.items.length });
          container.querySelector('.row-copy strong')!.append(count);
          if (open) for (const item of conversation.items.slice(1)) appendRow(item, true);
        }
        list.append(container);
      }
    }
    if (!visible.some(i => i.key === selected)) selected = visible[0]?.key ?? null;
    list.scrollTop = scrollTop;
    if (selected) select(selected);
    reply.disabled = !selected; send.disabled = !selected;
  };
  search.oninput = () => { query = search.value.trim().toLocaleLowerCase(); render(); };
  root.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const index = visible.findIndex(i => i.key === selected), next = visible[(index + (e.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length];
      if (next) { select(next.key); [...list.querySelectorAll<HTMLElement>('[role="option"]')].find(el => el.dataset.key === next.key)?.scrollIntoView({ block: 'nearest' }); }
    } else if (e.key === 'Enter' && e.target !== reply && e.target !== send) { e.preventDefault(); void run('open'); }
  });
  root.querySelector<HTMLFormElement>('#reply-form')!.onsubmit = e => { e.preventDefault(); if (reply.value.trim()) void run('reply'); };
  const refreshLabels = (): void => {
    search.placeholder = t('搜索活动线程…'); search.setAttribute('aria-label', t('搜索活动线程'));
    reply.setAttribute('aria-label', t('快速回复')); send.setAttribute('aria-label', t('发送回复')); send.title = t('发送回复');
    list.setAttribute('aria-label', t('活动线程'));
    root.querySelector('.quick-footer')!.lastElementChild!.innerHTML = `<kbd>↑</kbd><kbd>↓</kbd> ${t('选择')} <kbd>↵</kbd> ${t('打开')}`;
    for (const thumb of root.querySelectorAll('.scroll-thumb')) thumb.setAttribute('aria-label', t('滚动内容'));
    if (lastStatus) status(localizeMessage(lastStatus.message), lastStatus.error, lastStatus.openKey);
  };
  localBridge().onState(next => { const changed = next.locale !== state.locale; state = next; if (changed) refreshLabels(); render(); });
  const tick = setInterval(() => {
    if (document.hidden) return;
    if (!root.isConnected) { clearInterval(tick); return; }
    for (const timer of list.querySelectorAll<HTMLElement>('[data-since]')) timer.textContent = elapsed(timer.dataset.since!);
  }, 1000);
  render(); search.focus();
}

export function elapsed(since: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000)) || 0;
  const minutes = Math.floor(seconds / 60);
  return `${minutes.toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
