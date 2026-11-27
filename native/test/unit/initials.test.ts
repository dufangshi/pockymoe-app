import { describe, expect, it } from 'vitest';
import { initials } from '../../src/design/AccountAvatar';
describe('account initials (as the Web avatar)', () => {
  it('takes two letters', () => {
    expect(initials('lab0a1b2c')).toBe('LA');
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('ada.lovelace@example.test')).toBe('AL');
    expect(initials('张三')).toBe('张三');
    expect(initials('')).toBe('?');
  });
});
