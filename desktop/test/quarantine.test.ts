import { describe, expect, it } from 'vitest';
import entries from './quarantine.json';
import { quarantinePattern } from './quarantine';

describe('visible quarantine selection', () => {
  it('matches literal test names and keeps unrelated behavior tests required', () => {
    expect(quarantinePattern('playwright').test('real Web main (classic dark)')).toBe(true);
    expect(quarantinePattern('playwright').test('real Web main (classic light)')).toBe(false);
    expect(quarantinePattern('vitest').test('local model verifies, unpacks and removes')).toBe(true);
    expect(quarantinePattern('vitest').test('signature validation')).toBe(false);
  });
  it('records a reason and exactly seven days until expiry for every entry', () => {
    for (const entry of entries) {
      expect(entry.reason.length).toBeGreaterThan(10);
      expect(Date.parse(entry.expires) - Date.parse(entry.added)).toBe(7 * 86400000);
    }
  });
});
