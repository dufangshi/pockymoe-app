import { getLocale, translate } from '../../i18n';

/** A file's family picks its glyph color and how its kind is named. */
export type FileFamily = 'pdf' | 'image' | 'archive' | 'code' | 'text' | 'sheet' | 'audio' | 'video' | 'doc' | 'other';

const families: [FileFamily, RegExp][] = [
  ['pdf', /^pdf$/],
  ['image', /^(png|jpe?g|gif|webp|svg|bmp|heic|heif|avif|ico|tiff?)$/],
  ['archive', /^(zip|tar|gz|tgz|bz2|xz|7z|rar|zst)$/],
  ['sheet', /^(csv|tsv|xlsx?|ods|numbers)$/],
  ['doc', /^(docx?|odt|rtf|pages|pptx?|key)$/],
  ['audio', /^(mp3|wav|m4a|flac|ogg|aac)$/],
  ['video', /^(mp4|mov|webm|mkv|avi)$/],
  ['text', /^(md|markdown|txt|log|rst)$/],
  ['code', /^(js|jsx|ts|tsx|mjs|cjs|py|rs|go|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|sh|bash|zsh|ps1|json|jsonc|ya?ml|toml|ini|xml|html?|css|scss|sql|lua|dart|vue|svelte|pockytheme)$/],
];

export function fileExtension(name: string) {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : null;
}

export function fileFamily(name: string, kind?: 'photo' | 'file', mime?: string): FileFamily {
  if (kind === 'photo' || mime?.startsWith('image/')) return 'image';
  const extension = fileExtension(name);
  return (extension && families.find(([, pattern]) => pattern.test(extension))?.[0]) || 'other';
}

/** The extension as a short badge ("PDF"), or nothing for a name without one. */
export function fileBadge(name: string) {
  const extension = fileExtension(name);
  return extension && extension.length <= 5 ? extension.toUpperCase() : null;
}

// A wide (CJK or full-width) character takes about two narrow ones.
const charWidth = (char: string) => (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u.test(char) ? 2 : 1);
const textWidth = (text: string) => [...text].reduce((sum, char) => sum + charWidth(char), 0);
const takeWidth = (chars: string[], budget: number) => {
  const kept: string[] = [];
  for (const char of chars) {
    if (budget < charWidth(char)) break;
    budget -= charWidth(char);
    kept.push(char);
  }
  return kept;
};

/** "osfi_cgg_node357.pdf" reads "osfi…357.pdf" in a tile: the start, the last few
    characters and the extension stay, measured in narrow characters. */
export function shortFileName(name: string, max = 11) {
  if (textWidth(name) <= max) return name;
  const extension = fileExtension(name);
  const tail = extension && extension.length <= 5 ? `.${extension}` : '';
  const stem = [...name.slice(0, name.length - tail.length)];
  const room = Math.max(2, max - tail.length - 1);
  const end = takeWidth([...stem].reverse(), Math.min(3, Math.floor(room / 3))).reverse();
  const start = takeWidth(stem, room - textWidth(end.join('')));
  return `${start.join('')}…${end.join('')}${tail}`;
}

export function formatFileSize(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toLocaleString(getLocale(), { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`;
}

export function fileKindLabel(name: string, family: FileFamily) {
  if (family === 'image') return translate('chat.attachmentImage');
  const badge = fileBadge(name);
  return badge ? translate('chat.attachmentFileOf', { kind: badge }) : translate('chat.attachmentFile');
}

/** A page with a folded corner; its colors come from the tile's file family. */
export const FILE_GLYPH_SVG = '<svg class="attachment-glyph" viewBox="0 0 28 34" aria-hidden="true">'
  + '<path class="attachment-glyph-sheet" d="M5 1.5h12.5L26 10v19.5a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-25a3 3 0 0 1 3-3z"/>'
  + '<path class="attachment-glyph-fold" d="M17.5 1.5V7a3 3 0 0 0 3 3H26"/></svg>';
