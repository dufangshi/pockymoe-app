// Local equivalent of shared Select: isolated utility windows cannot load React.
import { enhanceScrollbars } from './scrollbars';
export interface SelectOption { value: string; label: string; description?: string; image?: string; rows?: number }
export function mountSelect(trigger: HTMLButtonElement, options: SelectOption[], value: string, change: (value: string) => void): () => void {
  let popup: HTMLDivElement | null = null, index = Math.max(0, options.findIndex(option => option.value === value));
  let typeahead = '', typedAt = 0;
  trigger.classList.add('custom-select'); trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
  const label = document.createElement('span'); label.textContent = options.find(option => option.value === value)?.label || value;
  const arrow = document.createElement('span'); arrow.className = 'select-arrow'; arrow.textContent = '⌄'; arrow.ariaHidden = 'true';
  trigger.replaceChildren(label, arrow);
  const close = (focus = false): void => {
    popup?.remove(); popup = null; trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', position); document.removeEventListener('scroll', position, true);
    if (focus && trigger.isConnected) trigger.focus();
  };
  const position = (): void => {
    if (!popup) return;
    const box = trigger.getBoundingClientRect();
    if (box.bottom <= 0 || box.top >= innerHeight || !trigger.isConnected) { close(); return; }
    const width = Math.min(Math.max(box.width, options.some(option => option.image) ? 270 : 180), innerWidth - 16);
    popup.style.width = `${width}px`; popup.style.left = `${Math.min(Math.max(8, box.right - width), innerWidth - width - 8)}px`;
    const below = innerHeight - box.bottom - 12, above = box.top - 12;
    const down = below >= Math.min(popup.scrollHeight, 240) || below >= above;
    popup.style.maxHeight = `${Math.max(40, Math.min(320, down ? below : above))}px`;
    popup.style.top = down ? `${box.bottom + 4}px` : 'auto'; popup.style.bottom = down ? 'auto' : `${innerHeight - box.top + 4}px`;
  };
  const outside = (event: PointerEvent): void => { if (!popup?.contains(event.target as Node) && !trigger.contains(event.target as Node)) close(); };
  const focus = (): void => {
    const rows = popup?.querySelectorAll<HTMLElement>('[role=option]');
    rows?.forEach((row, at) => { row.tabIndex = at === index ? 0 : -1; });
    rows?.[index]?.focus({ preventScroll: true }); rows?.[index]?.scrollIntoView({ block: 'nearest' });
  };
  const open = (): void => {
    if (popup || trigger.disabled || !options.length) return;
    popup = document.createElement('div'); popup.className = 'select-popover'; popup.role = 'listbox';
    popup.id = `${trigger.id}-options`; trigger.setAttribute('aria-controls', popup.id);
    popup.setAttribute('aria-label', trigger.getAttribute('aria-label') || trigger.labels?.[0]?.textContent || '');
    const list = document.createElement('div'); list.dataset.scroll = ''; list.className = 'select-options'; popup.append(list);
    for (const [at, option] of options.entries()) {
      const row = document.createElement('button'); row.type = 'button'; row.role = 'option'; row.className = 'select-option'; row.tabIndex = -1;
      row.setAttribute('aria-selected', String(option.value === value)); row.dataset.value = option.value;
      if (option.image) {
        const frame = document.createElement('span'); frame.className = 'pet-thumbnail';
        const image = document.createElement('img'); image.src = option.image; image.alt = ''; image.style.height = `${(option.rows || 9) * 100}%`; frame.append(image); row.append(frame);
      }
      const copy = document.createElement('span'); copy.className = 'option-copy';
      const name = document.createElement('span'); name.textContent = option.label; copy.append(name);
      if (option.description) { const description = document.createElement('small'); description.textContent = option.description; copy.append(description); }
      const check = document.createElement('span'); check.className = 'select-check'; check.textContent = option.value === value ? '✓' : ''; check.ariaHidden = 'true';
      row.append(copy, check); row.onclick = () => { close(true); change(option.value); }; row.onpointermove = () => { index = at; };
      list.append(row);
    }
    popup.onkeydown = event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length; focus();
      } else if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); event.stopPropagation(); close(true); }
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== ' ') {
        typeahead = Date.now() - typedAt > 700 ? event.key : typeahead + event.key; typedAt = Date.now();
        const found = options.findIndex(option => option.label.toLocaleLowerCase().startsWith(typeahead.toLocaleLowerCase()));
        if (found >= 0) { event.preventDefault(); index = found; focus(); }
      }
    };
    document.body.append(popup); enhanceScrollbars(popup); position(); focus(); trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true); window.addEventListener('resize', position); document.addEventListener('scroll', position, true);
  };
  trigger.onclick = () => { if (popup) close(true); else open(); };
  trigger.onkeydown = event => { if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); open(); if (event.key === 'End') index = options.length - 1; else if (event.key === 'Home') index = 0; focus(); } };
  return () => close();
}
