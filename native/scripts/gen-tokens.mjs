#!/usr/bin/env node
// Generates src/design/tokens.generated.ts from the Web's theme CSS, so the native client
// uses the same palette as Classic, Plum Pocket and Terminal in light and dark mode.
//   node scripts/gen-tokens.mjs <runtime checkout> <thread-ui checkout>
// Sources: apps/supervisor-web/src/matter-theme.css and index.css (Classic page tokens,
// status colours), the shared UI's styles/matter-workbench.css (Classic workbench tokens)
// and themes/<pack>/styles/tokens.css. Colours become #rrggbb or rgba().
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [runtime, threadUi] = process.argv.slice(2).map(p => p && resolve(p));
if (!runtime || !threadUi) { console.error('usage: gen-tokens.mjs <runtime> <thread-ui>'); process.exit(2); }

/** Blocks `selector { --name: value; ... }` at top level (nested @media is skipped). */
function blocks(css) {
  // Comments, quoted strings and at-rule statements can hold braces; none carry tokens.
  // At-rule statements (`@source "src/**/*.{ts}"`) and quoted strings can hold comment
  // openers and braces; none carry tokens.
  css = css.replace(/^@(?:source|import|plugin|config|custom-variant)\b[^\n]*;[ \t]*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, m => m.replace(/[{}]/g, ' '));
  const out = []; let depth = 0, start = 0, selector = '';
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') { if (depth === 0) { selector = css.slice(start, i).split(';').pop().trim(); start = i + 1; } depth++; }
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) {
        const body = css.slice(start, i), vars = {};
        if (!selector.startsWith('@')) for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
        out.push({ selector, vars }); start = i + 1;
      }
    }
  }
  return out;
}
const mode = selector => /dark/.test(selector) ? 'dark' : /light/.test(selector) ? 'light' : null;

// ---- colour conversion -----------------------------------------------------------------
function oklchToRgb(l, c, h) {
  const a = c * Math.cos(h * Math.PI / 180), b = c * Math.sin(h * Math.PI / 180);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b, m_ = l - 0.1055613458 * a - 0.0638541728 * b, s_ = l - 0.0894841775 * a - 1.2914855480 * b;
  const L = l_ ** 3, M = m_ ** 3, S = s_ ** 3;
  const lin = [4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S, -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S, -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S];
  return lin.map(v => { const x = Math.max(0, Math.min(1, v)); return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)); });
}
const hex = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
function color(value) {
  value = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(value)) {
    let h = value.slice(1).toLowerCase();
    if (h.length === 3) h = [...h].map(c => c + c).join('');
    return '#' + h;
  }
  let m = value.match(/^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?))?\s*\)$/i);
  if (m) {
    const l = m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
    const rgb = oklchToRgb(l, parseFloat(m[2]), parseFloat(m[3]));
    const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return alpha >= 1 ? hex(rgb) : `rgba(${rgb.join(', ')}, ${+alpha.toFixed(3)})`;
  }
  m = value.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[/,]\s*([\d.]+%?))?\s*\)$/i);
  if (m) {
    const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return alpha >= 1 ? hex([+m[1], +m[2], +m[3]]) : `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${+alpha.toFixed(3)})`;
  }
  return null;
}

// ---- collection ------------------------------------------------------------------------
const WORKBENCH = { bg: 'bg', panel: 'panel', workspace: 'workspace', surface: 'surface', muted: 'muted', hover: 'hover', border: 'border',
  borderStrong: 'border-strong', borderContrast: 'border-contrast', fg: 'fg', fgSoft: 'fg-soft', fgMuted: 'fg-muted', primary: 'primary',
  primaryHover: 'primary-hover', primaryFg: 'primary-fg', accentSoft: 'accent-soft', accentStrong: 'accent-strong', accentBorder: 'accent-border' };
const PAGE = { pageBg: '--app-bg', pageFg: '--app-fg', pagePanel: '--theme-panel', pageSurface: '--theme-surface', chrome: '--matter-chrome' };
const STATUS = ['info', 'success', 'warning', 'danger', 'neutral'].flatMap(k => ['bg', 'border', 'fg'].map(p => [`${k}${p[0].toUpperCase()}${p.slice(1)}`, `--status-${k}-${p}`]));

