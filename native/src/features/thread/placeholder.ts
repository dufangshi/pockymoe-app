// Prompt attachment placeholders, as the Web composer writes them (composerUtils
// buildAttachmentPlaceholder + normalizeAttachmentLabel); the Supervisor checks the prefix.
/** The Web composer's placeholder (`[PHOTO name]`, `[FILE name]`, numbered when a name repeats). */
export function attachmentPlaceholder(kind: 'photo' | 'file', name: string, used: Set<string>) {
  const label = name.replace(/[\r\n[\]]+/g, ' ').replace(/\s+/g, ' ').trim() || 'attachment';
  for (let n = 1; ; n++) {
    const placeholder = `[${kind === 'photo' ? 'PHOTO' : 'FILE'} ${n === 1 ? label : `${label} (${n})`}]`;
    if (!used.has(placeholder)) return placeholder;
  }
}

/**
 * What a sent prompt and its stored copy share: the Supervisor rewrites each placeholder into
 * the uploaded file's path, so markers count but their paths do not.
 */
export function promptMatchKey(text: string) {
  let markers = 0;
  const rest = text.replace(/\[(PHOTO|FILE)\s+[^\]]+\]/g, () => { markers += 1; return ''; }).replace(/\s+/g, ' ').trim();
  return `${rest}#${markers}`;
}
