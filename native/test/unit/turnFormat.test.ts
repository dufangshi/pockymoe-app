import { describe, expect, it } from 'vitest';
import { formatCompactTokenCount, formatCompactUsd, shortModelName } from '../../src/features/thread/turnFormat';
import { fileBadge, fileFamily, shortFileName } from '../../vendor/pockymoe/thread-ui/components/attachments/attachmentFiles';

describe('turn head numbers (ported from the shared UI)', () => {
  it('formats costs and token counts as the Web does', () => {
    expect(formatCompactUsd(0.0497)).toBe('$0.050');
    expect(formatCompactUsd(0.008)).toBe('$0.0080');
    expect(formatCompactUsd(1.2)).toBe('$1.2');
    expect(formatCompactUsd(0.0004)).toBe('<$0.001');
    expect(formatCompactTokenCount(18200)).toBe('18K');
    expect(formatCompactTokenCount(1_250_000)).toBe('1.3M');
    expect(formatCompactTokenCount(950)).toBe('950');
  });
  it('shortens model names', () => {
    expect(shortModelName('claude-opus-5-5')).toBe('opus 5.5');
    expect(shortModelName('gpt-5.4')).toBe('5.4');
    expect(shortModelName('claude-sonnet-4-5-20250929')).toBe('sonnet 4.5');
    expect(shortModelName('fake')).toBe('fake');
  });
  it('names attachment tiles within 11 columns', () => {
    expect(shortFileName('queue-notes.txt')).toBe('queu…es.txt');
    expect(shortFileName('a.txt')).toBe('a.txt');
    expect(fileBadge('queue-notes.txt')).toBe('TXT');
    expect(fileFamily('x.pdf')).toBe('pdf');
  });
});
