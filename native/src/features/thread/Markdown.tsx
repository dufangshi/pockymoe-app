// Markdown for replies and prompts, rendered with native Text and Views from marked's
// tokens. Code blocks scroll sideways and copy on tap; tables scroll sideways; links
// open in the browser. Nothing here is a WebView.
import { memo, useMemo, useState } from 'react';
import { Linking, ScrollView, View, type TextStyle } from 'react-native';
import { Lexer, type Token, type Tokens } from 'marked';
import { AppText } from '../../design/AppText';
import { CopyButton } from '../../design/Copy';
import { Press } from '../../design/Press';
import { Sheet } from '../../design/Sheet';
import { useTheme, type Theme } from '../../design/theme';
import { highlight, scopeColor } from './highlight';
import { withAlpha } from '../../design/contrast';
import { translate } from '../../i18n';

const lex = (text: string) => { try { return Lexer.lex(text, { gfm: true, breaks: false }); } catch { return [{ type: 'paragraph', raw: text, text, tokens: [{ type: 'text', raw: text, text }] }] as Token[]; } };
// The transcript list recycles rows, so a reply is lexed again each time it scrolls back in:
// keep the tokens of recent texts (insertion order makes this a small LRU).
const lexed = new Map<string, Token[]>();
const lexer = (text: string) => {
  const hit = lexed.get(text);
  if (hit) { lexed.delete(text); lexed.set(text, hit); return hit; }
  const tokens = lex(text);
  lexed.set(text, tokens);
  if (lexed.size > 200) lexed.delete(lexed.keys().next().value!);
  return tokens;
};

// The Web's answer typography (history-markdown.css; Plum Pocket and Terminal transcript.css).
const bodyStyle = (t: Theme): TextStyle => t.terminal ? { fontFamily: t.font.mono, fontSize: 13, lineHeight: 21.5 } : { fontSize: 15, lineHeight: t.plum ? 25.8 : 25.5 };
const inlineCode = (t: Theme) => {
  const dark = t.mode === 'dark';
  if (t.plum) return { bg: dark ? '#3a2a1a' : '#fbecc9', fg: dark ? '#ffd58a' : '#74490a' };
  if (t.terminal) return { bg: t.c.surface, fg: t.c.fg };
  return { bg: dark ? '#222733' : '#f1f5f9', fg: dark ? '#f1f5f9' : '#1f2937' };
};
const linkStyle = (t: Theme): TextStyle => {
  const dark = t.mode === 'dark';
  if (t.plum) return { color: dark ? '#e3b6ff' : '#7a3d99', textDecorationLine: 'underline' };
  return { color: dark ? '#7dd3fc' : '#1d4ed8', backgroundColor: dark ? 'rgba(59,130,246,0.1)' : 'rgba(37,99,235,0.09)', textDecorationLine: 'underline', fontFamily: t.terminal ? t.font.mono : t.font.medium };
};

