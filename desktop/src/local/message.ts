import type { LocalMessage } from '../shared/local';
import { getLocale, localizeMessage } from '../shared/i18n';
import { enhanceScrollbars } from './scrollbars';
let rendered = '';
/** The local equivalent of the shared modal: HTML dialog supplies focus trapping and restoration. */
export function renderMessage(message: LocalMessage | null | undefined, respond: (id: number, response: number) => void): void {
  const signature = JSON.stringify([message, getLocale()]);
  if (rendered === signature) return;
  rendered = signature;
  const previous = document.querySelector<HTMLDialogElement>('dialog.local-message');
  previous?.close(); previous?.remove();
  if (!message) return;
  const dialog = document.createElement('dialog'); dialog.className = 'local-message';
  dialog.setAttribute('aria-labelledby', 'message-title'); dialog.setAttribute('aria-describedby', 'message-body');
  const title = document.createElement('h1'); title.id = 'message-title'; title.textContent = localizeMessage(message.title);
  const content = document.createElement('div'); content.id = 'message-body'; content.setAttribute('data-scroll', '');
  const body = document.createElement('p'); body.textContent = localizeMessage(message.message);
  const detail = document.createElement('p'); detail.textContent = localizeMessage(message.detail);
  content.append(body, detail);
  const buttons = document.createElement('div'); buttons.className = 'message-buttons';
  message.buttons.forEach((label, index) => {
    const button = document.createElement('button'); button.textContent = localizeMessage(label);
    if (index !== message.cancelId) button.className = 'primary';
    button.onclick = () => respond(message.id, index); buttons.append(button);
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); respond(message.id, message.cancelId); });
  dialog.append(title, content, buttons); document.body.append(dialog); enhanceScrollbars(dialog);
  dialog.showModal(); buttons.querySelectorAll('button')[message.defaultId]?.focus();
}
