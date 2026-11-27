import { describe, expect, it } from 'vitest';
import { aroundMatch, splitMatches } from '../../src/design/matches';

describe('search highlighting', () => {
  it('marks every case-insensitive match', () => {
    expect(splitMatches('Relay forwards; the relay never reads', 'relay')).toEqual([
      { text: 'Relay', hit: true }, { text: ' forwards; the ', hit: false }, { text: 'relay', hit: true }, { text: ' never reads', hit: false }]);
    expect(splitMatches('abc', '  ')).toEqual([{ text: 'abc', hit: false }]);
  });
  it('starts a long snippet near the match', () => {
    const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, the relay forwards sealed requests';
    expect(aroundMatch(text, 'relay').startsWith('…')).toBe(true);
    expect(aroundMatch(text, 'relay')).toContain('relay forwards');
    expect(aroundMatch('the relay', 'relay')).toBe('the relay');
  });
});