function collect(files, defaults) {
  const out = { light: {}, dark: {} };
  for (const { file, kind } of files) {
    for (const block of blocks(readFileSync(file, 'utf8'))) {
      const isShell = /thread-ui-shell|thread-graph-dialog/.test(block.selector);
      // A workbench block without a mode is the light palette (the shared UI default).
      const m = mode(block.selector) ?? (isShell ? 'light' : defaults[kind]);
      if (!m) continue;
      const isRoot = /^:root/.test(block.selector) && !isShell;
      if (kind === 'status' && !/^:root|^\.dark|^html/.test(block.selector)) continue;
      for (const [name, value] of Object.entries(block.vars)) {
        if (isShell && name.startsWith('--thread-gc-')) out[m][`gc:${name.slice(12)}`] = value;
        else if ((isRoot || kind === 'status') && (Object.values(PAGE).includes(name) || name === '--matter-chrome' || name.startsWith('--status-') || name.startsWith('--plum-') || name.startsWith('--term-')))
          out[m][name] = value;
        else if (isShell && name === '--matter-chrome' && kind !== 'pack') out[m]['gc:chrome'] = value;
      }
    }
  }
  return out;
}
function resolveVars(map, scope) {
  const get = name => { let v = map[name]; for (let i = 0; i < 5 && v && /^var\(/.test(v); i++) v = map[v.match(/^var\((--[\w-]+)/)[1]]; return v; };
  const tokens = {};
  for (const [key, name] of Object.entries(WORKBENCH)) { const v = scope[`gc:${name}`] ?? map[`gc:${name}`]; const c = v && color(v); if (c) tokens[key] = c; }
  for (const [key, name] of Object.entries(PAGE)) { const v = get(name); const c = v && color(v); if (c) tokens[key] = c; }
  for (const [key, name] of STATUS) { const v = get(name); const c = v && color(v); if (c) tokens[key] = c; }
  // A pack's page chrome wins over Classic's workbench chrome.
  const chromeValue = scope['--matter-chrome'] ?? map['gc:chrome'];
  const chrome = chromeValue && color(chromeValue); if (chrome) tokens.chrome = chrome;
  const extras = {};
  for (const [name, value] of Object.entries(map)) if (/^--(plum|term)-/.test(name)) { const c = color(get(name) ?? value); if (c) extras[name.slice(2).replace(/-(\w)/g, (_m, ch) => ch.toUpperCase())] = c; }
  return { ...tokens, ...extras };
}

const web = join(runtime, 'apps/supervisor-web/src'), ui = join(threadUi, 'packages/thread-ui/src/styles'), themes = join(runtime, 'themes');
const classic = collect([
  { file: join(web, 'index.css'), kind: 'status' },
  { file: join(web, 'matter-theme.css'), kind: 'page' },
  { file: join(ui, 'matter-workbench.css'), kind: 'shell' },
], { page: 'dark', shell: 'light', status: 'dark' });
const pack = id => collect([{ file: join(themes, id, 'styles/tokens.css'), kind: 'pack' }], { pack: 'dark' });
const presets = { classic, 'plum-pocket': pack('plum-pocket'), terminal: pack('terminal') };
const result = {};
for (const [id, maps] of Object.entries(presets)) {
  result[id] = {};
  for (const m of ['light', 'dark']) {
    // Packs inherit Classic's status colours and anything they do not set.
    const merged = { ...classic[m], ...maps[m] };
    result[id][m] = resolveVars(merged, maps[m]);
  }
}
const sha = dir => execFileSync('git', ['-C', dir, 'rev-parse', '--short=8', 'HEAD'], { encoding: 'utf8' }).trim();
const out = `// Generated by scripts/gen-tokens.mjs from dufangshi/pockymoe@${sha(runtime)} and
// dufangshi/pockymoe-thread-ui-rust@${sha(threadUi)}. Do not edit; regenerate instead.
export const generatedTokens = ${JSON.stringify(result, null, 2)} as const;
`;
writeFileSync(join(root, 'src/design/tokens.generated.ts'), out);
for (const [id, modes] of Object.entries(result)) for (const [m, t] of Object.entries(modes)) console.log(id, m, Object.keys(t).length, 'tokens');
