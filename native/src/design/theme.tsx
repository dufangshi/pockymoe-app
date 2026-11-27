// Theme: one of the Web's three presets (Classic, Plum Pocket, Terminal) in light or dark
// mode. Palettes come from the Web's CSS (tokens.generated.ts); presets change appearance
// only. Preferences use the Web's storage keys so the meaning is the same.
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { generatedTokens } from './tokens.generated';
import { ensureContrast, ensureFill } from './contrast';
import { prefs } from '../platform/prefs';
import { createStore } from '../state/store';

export type PresetId = 'classic' | 'plum-pocket' | 'terminal';
export type ModePref = 'system' | 'light' | 'dark';
export const PRESETS: PresetId[] = ['classic', 'plum-pocket', 'terminal'];

const PRESET_KEY = 'pockymoe-theme-preset';
const MODE_KEY = 'remote-codex-theme-mode';
const readPreset = (): PresetId => { const v = prefs.get(PRESET_KEY); return PRESETS.includes(v as PresetId) ? v as PresetId : 'classic'; };
const readMode = (): ModePref => { const v = prefs.get(MODE_KEY); return v === 'light' || v === 'dark' ? v : 'system'; };
export const themePrefs = createStore({ preset: readPreset(), mode: readMode(), oneHand: prefs.get('pockymoe-native.one-hand') !== 'off' });
export function setPreset(preset: PresetId) { prefs.set(PRESET_KEY, preset); themePrefs.set({ preset }); }
export function setModePref(mode: ModePref) { prefs.set(MODE_KEY, mode === 'system' ? null : mode); themePrefs.set({ mode }); }
export function setOneHand(on: boolean) { prefs.set('pockymoe-native.one-hand', on ? 'on' : 'off'); themePrefs.set({ oneHand: on }); }

type Generated = typeof generatedTokens.classic.light;
const pick = (t: Record<string, string>, key: string, fallback: string) => t[key] ?? fallback;