function Inline({ tokens, t, base }: { tokens: Token[] | undefined; t: Theme; base?: TextStyle }): React.ReactNode {
  if (!tokens) return null;
  // Terminal's body font is monospace too: any space is a full cell, so no padding there.
  const pad = t.terminal ? null : <AppText style={{ fontFamily: t.font.regular }}>{'\u202f'}</AppText>;
  return tokens.map((token, i) => {
    switch (token.type) {
      case 'strong': return <AppText key={i} style={[base, { fontFamily: t.font.bold }]}><Inline tokens={(token as Tokens.Strong).tokens} t={t} base={{ ...base, fontFamily: t.font.bold }} /></AppText>;
      case 'em': return <AppText key={i} style={[base, { fontStyle: 'italic' }]}><Inline tokens={(token as Tokens.Em).tokens} t={t} base={{ ...base, fontStyle: 'italic' }} /></AppText>;
      case 'del': return <AppText key={i} style={[base, { textDecorationLine: 'line-through' }]}><Inline tokens={(token as Tokens.Del).tokens} t={t} base={base} /></AppText>;
      // Nested text takes no padding: narrow no-break spaces in the body font pad the chip (no-break, or iOS wraps the pad alone and paints its background to the line end) (a monospace
      // space is a full cell, which pushed the next punctuation away, "x.ts ;").
      case 'codespan': return (
        <AppText key={i} style={{ fontFamily: t.font.mono, fontSize: t.terminal ? 12 : 13.5, backgroundColor: inlineCode(t).bg, color: inlineCode(t).fg }}>
          {pad}{decode((token as Tokens.Codespan).text)}{pad}
        </AppText>
      );
      case 'link': {
        const link = token as Tokens.Link;
        const external = /^https?:/i.test(link.href);
        const style = linkStyle(t);
        return <AppText key={i} style={[base, style]} accessibilityRole="link" onPress={() => void Linking.openURL(link.href).catch(() => undefined)}>
          <Inline tokens={link.tokens} t={t} base={{ ...base, color: style.color }} />{external ? <AppText style={{ fontSize: 12, opacity: 0.7, color: style.color }}>{' ↗'}</AppText> : null}</AppText>;
      }
      case 'br': return '\n';
      case 'image': return <AppText key={i} tone="muted" style={base}>{`[${(token as Tokens.Image).text || 'image'}]`}</AppText>;
      case 'escape': case 'text': {
        const text = token as Tokens.Text;
        return text.tokens ? <Inline key={i} tokens={text.tokens} t={t} base={base} /> : decode(text.text);
      }
      case 'html': return decode((token as Tokens.HTML).text);
      default: return 'text' in token ? decode(String((token as { text: string }).text)) : null;
    }
  });
}
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const t = useTheme();
  const dark = t.mode === 'dark';
  const [open, setOpen] = useState(false);
  const lines = code.replace(/\n$/, '').split('\n');
  const long = lines.length > 24;
  const shown = long ? lines.slice(0, 18).join('\n') : lines.join('\n');
  const tokens = useMemo(() => highlight(shown, lang), [shown, lang]);
  const body = tokens ? tokens.map((tk, i) => <AppText key={i} variant="monoSmall" style={[{ fontSize: 13, lineHeight: 20 }, tk.scope === "comment" ? { fontStyle: "italic" } : null]} color={scopeColor(tk.scope, t.mode === 'dark', t.terminal, t.c.accentStrong)}
    >{tk.text}</AppText>) : shown;
  return (
    <View style={{ marginBottom: 12, borderRadius: t.terminal ? 0 : t.plum ? 14 : 12, overflow: 'hidden', borderWidth: 1,
      backgroundColor: t.plum ? (dark ? '#150b1a' : '#fdf6ea') : t.terminal ? t.c.surface : dark ? '#11141a' : t.c.panel,
      borderColor: t.plum ? t.c.borderStrong : t.terminal ? t.c.border : dark ? '#303642' : t.c.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 3, minHeight: 26, borderBottomWidth: 1, borderBottomColor: withAlpha(t.c.fg, 0.09) }}>
        <AppText variant="monoSmall" style={{ flex: 1, fontSize: 11, opacity: 0.55 }}>{lang || 'text'}</AppText>
        <View style={{ opacity: 0.45 }}><CopyButton value={code} size={14} /></View>
      </View>
      <Press onPress={() => setOpen(true)} feedback="none" accessibilityHint={translate('native.openCodeHint')}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 10, paddingHorizontal: 12 }}>
          <AppText variant="monoSmall" style={{ fontSize: 13, lineHeight: 20 }} selectable>{body}</AppText>
        </ScrollView>
        {long ? <AppText variant="caption" tone="accent" style={{ paddingHorizontal: 10, paddingBottom: 8 }}>{`+${lines.length - 18} lines`}</AppText> : null}
      </Press>
      <Sheet visible={open} onClose={() => setOpen(false)} title={lang || 'code'} tall>
        <ScrollView horizontal><AppText variant="monoSmall" selectable>{code}</AppText></ScrollView>
      </Sheet>
    </View>
  );
}

function Table({ token, t }: { token: Tokens.Table; t: Theme }) {
  const cell = (c: Tokens.TableCell, head: boolean, key: number) => (
    <View key={key} style={{ minWidth: 60, maxWidth: 260, paddingVertical: 6.4, paddingHorizontal: t.plum ? 12.8 : 8.8, borderRightWidth: 1, borderRightColor: t.c.border }}>
      <AppText variant="subhead" weight={head ? (t.plum ? 'bold' : 'semibold') : 'regular'}><Inline tokens={c.tokens} t={t} /></AppText>
    </View>
  );
  return (
    <ScrollView horizontal style={{ marginBottom: 12 }} contentContainerStyle={{ borderWidth: 1, borderColor: t.plum ? t.c.borderStrong : t.c.border, borderRadius: t.plum ? 12 : 0, overflow: 'hidden' }}>
      <View>
        <View style={{ flexDirection: 'row', backgroundColor: t.c.muted }}>{token.header.map((c, i) => cell(c, true, i))}</View>
        {token.rows.map((row, r) => <View key={r} style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: t.c.border }}>{row.map((c, i) => cell(c, false, i))}</View>)}
      </View>
    </ScrollView>
  );
}

