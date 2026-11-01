import { describe, expect, it } from 'vitest';
import { accentForeground, bubbleOutline, requestSummaryHtml } from './presentation';

const textOnly = (html: string): string => html.replace(/<\/?(?:code|span)(?: [^>]+)?>/g, '');

describe('request summary presentation', () => {
  it('chips commands after a command cue and explicit inline code', () => {
    const summary = requestSummaryHtml('运行 cargo test -p pockymoe-runtime');
    expect(textOnly(summary)).toBe('运行 cargo test -p pockymoe-runtime');
    expect(summary).toContain('<span class="command-token">pockymoe-runtime</span>');
    expect(summary.match(/<code>/g)).toHaveLength(1);
    expect(textOnly(requestSummaryHtml('请运行 `git status`，然后回答。'))).toBe('请运行 git status，然后回答。');
    expect(requestSummaryHtml('pnpm test')).toContain('<code>');
    expect(textOnly(requestSummaryHtml('pnpm test'))).toBe('pnpm test');
    expect(requestSummaryHtml('请确认提醒方式')).toBe('请确认提醒方式');
  });
  it.each(['Run the focused regression checks?', 'Run the focused regression checks', 'cargo test?', '运行回归检查？', 'Please execute the checks.', 'https://example.com/check'])('leaves prose and uncertain payloads as plain text: %s', (value) => { expect(requestSummaryHtml(value)).not.toContain('<code>'); });
  it.each(['cargo test -p runtime', 'Run cargo test', './scripts/check.sh --focused', '/usr/bin/python3 --version', 'scripts/check.sh', 'Please run ./checks.sh'])('recognizes executable/path payloads: %s', (value) => { expect(requestSummaryHtml(value)).toContain('<code>'); });
  it('honours explicitly quoted code even when it contains question punctuation', () => { expect(requestSummaryHtml('Run `echo "ready?"`')).toContain('<code>'); });
  it('keeps untrusted summary text inert inside and outside chips', () => {
    expect(textOnly(requestSummaryHtml('<img src=x onerror=alert(1)> `echo "<script>"`'))).toBe('&lt;img src=x onerror=alert(1)&gt; echo &quot;&lt;script&gt;&quot;');
  });
});
describe('bubble outline and accent legibility', () => {
  it('centres the tail on the head and keeps it clear of both rounded corners', () => {
    expect(bubbleOutline(280, 120, 140, true).tailX).toBe(140);
    expect(bubbleOutline(280, 120, -40, true).tailX).toBe(20);
    expect(bubbleOutline(280, 120, 400, false).tailX).toBe(260);
    expect(bubbleOutline(280, 120, 140, false)).toMatchObject({ canvasHeight: 128, offsetTop: -8 });
  });
  it('chooses dark text on gold/green and white on blue', () => {
    expect(accentForeground(232, 169, 58)).toBe('#141414');
    expect(accentForeground(77, 227, 162)).toBe('#141414');
    expect(accentForeground(10, 71, 196)).toBe('#ffffff');
  });
});