function colors(preset: PresetId, mode: 'light' | 'dark') {
  const t = generatedTokens[preset][mode] as unknown as Record<string, string> & Generated;
  const dark = mode === 'dark';
  const base = {
    bg: t.bg, panel: t.panel, workspace: t.workspace, surface: t.surface, muted: t.muted, hover: t.hover,
    border: t.border, borderStrong: t.borderStrong, borderContrast: t.borderContrast,
    fg: t.fg, fgSoft: t.fgSoft, fgMuted: t.fgMuted,
    primary: t.primary, primaryPressed: t.primaryHover, primaryFg: t.primaryFg,
    accentSoft: t.accentSoft, accentStrong: t.accentStrong, accentBorder: t.accentBorder,
    chrome: t.chrome ?? t.bg,
    success: pick(t, 'successFg', dark ? '#98ddb4' : '#004721'), successBg: pick(t, 'successBg', 'transparent'),
    warning: pick(t, 'warningFg', dark ? '#ffd69a' : '#683700'), warningBg: pick(t, 'warningBg', 'transparent'), warningBorder: pick(t, 'warningBorder', t.border),
    danger: pick(t, 'dangerFg', dark ? '#ffc2c0' : '#830a21'), dangerBg: pick(t, 'dangerBg', 'transparent'), dangerBorder: pick(t, 'dangerBorder', t.border),
    // Solid fill under white text on a destructive button: ≥ 4.5:1 in both modes.
    dangerSolid: dark ? '#c43c44' : '#c0313b',
    info: pick(t, 'infoFg', dark ? '#92d7ed' : '#004c6e'), infoBg: pick(t, 'infoBg', 'transparent'),
    // Status marks (shared UI matter-workbench.css; docs/ui-principles.md §6).
    running: dark ? '#8fb8ff' : '#2a5fd4',
    agents: dark ? '#b39af2' : '#8066cd',
    waiting: dark ? '#edb75d' : '#b77915',
    interrupted: '#c08a3e',
    failed: '#d56b62',
    online: pick(t, 'successFg', dark ? '#98ddb4' : '#004721'),
    scrim: dark ? 'rgba(0,0,0,0.6)' : 'rgba(20,24,22,0.38)',
    // The Web's prompt bubble (history-markdown.css: oklch(.925 .004 255) / oklch(.265 .005 255)).
    userBubble: dark ? '#242528' : '#e4e6e9', userBubbleFg: t.fg,
    code: dark ? '#0a0d0f' : '#f4f6f4', codeFg: t.fg,
    link: t.accentStrong,
    sheet: t.panel,
    /** The primary colour as a fill under primaryFg text (buttons); `primary` stays for marks and borders. */
    primarySolid: t.primary,
  };
  let out: { [K in keyof typeof base]: string } & { stitch?: string } = base;
  if (preset === 'plum-pocket') {
    out = { ...base, userBubble: t.plumUserBubble ?? base.userBubble, userBubbleFg: t.plumUserBubbleFg ?? base.userBubbleFg,
      chrome: t.plumChrome ?? base.chrome, code: dark ? '#160c1c' : '#fffaf1', stitch: t.plumStitch ?? t.primary };
  }
  if (preset === 'terminal') {
    out = { ...base, success: t.termOk ?? base.success, danger: t.termDanger ?? base.danger, warning: t.termWarn ?? base.warning,
      border: t.termLine ?? base.border, code: t.termSunken ?? base.code, userBubble: 'transparent', running: t.primary };
  }
  // Readable on every surface (WCAG): text colours reach 4.5:1, marks 3:1, and fills that
  // carry text reach 4.5:1 under it. Only colours that fall short move, and only in lightness.
  const surfaces = [out.bg, out.panel, out.surface, out.sheet];
  return {
    ...out,
    accentStrong: ensureContrast(out.accentStrong, surfaces, 4.5),
    link: ensureContrast(out.link, surfaces, 4.5),
    danger: ensureContrast(out.danger, surfaces, 4.5),
    fgMuted: ensureContrast(out.fgMuted, surfaces, 3),
    running: ensureContrast(out.running, surfaces, 3), waiting: ensureContrast(out.waiting, surfaces, 3),
    failed: ensureContrast(out.failed, surfaces, 3), interrupted: ensureContrast(out.interrupted, surfaces, 3),
    agents: ensureContrast(out.agents, surfaces, 3), online: ensureContrast(out.online, surfaces, 3),
    primarySolid: ensureFill(out.primary, out.primaryFg, 4.5),
  };
}
export type Colors = ReturnType<typeof colors>;

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' })!;
function fonts(preset: PresetId) {
  if (preset === 'terminal') return { regular: mono, medium: mono, semibold: mono, bold: mono, display: mono, mono, monoBold: mono };
  if (preset === 'plum-pocket') return { regular: 'Nunito_400Regular', medium: 'Nunito_600SemiBold', semibold: 'Nunito_700Bold', bold: 'Nunito_800ExtraBold', display: 'Fredoka_600SemiBold', mono, monoBold: mono };
  return { regular: 'DMSans_400Regular', medium: 'DMSans_500Medium', semibold: 'DMSans_600SemiBold', bold: 'DMSans_700Bold', display: 'DMSans_700Bold', mono, monoBold: mono };
}
function radius(preset: PresetId) {
  if (preset === 'terminal') return { xs: 0, sm: 0, md: 0, lg: 0, xl: 0, sheet: 0, pill: 0 };
  if (preset === 'plum-pocket') return { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, sheet: 26, pill: 999 };
  return { xs: 4, sm: 7, md: 10, lg: 14, xl: 18, sheet: 20, pill: 999 };
}

export interface Theme {
  preset: PresetId;
  mode: 'light' | 'dark';
  c: Colors;
  font: ReturnType<typeof fonts>;
  radius: ReturnType<typeof radius>;
  /** Terminal draws hairlines and glyph markers instead of bubbles and avatars. */
  terminal: boolean;
  plum: boolean;
}
export function makeTheme(preset: PresetId, mode: 'light' | 'dark'): Theme {
  return { preset, mode, c: colors(preset, mode), font: fonts(preset), radius: radius(preset), terminal: preset === 'terminal', plum: preset === 'plum-pocket' };
}

const ThemeContext = createContext<Theme>(makeTheme('classic', 'light'));
export function ThemeProvider({ children, override }: { children: ReactNode; override?: { preset: PresetId; mode: 'light' | 'dark' } }) {
  const { preset, mode } = themePrefs.useValue(s => s, (a, b) => a.preset === b.preset && a.mode === b.mode);
  const system = useColorScheme();
  const effective = override?.mode ?? (mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode);
  const theme = useMemo(() => makeTheme(override?.preset ?? preset, effective), [override?.preset, preset, effective]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);
