import { describe, expect, it, vi } from 'vitest';
import { buildRows, fileAsPatch, numberLines, parsePatch, rangeText } from '../../src/features/diff/model';
import { composeQuotedPrompt, quotePlaceholder, type PromptQuote } from '../../vendor/pockymoe/thread-ui/components/composer/promptQuotes';
import { filterPulls, DEFAULT_QUERY } from '@pockymoe/web-git/pr/review/listModel';
import type { PullSummary } from '@pockymoe/web-git/pr/review/reviewApi';

const calls: { key: string; path: string; init: RequestInit }[] = [];
vi.mock('../../src/connection/devices', () => ({ findDevice: (key: string) => ({ key, target: { kind: 'direct', baseUrl: 'http://x', token: null } }) }));
vi.mock('../../src/protocol/transport', () => ({
  deviceFetch: async (target: { kind: string }, path: string, init: RequestInit) => {
    calls.push({ key: JSON.stringify(target), path, init });
    return new Response(JSON.stringify({ ok: true, path }), { status: 200 });
  },
}));

describe('Web request() on the native transport', () => {
  it('routes relay/devices/<key>/api/... to that device and keeps the query', async () => {
    const { request } = await import('../../src/protocol/webApiShim');
    const result = await request<{ path: string }>(`relay/devices/${encodeURIComponent('direct:http://10.0.2.2:19220')}/api/source-control/pull-requests?state=open`);
    expect(result.path).toBe('/api/source-control/pull-requests?state=open');
    await expect(request('api/threads')).rejects.toThrow(/No device/);
  });
  it('the vendored reviewAction posts the action with the url', async () => {
    const { reviewAction } = await import('@pockymoe/web-git/pr/review/reviewApi');
    await reviewAction('relay:dev1', 'detail', 'https://h/o/r/pull/1', { headSha: 'abc' });
    const last = calls.at(-1)!;
    expect(last.path).toBe('/api/source-control/pull-requests/detail');
    expect(JSON.parse(String(last.init.body))).toEqual({ headSha: 'abc', url: 'https://h/o/r/pull/1' });
    expect(last.init.method).toBe('POST');
  });
});

describe('files as patches', () => {
  it('numbers every line of a file and selects ranges like a diff', () => {
    const patch = fileAsPatch('src/a.ts', 'one\ntwo\r\nthree\n');
    const parsed = parsePatch(patch);
    expect(parsed.files).toHaveLength(1);
    const rows = buildRows(parsed, { open: () => true, split: false, limit: () => Infinity, bare: true });
    expect(rows.map(r => r.type)).toEqual(['line', 'line', 'line']);
    expect(rangeText(numberLines(parsed.files[0]!.lines), { side: 'new', start: 2, end: 3 })).toBe('two\nthree');
  });
  it('keeps lines that look like diff headers as content', () => {
    const parsed = parsePatch(fileAsPatch('x.md', '--- not a header\n+++ nor this\n@@ text'));
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0]!.lines.filter(l => l.kind === 'ctx')).toHaveLength(3);
  });
});

describe('review chips', () => {
  it('compose into the Web quote format with path, range and comment', () => {
    const quotes = new Map<string, PromptQuote>([[quotePlaceholder(1), { text: '#[must_use]', from: 'user', path: 'src/lexer.rs', startLine: 23, endLine: 23, comment: 'Why "must_use"?', turn: null, turnId: null, itemId: null }]]);
    expect(composeQuotedPrompt('[QUOTE 1]', quotes)).toBe('<pockymoe-quotes>\n<quote id="1" from="user" path="src/lexer.rs" start="23" end="23" comment="Why &quot;must_use&quot;?">\n#[must_use]\n</quote>\n</pockymoe-quotes>\n\n[QUOTE 1]');
  });
});

describe('PR list model (vendored)', () => {
  const pull = (n: number, extra: Partial<PullSummary> = {}): PullSummary => ({
    url: `https://h/o/r/pull/${n}`, number: n, title: `PR ${n}`, state: 'open', draft: false, author: { login: 'ada' }, repository: { host: 'h', owner: 'o', name: 'r', kind: 'forgejo' },
    headRef: 'feat', baseRef: 'main', headSha: 'x', createdAt: `2026-11-2${n}T00:00:00Z`, updatedAt: `2026-11-2${n}T00:00:00Z`, checks: null, reviewDecision: null, requestedReviewers: [],
    additions: n, deletions: 0, changedFiles: 1, comments: 0, labels: [], ...extra,
  });
  it('ranks merge-ready PRs first and understands qualifiers', () => {
    const pulls = [pull(1, { draft: true }), pull(2, { reviewDecision: 'approved', checks: 'passed' }), pull(3, { checks: 'failed' })];
    expect(filterPulls(pulls, DEFAULT_QUERY, {}).map(p => p.number)).toEqual([2, 3, 1]);
    expect(filterPulls(pulls, { ...DEFAULT_QUERY, search: 'is:draft' }, {}).map(p => p.number)).toEqual([1]);
  });
});

describe('Edit from here', () => {
  it('turns stored attachment paths back into composer placeholders', async () => {
    const { rewindDraftText } = await import('../../src/features/git/rewind');
    const out = rewindDraftText({ text: 'Fix this [PHOTO .pockymoe/uploads/a.png] and [FILE .pockymoe/uploads/b.log]', attachments: [
      { path: '.pockymoe/uploads/a.png', originalName: 'shot.png', kind: 'photo' }, { path: '.pockymoe/uploads/b.log', originalName: 'build.log', kind: 'file' }] });
    expect(out.text).toBe('Fix this [PHOTO shot.png] and [FILE build.log]');
  });
});
