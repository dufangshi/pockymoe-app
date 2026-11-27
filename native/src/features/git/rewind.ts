// The prompt Edit from here puts back in the composer (the Web's rewindPromptDraft): durable
// `[PHOTO path]` tokens become the composer's own placeholders.
import { attachmentPlaceholder } from '../thread/placeholder';

export interface RewindPrompt { text: string; attachments: { path: string; originalName: string; kind: 'photo' | 'file'; placeholder?: string; clientId?: string }[] }

/** The Web's rewindPromptDraft: durable `[PHOTO path]` tokens become composer placeholders. */
export function rewindDraftText(prompt: RewindPrompt) {
  let text = prompt.text;
  const used = new Set<string>();
  const placeholders = prompt.attachments.map(a => {
    const token = a.kind === 'photo' ? 'PHOTO' : 'FILE';
    // The composer's own placeholder, so the restored draft reads like a fresh one.
    const placeholder = a.placeholder || attachmentPlaceholder(a.kind, a.originalName, used);
    used.add(placeholder);
    const persisted = `[${token} ${a.path}]`;
    text = text.includes(persisted) ? text.replaceAll(persisted, placeholder) : text.includes(placeholder) ? text : `${text}\n${placeholder}`;
    return placeholder;
  });
  return { text, placeholders };
}

