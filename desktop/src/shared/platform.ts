import type { Appearance } from './contract';

/** Native chrome uses the same palette as the local renderer. Unknown packs use Classic. */
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
export function shortcutLabel(platform: string, key: string, shift = false): string {
  return platform === 'darwin' ? `⌘ / Ctrl ${shift ? '⇧ ' : ''}${key}` : `Ctrl+${shift ? 'Shift+' : ''}${key}`;
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
