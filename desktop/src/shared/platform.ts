import type { Appearance } from './contract';

/** Local windows and native fallbacks share this palette. Unknown packs use Classic. */
export function windowPalette(appearance: Appearance | null, dark = false): { background: string; foreground: string } {
  const mode = appearance?.effective ?? (dark ? 'dark' : 'light');
  const palettes: Record<string, Record<string, [string, string]>> = {
    classic: { light: ['#f8f8f7', '#252527'], dark: ['#232325', '#e9e8e6'] },
    'plum-pocket': { light: ['#fbf4e8', '#2e1a35'], dark: ['#1b1022', '#f5e9d6'] },
    terminal: { light: ['#ffffff', '#0a0a0a'], dark: ['#0b0d0c', '#e9efe9'] }
  };
  const [background, foreground] = (palettes[appearance?.pack ?? 'classic'] ?? palettes.classic)[mode];
  return { background, foreground };
}
export function windowsMaterial(release: string): 'mica' | 'none' {
  const [major, , build] = release.split('.').map(Number);
  return major >= 10 && build >= 22621 ? 'mica' : 'none';
}
export function windowsGlassMaterial(release: string, forceSolid = false): 'acrylic' | 'solid' {
  return !forceSolid && windowsMaterial(release) === 'mica' ? 'acrylic' : 'solid';
}
const codeKeys: Record<string, string> = { Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`' };
/** The Electron accelerator for a pressed combination, or null while it is incomplete.
 * Uses the physical key (event.code) so Alt/Option combinations on any layout still name the key. */
export function acceleratorFromKey(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, platform: string): string | null {
  const code = event.code;
  const key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : /^F([1-9]|1\d|2[0-4])$/.test(code) ? code : codeKeys[code];
  if (!key) return null;
  const mac = platform === 'darwin';
  const modifiers = [
    ...(mac ? [event.metaKey ? 'CommandOrControl' : '', event.ctrlKey ? 'Control' : ''] : [event.ctrlKey ? 'CommandOrControl' : '', event.metaKey ? 'Super' : '']),
    event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : ''
  ].filter(Boolean);
  // A global shortcut without a modifier would swallow ordinary typing everywhere; F-keys are the exception.
  if (!modifiers.length && !/^F\d+$/.test(key)) return null;
  return [...modifiers, key].join('+');
}
/** Key caps for an accelerator, in the platform's own names. */
export function acceleratorKeys(accelerator: string, platform: string): string[] {
  const mac = platform === 'darwin';
  const names: Record<string, string> = mac
    ? { commandorcontrol: '⌘', cmdorctrl: '⌘', command: '⌘', cmd: '⌘', control: '⌃', ctrl: '⌃', alt: '⌥', option: '⌥', shift: '⇧', super: '⌘' }
    : { commandorcontrol: 'Ctrl', cmdorctrl: 'Ctrl', control: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', super: 'Win', meta: 'Win' };
  return accelerator.split('+').map(part => part.trim()).filter(Boolean).map(part => names[part.toLowerCase()] ?? part);
}
/** Windows paths are untrusted filenames too, even when supplied by a Unix server. */
export function windowsReservedName(name: string): boolean {
  return /^(con|conin\$|conout\$|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i.test(name.split('.')[0].trimEnd()) || /[ .]$/.test(name);
}
const windowsInvalidCharacters = new RegExp('[<>:"|?*' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + ']', 'g');
export function windowsUnsafeName(name: string): boolean {
  return windowsReservedName(name) || [...name].some(char => char.charCodeAt(0) < 32 || '<>:"|?*'.includes(char));
}
export function saveName(name: string, platform: string): string {
  if (platform !== 'win32') return name.split('/').pop()?.slice(0, 255) || 'download';
  const leaf = name.split(/[\\/]/).pop()?.replace(windowsInvalidCharacters, '_').slice(0, 255).replace(/[ .]+$/, '') || 'download';
  return windowsReservedName(leaf) ? `_${leaf}`.slice(0, 255) : leaf;
}

/** Keep Windows glass text legible even when Acrylic sits over a white window. */
export function windowsPanelPalette(appearance: Appearance | null): { background: string; foreground: string; muted: string } {
  const palette = windowPalette(appearance);
  const dark = appearance?.effective === 'dark';
  const muted = appearance?.pack === 'plum-pocket' ? dark ? '#b9a2c0' : '#6e5875'
    : appearance?.pack === 'terminal' ? dark ? '#93a09a' : '#5a5a55' : dark ? '#b2b5be' : '#55545a';
  return { ...palette, muted };
}
