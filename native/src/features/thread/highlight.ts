// Syntax colours for code blocks: highlight.js (pure JS) with a small language set,
// tokens mapped to the theme's palette. Unknown languages stay plain.
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import yaml from 'highlight.js/lib/languages/yaml';
import diff from 'highlight.js/lib/languages/diff';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import kotlin from 'highlight.js/lib/languages/kotlin';

const languages = { typescript, javascript, json, bash, python, rust, go, yaml, diff, css, xml, sql, swift, kotlin };
for (const [name, lang] of Object.entries(languages)) hljs.registerLanguage(name, lang);
const ALIASES: Record<string, string> = { ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', py: 'python', rs: 'rust', yml: 'yaml', html: 'xml', toml: 'yaml', kt: 'kotlin', patch: 'diff' };

export interface Token { text: string; scope: string | null }
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

/** Flat tokens with their innermost highlight.js scope; null when not highlightable. */
// Recycled transcript rows highlight the same blocks again; keep recent results.
const recent = new Map<string, Token[] | null>();
export function highlight(code: string, lang?: string | null): Token[] | null {
  const key = `${lang ?? ''}\u0000${code}`;
  if (recent.has(key)) { const hit = recent.get(key)!; recent.delete(key); recent.set(key, hit); return hit; }
  const tokens = highlightUncached(code, lang);
  recent.set(key, tokens);
  if (recent.size > 100) recent.delete(recent.keys().next().value!);
  return tokens;
}

function highlightUncached(code: string, lang?: string | null): Token[] | null {
  const name = lang ? (ALIASES[lang.toLowerCase()] ?? lang.toLowerCase()) : null;
  if (!name || !hljs.getLanguage(name) || code.length > 60_000) return null;
  let html: string;
  try { html = hljs.highlight(code, { language: name, ignoreIllegals: true }).value; } catch { return null; }
  const tokens: Token[] = [];
  const stack: string[] = [];
  const re = /<span class="([^"]+)">|<\/span>|([^<]+)/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[1]) stack.push(m[1].split(' ')[0]!.replace(/^hljs-/, ''));
    else if (m[0] === '</span>') stack.pop();
    else if (m[2]) tokens.push({ text: decode(m[2]), scope: stack.at(-1) ?? null });
  }
  return tokens;
}

export function scopeColor(scope: string | null, dark: boolean, terminal: boolean, accent: string): string | undefined {
  if (!scope) return undefined;
  if (terminal) return ['keyword', 'built_in', 'type', 'title'].includes(scope) ? accent : scope === 'comment' ? undefined : undefined;
  const light: Record<string, string> = { keyword: '#cf222e', string: '#0a3069', number: '#0550ae', literal: '#0550ae', comment: '#6e7781', title: '#8250df', 'title.function': '#8250df',
    built_in: '#953800', type: '#953800', attr: '#0550ae', variable: '#953800', params: '#24292f', meta: '#6e7781', addition: '#116329', deletion: '#82071e', property: '#0550ae', regexp: '#0a3069', tag: '#116329', name: '#116329' };
  const darkMap: Record<string, string> = { keyword: '#ff7b72', string: '#a5d6ff', number: '#79c0ff', literal: '#79c0ff', comment: '#8b949e', title: '#d2a8ff', 'title.function': '#d2a8ff',
    built_in: '#ffa657', type: '#ffa657', attr: '#79c0ff', variable: '#ffa657', params: '#c9d1d9', meta: '#8b949e', addition: '#aff5b4', deletion: '#ffdcd7', property: '#79c0ff', regexp: '#a5d6ff', tag: '#7ee787', name: '#7ee787' };
  return (dark ? darkMap : light)[scope];
}