function Block({ token, t, depth = 0, first = false }: { token: Token; t: Theme; depth?: number; first?: boolean }): React.ReactNode {
  switch (token.type) {
    case 'paragraph': return <AppText variant="body" style={[bodyStyle(t), { marginBottom: 12 }]} selectable><Inline tokens={(token as Tokens.Paragraph).tokens} t={t} /></AppText>;
    case 'heading': {
      const h = token as Tokens.Heading;
      // The Web's answer headings (switch-ui's fix, shared 4a69660): Classic and Terminal h1 1.25em,
      // h2 1.125em, h3 1.0625em, h4 1em, h5-h6 0.9375em in the soft colour; Plum Pocket keeps its
      // own (1.4 / 1.2 / 1.06em in Fredoka and its plum). 1.1em above (none first), 0.4em below.
      const base = t.terminal ? 13 : 15;
      const scale = t.plum ? [1.4, 1.2, 1.06, 1, 0.94, 0.94] : [1.25, 1.125, 1.0625, 1, 0.9375, 0.9375];
      const size = base * scale[Math.min(5, h.depth - 1)]!;
      return <AppText accessibilityRole="header" weight={t.plum ? undefined : h.depth >= 4 ? 'semibold' : t.terminal ? 'bold' : 'semibold'}
        style={{ fontSize: size, lineHeight: size * 1.3, marginTop: first ? 0 : size * 1.1, marginBottom: size * 0.4,
          ...(h.depth >= 5 && !t.plum ? { color: t.c.fgSoft } : null),
          ...(t.plum ? { fontFamily: t.font.display, color: t.mode === 'dark' ? '#f4c76a' : '#5a2d6e' } : t.terminal ? { fontFamily: t.font.monoBold } : null) }}><Inline tokens={h.tokens} t={t} /></AppText>;
    }
    case 'code': return <CodeBlock code={(token as Tokens.Code).text} lang={(token as Tokens.Code).lang} />;
    case 'blockquote': return <View style={t.plum
      ? { borderLeftWidth: 4, borderLeftColor: t.c.primary, paddingVertical: 8.8, paddingHorizontal: 14.4, borderTopLeftRadius: 6, borderBottomLeftRadius: 6, borderTopRightRadius: 14, borderBottomRightRadius: 14, backgroundColor: t.mode === 'dark' ? '#2c1a38' : '#f4e7f6', marginBottom: 12 }
      : { borderLeftWidth: 3, borderLeftColor: t.c.borderStrong, paddingLeft: 13.6, marginBottom: 12, opacity: 0.85 }}>{(token as Tokens.Blockquote).tokens.map((child, i) => <Block key={i} token={child} t={t} />)}</View>;
    case 'list': {
      const list = token as Tokens.List;
      const start = typeof list.start === 'number' ? list.start : 1;
      return (
        <View style={{ marginBottom: depth ? 0 : 12, paddingLeft: t.terminal ? 0 : t.plum ? 6 : 4 }}>
          {list.items.map((item, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 6, marginTop: i ? 4 : 0 }}>
              <ListMarker t={t} ordered={!!list.ordered} index={start + i} task={item.task ? !!item.checked : null} depth={depth} />
              <View style={{ flex: 1, minWidth: 0 }}>{item.tokens.map((child, j) => child.type === 'text'
                ? <AppText key={j} variant="body" style={bodyStyle(t)} selectable><Inline tokens={(child as Tokens.Text).tokens ?? [child]} t={t} /></AppText>
                : <Block key={j} token={child} t={t} depth={depth + 1} />)}</View>
            </View>
          ))}
        </View>
      );
    }
    case 'table': return <Table token={token as Tokens.Table} t={t} />;
    case 'hr': return <View style={{ height: 1, backgroundColor: t.c.border, marginBottom: 12 }} />;
    case 'space': return null;
    case 'html': return <AppText variant="body" style={bodyStyle(t)} selectable>{decode((token as Tokens.HTML).text)}</AppText>;
    default: return 'text' in token ? <AppText variant="body" style={bodyStyle(t)} selectable>{decode(String((token as { text: string }).text))}</AppText> : null;
  }
}

/** A list item's marker: Plum Pocket's accent dot or number badge, Terminal's "-", else a
 *  bullet or number in the muted colour. */
function ListMarker({ t, ordered, index, task, depth }: { t: Theme; ordered: boolean; index: number; task: boolean | null; depth: number }) {
  const line = bodyStyle(t).lineHeight ?? 25;
  if (task !== null) return <AppText variant="body" tone="muted" style={[bodyStyle(t), { width: 18 }]}>{task ? '☑' : '☐'}</AppText>;
  if (t.plum) {
    if (ordered) return <View style={{ width: 20, height: line, justifyContent: 'center' }}><View style={{ width: 19.5, height: 19.5, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: t.c.accentSoft }}>
      <AppText style={{ fontSize: 11.7, fontFamily: t.font.bold, color: t.c.accentStrong }}>{index}</AppText></View></View>;
    return <View style={{ width: 16, height: line, justifyContent: 'center' }}><View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: depth ? 'transparent' : t.c.primary, borderWidth: depth ? 1.5 : 0, borderColor: t.c.primary }} /></View>;
  }
  // Classic: disc, circle, square by depth; numbers in tabular figures. Terminal: "-" and "1.".
  const bullet = t.terminal ? '-' : ['•', '◦', '▪'][Math.min(2, depth)]!;
  return <AppText variant="body" tone="muted" style={[bodyStyle(t), { minWidth: ordered ? (t.terminal ? 24 : 20) : 12, textAlign: 'right', fontVariant: ['tabular-nums'] }]}>{ordered ? `${index}.` : bullet}</AppText>;
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const t = useTheme();
  const tokens = useMemo(() => lexer(text), [text]);
  // Blocks keep 12 pt between them and none after the last (the Web's margin-bottom rule).
  return <View style={{ marginBottom: -12 }}>{tokens.map((token, i) => <Block key={i} token={token} t={t} first={i === 0} />)}</View>;
});
