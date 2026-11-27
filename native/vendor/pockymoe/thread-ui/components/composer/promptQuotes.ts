/**
 * Quotes in a prompt: passages of earlier messages the person refers to. In the
 * composer each is a tile whose hidden text is `[QUOTE n]`; sent, the passages
 * go first, each in a tagged block, and the prompt keeps `[QUOTE n]` where it
 * refers to them, so order and position survive and the model cannot mistake a
 * quote for the person's own words:
 *
 *   <pockymoe-quotes>
 *   <quote id="1" from="assistant" turn="12" ref="TURN/ITEM">…</quote>
 *   </pockymoe-quotes>
 *
 *   About [QUOTE 1]: …
 *
 * The text is all there is: history read back from a harness, forks, exports and
 * another agent reading the thread see the same quotes.
 */

export interface PromptQuote {
  /** The passage as it read when quoted (at most QUOTE_LIMIT characters). */
  text: string;
  from: 'assistant' | 'user';
  path?: string;
  startLine?: number;
  endLine?: number;
  comment?: string;
  /** The turn's number as the conversation shows it, when known. */
  turn: number | null;
  turnId: string | null;
  itemId: string | null;
}

export const QUOTE_LIMIT = 2000;
const OPEN = '<pockymoe-quotes>';
const CLOSE = '</pockymoe-quotes>';
export const QUOTE_TOKEN = /\[QUOTE (\d+)\]/g;

export function quotePlaceholder(n: number) {
  return `[QUOTE ${n}]`;
}

/** A long passage keeps its start and end, joined by an ellipsis. */
export function clipQuote(text: string) {
  const clean = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  if (clean.length <= QUOTE_LIMIT) return clean;
  const head = Math.ceil(QUOTE_LIMIT * 0.6);
  return `${clean.slice(0, head).trimEnd()} … ${clean.slice(clean.length - (QUOTE_LIMIT - head - 3)).trimStart()}`;
}

const escapeBody = (text: string) => text.replace(/<\/(quote|pockymoe-quotes)/gi, '<\\/$1');
const unescapeBody = (text: string) => text.replace(/<\\\/(quote|pockymoe-quotes)/gi, '</$1');
const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescapeAttribute = (value: string) => value.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/**
 * The prompt as sent: quotes numbered in the order the body refers to them (a
 * quote the body no longer refers to is dropped), then the body.
 */
export function composeQuotedPrompt(body: string, quotes: Map<string, PromptQuote>) {
  const order: string[] = [];
  for (const match of body.matchAll(QUOTE_TOKEN)) {
    const placeholder = match[0];
    if (quotes.has(placeholder) && !order.includes(placeholder)) order.push(placeholder);
  }
  if (order.length === 0) return body;
  const renumbered = body.replace(QUOTE_TOKEN, (token) => {
    const index = order.indexOf(token);
    return index < 0 ? token : quotePlaceholder(index + 1);
  });
  const blocks = order.map((placeholder, index) => {
    const quote = quotes.get(placeholder)!;
    const attributes = [
      `id="${index + 1}"`,
      `from="${quote.from}"`,
      ...(quote.path ? [`path="${escapeAttribute(quote.path)}"`, `start="${quote.startLine ?? 1}"`, `end="${quote.endLine ?? quote.startLine ?? 1}"`] : []),
      ...(quote.comment ? [`comment="${escapeAttribute(quote.comment.replace(/\n/g, '&#10;'))}"`] : []),
      ...(quote.turn ? [`turn="${quote.turn}"`] : []),
      ...(quote.turnId && quote.itemId ? [`ref="${escapeAttribute(`${quote.turnId}/${quote.itemId}`)}"`] : []),
    ];
    return `<quote ${attributes.join(' ')}>\n${escapeBody(quote.text)}\n</quote>`;
  });
  return `${OPEN}\n${blocks.join('\n')}\n${CLOSE}\n\n${renumbered}`;
}

/** A sent prompt's quotes and its body, or null when it quotes nothing. */
export function parseQuotedPrompt(text: string): { quotes: Map<number, PromptQuote>; body: string } | null {
  if (!text.startsWith(OPEN)) return null;
  const end = text.indexOf(CLOSE);
  if (end < 0) return null;
  const block = text.slice(OPEN.length, end);
  const quotes = new Map<number, PromptQuote>();
  for (const match of block.matchAll(/<quote\b([^>]*)>\n?([\s\S]*?)\n?<\/quote>/g)) {
    const attributes = new Map([...match[1]!.matchAll(/(\w+)="([^"]*)"/g)].map(([, key, value]) => [key!, unescapeAttribute(value!)]));
    const id = Number(attributes.get('id'));
    if (!Number.isInteger(id)) continue;
    const [turnId, itemId] = (attributes.get('ref') ?? '').split('/');
    const turn = Number(attributes.get('turn'));
    quotes.set(id, {
      text: unescapeBody(match[2]!),
      ...(attributes.has('path') ? { path: attributes.get('path')!, startLine: Number(attributes.get('start')), endLine: Number(attributes.get('end')) } : {}),
      ...(attributes.has('comment') ? { comment: attributes.get('comment')!.replace(/&#10;/g, '\n') } : {}),
      from: attributes.get('from') === 'user' ? 'user' : 'assistant',
      turn: Number.isInteger(turn) && turn > 0 ? turn : null,
      turnId: turnId || null,
      itemId: itemId || null,
    });
  }
  return { quotes, body: text.slice(end + CLOSE.length).replace(/^\n+/, '') };
}

/** Text with each quote replaced by a short mark, for one-line previews. */
export function quotedPromptPreview(text: string) {
  const parsed = parseQuotedPrompt(text);
  return parsed ? parsed.body.replace(QUOTE_TOKEN, '❝$1') : text;
}
