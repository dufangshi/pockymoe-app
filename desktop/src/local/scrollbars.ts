import { t } from '../shared/i18n';
// Approved local-UI exception: docs/ui-principles.md (Electron utility windows).
// Local DOM equivalent of the upstream overlay scrollbar. Native Electron
// utility windows stay independent of the remote React runtime.
export function enhanceScrollbars(root: HTMLElement): void {
  for (const element of root.querySelectorAll<HTMLElement>('[data-scroll]')) {
    if (element.parentElement?.classList.contains('scroll-frame')) continue;
    const frame = document.createElement('div'); frame.className = `scroll-frame ${element.classList.contains('pref-main') ? 'pref-frame' : ''}`;
    element.before(frame); frame.append(element);
    const track = document.createElement('div'); track.className = 'scroll-track';
    const thumb = document.createElement('div'); thumb.className = 'scroll-thumb'; thumb.tabIndex = 0; thumb.role = 'scrollbar';
    thumb.setAttribute('aria-label', t('滚动内容')); thumb.setAttribute('aria-orientation', 'vertical');
    track.append(thumb); frame.append(track);
    element.style.scrollbarWidth = 'none';
    const update = (): void => {
      const range = element.scrollHeight - element.clientHeight;
      track.hidden = range <= 1;
      const height = Math.max(24, track.clientHeight * element.clientHeight / Math.max(1, element.scrollHeight));
      thumb.style.height = `${height}px`;
      thumb.style.top = `${Math.max(0, track.clientHeight - height) * element.scrollTop / Math.max(1, range)}px`;
      thumb.setAttribute('aria-valuemin', '0'); thumb.setAttribute('aria-valuemax', String(Math.max(0, range))); thumb.setAttribute('aria-valuenow', String(Math.round(element.scrollTop)));
    };
    element.addEventListener('scroll', update, { passive: true });
    element.addEventListener('input', update);
    const resize = new ResizeObserver(update); resize.observe(element);
    const mutation = new MutationObserver(update); mutation.observe(element, { childList: true, subtree: true });
    thumb.onpointerdown = e => {
      e.preventDefault(); thumb.setPointerCapture(e.pointerId); frame.classList.add('scroll-dragging');
      const startY = e.clientY, initial = element.scrollTop;
      thumb.onpointermove = move => { element.scrollTop = initial + (move.clientY - startY) * (element.scrollHeight - element.clientHeight) / Math.max(1, track.clientHeight - thumb.clientHeight); };
      thumb.onpointerup = () => { thumb.onpointermove = null; frame.classList.remove('scroll-dragging'); };
    };
    thumb.onkeydown = e => {
      const distance = ({ ArrowDown: 40, ArrowUp: -40, PageDown: element.clientHeight, PageUp: -element.clientHeight, Home: -element.scrollHeight, End: element.scrollHeight } as Record<string, number>)[e.key];
      if (distance !== undefined) { e.preventDefault(); element.scrollTop += distance; }
    };
    const disconnected = new MutationObserver(() => { if (!frame.isConnected) { resize.disconnect(); mutation.disconnect(); disconnected.disconnect(); } });
    disconnected.observe(root, { childList: true, subtree: true });
    update();
  }
}
