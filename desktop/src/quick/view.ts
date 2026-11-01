import type { ActivityItem } from '../shared/contract';
import { localBridge, type LocalState } from '../shared/local';
// This renderer only consumes sanitized activity summaries; replies return to the
// relay page through the main process, which owns the command acknowledgement.
export function mountQuick(root: HTMLElement, initial: LocalState): void {
  let state = initial, selected: string | null = null, query = '';
  let visible: ActivityItem[] = [];
  root.className = 'quick';
  root.innerHTML = `<div class="quick-search"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><input id="search" placeholder="搜索活动线程…" aria-label="搜索活动线程" autocomplete="off"/><kbd>esc</kbd></div><div id="quick-list" role="listbox" aria-label="活动线程"></div><form id="reply-form"><span class="reply-arrow" aria-hidden="true">↳</span><input id="reply" placeholder="给选中的线程快速回复…" aria-label="快速回复" autocomplete="off"/><button id="send" type="submit" title="发送回复" aria-label="发送回复">↑</button></form><footer class="quick-footer"><span><span class="brand-mark">›_</span> Remote Codex</span><span><kbd>↑</kbd><kbd>↓</kbd> 选择 <kbd>↵</kbd> 打开</span></footer>`;
  const list = root.querySelector<HTMLDivElement>('#quick-list')!;
  const search = root.querySelector<HTMLInputElement>('#search')!;
  const reply = root.querySelector<HTMLInputElement>('#reply')!;
  const send = root.querySelector<HTMLButtonElement>('#send')!;
  const status = (message: string, error = false): void => {
    const footer = root.querySelector<HTMLElement>('.quick-footer')!;
    footer.dataset.error = String(error); footer.firstElementChild!.textContent = message;
  };
  const run = async (type: 'open' | 'reply'): Promise<void> => {
    if (!selected) return;
    send.disabled = true;
    try {
      const result = await localBridge().action(type === 'open' ? { type, key: selected } : { type, key: selected, text: reply.value });
      if (result.ok && type === 'reply') { reply.value = ''; status('回复已发送'); }
      else if (!result.ok) status(result.error || '操作失败，请重试', true);
    } catch { status('连接暂时不可用', true); }
    finally { send.disabled = false; }
  };
  const select = (key: string): void => {
    selected = key;
    for (const row of list.querySelectorAll<HTMLElement>('[role="option"]')) { const active = row.dataset.key === key; row.classList.toggle('selected', active); row.setAttribute('aria-selected', String(active)); }
    const item = visible.find(i => i.key === selected); reply.placeholder = item ? `回复「${item.title}」…` : '给选中的线程快速回复…';
  };
  const render = (): void => {
    const groups: [string, ActivityItem[]][] = [
      ['需要你', state.snapshot?.items.filter(i => i.state === 'needsInput' || i.state === 'failed' && i.unread) || []],
      ['进行中', state.snapshot?.items.filter(i => i.state === 'running') || []],
      ['刚完成', state.snapshot?.items.filter(i => i.state === 'completed' && i.unread) || []]
    ];
    for (const group of groups) group[1] = group[1].filter(i => `${i.title} ${i.deviceName} ${i.workspaceLabel}`.toLocaleLowerCase().includes(query));
    visible = groups.flatMap(([, items]) => items);
    if (!visible.some(i => i.key === selected)) selected = visible[0]?.key ?? null;
    const scrollTop = list.scrollTop;
    list.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement('div'); empty.className = 'quick-empty';
      const symbol = document.createElement('span'); symbol.className = 'empty-symbol'; symbol.textContent = query ? '⌕' : '✓';
      const title = document.createElement('strong'); title.textContent = query ? '没有找到匹配的线程' : '一切就绪，安静专注。';
      const description = document.createElement('p'); description.textContent = query ? '试试线程名、设备名或工作区。' : '活动线程会自动出现在这里。';
      empty.append(symbol, title, description); list.append(empty);
    }
    for (const [title, items] of groups) {
      if (!items.length) continue;
      const heading = document.createElement('h2'); heading.textContent = `${title}  ${items.length}`; list.append(heading);
      for (const item of items) {
        const row = document.createElement('div'); row.className = 'quick-row'; row.role = 'option'; row.tabIndex = -1; row.dataset.key = item.key;
        row.title = `${item.title}\n${item.deviceName} · ${item.workspaceLabel}`;
        const dot = document.createElement('span'); dot.className = `state-dot ${item.state}`; dot.setAttribute('aria-label', item.state);
        const copy = document.createElement('div'); copy.className = 'row-copy';
        const name = document.createElement('strong'); name.textContent = item.title;
        const meta = document.createElement('span'); meta.textContent = `${item.deviceName} · ${item.workspaceLabel}`;
        copy.append(name, meta);
        const detail = document.createElement('span'); detail.className = 'row-detail'; detail.textContent = item.request ? item.request.kind === 'approval' ? '审批' : '输入' : item.state === 'running' ? '进行中' : item.resultSummary || '已完成';
        row.append(dot, copy, detail);
        row.onclick = () => { select(item.key); void run('open'); };
        row.onmousemove = () => select(item.key);
        list.append(row);
      }
    }
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
  localBridge().onState(next => { state = next; render(); });
  render(); search.focus();
}
