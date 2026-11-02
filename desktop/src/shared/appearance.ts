import { windowsPanelPalette } from './platform';
import { getLocale, setLocale } from './i18n';
import type { Appearance } from './contract';
let latest: Appearance | null = null;
let watching = false;
export function applyAppearance(appearance: Appearance | null): void {
  latest = appearance;
  if (appearance?.locale) setLocale(appearance.locale);
  if (!watching) { watching = true; matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!latest) applyAppearance(null); }); }
  const root = document.documentElement;
  root.lang = getLocale();
  root.dataset.themeEffective = appearance?.effective || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  root.dataset.themePreset = appearance?.pack || 'classic';
  root.style.colorScheme = root.dataset.themeEffective;
  if (appearance && CSS.supports('color', appearance.accent)) {
    root.style.setProperty('--theme-accent-solid', appearance.accent);
    root.style.setProperty('--theme-accent-soft', `color-mix(in srgb, ${appearance.accent} 16%, transparent)`);
  } else { root.style.removeProperty('--theme-accent-solid'); root.style.removeProperty('--theme-accent-soft'); }
  if (root.dataset.platform === 'win32') {
    const palette = windowsPanelPalette({ effective: root.dataset.themeEffective as 'light' | 'dark', pack: root.dataset.themePreset, accent: appearance?.accent || '#a57224' });
    root.style.setProperty('--windows-panel-bg', palette.background);
    root.style.setProperty('--windows-panel-fg', palette.foreground);
    root.style.setProperty('--windows-panel-muted', palette.muted);
  }
  root.style.fontSize = `${13 * (appearance?.fontScale || 1)}px`;
}
