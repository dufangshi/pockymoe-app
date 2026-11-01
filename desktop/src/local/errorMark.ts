// Approved Electron local-UI exception in docs/ui-principles.md: same ErrorMark
// behavior as upstream, without importing the remote React runtime.
export function showError(container: HTMLElement, message: string, retry?: () => void): void {
  const label = document.createElement('span'); label.textContent = '操作失败';
  const button = document.createElement('button'); button.className = 'error-mark'; button.type = 'button'; button.textContent = '!';
  button.setAttribute('aria-label', `查看错误原因：${message}`); button.setAttribute('aria-expanded', 'false');
  container.replaceChildren(label, button);
  let popup: HTMLDivElement | undefined;
  const close = (restore = false): void => {
    popup?.remove(); popup = undefined; button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', outside); document.removeEventListener('keydown', key, true);
    window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); observer.disconnect();
    if (restore && button.isConnected) button.focus();
  };
  const position = (): void => {
    const rect = button.getBoundingClientRect();
    if (!button.isConnected || rect.bottom < 0 || rect.top > innerHeight) { close(); return; }
    if (popup) { popup.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - popup.offsetWidth - 12))}px`; popup.style.top = `${Math.max(12, Math.min(rect.bottom + 6, innerHeight - popup.offsetHeight - 12))}px`; }
  };
  const outside = (e: MouseEvent): void => { if (!popup?.contains(e.target as Node) && e.target !== button) close(); };
  const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(true); } };
  const observer = new MutationObserver(() => { if (!button.isConnected) close(); });
  button.onclick = () => {
    if (popup) { close(); return; }
    popup = document.createElement('div'); popup.className = 'error-popover'; popup.role = 'note';
    const detail = document.createElement('p'); detail.textContent = message; popup.append(detail);
    if (retry) { const again = document.createElement('button'); again.textContent = '重试'; again.onclick = () => { close(); retry(); }; popup.append(again); }
    document.body.append(popup); button.setAttribute('aria-expanded', 'true'); position();
    document.addEventListener('click', outside); document.addEventListener('keydown', key, true);
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true); observer.observe(document.body, { childList: true, subtree: true });
  };
}
