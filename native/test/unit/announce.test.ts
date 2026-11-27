import { describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ AccessibilityInfo: { announceForAccessibility: vi.fn() } }));
vi.mock('../../src/design/haptics', () => ({ haptic: {} }));
vi.mock('../../src/i18n', () => ({ translate: (k: string) => k }));
const { activityChange } = await import('../../src/features/thread/announce');

const idle = { running: false, lastTurnStatus: 'completed', requestIds: [] };
const running = { running: true, lastTurnStatus: 'inProgress', requestIds: [] };

describe('thread activity announcements', () => {
  it('stays silent on the first snapshot', () => { expect(activityChange(null, { ...running, requestIds: ['r1'] })).toBeNull(); });
  it('reads a new request', () => { expect(activityChange(running, { ...running, requestIds: ['r1'] })).toBe('request'); });
  it('does not repeat an answered or known request', () => {
    expect(activityChange({ ...running, requestIds: ['r1'] }, { ...running, requestIds: ['r1'] })).toBeNull();
    expect(activityChange({ ...running, requestIds: ['r1'] }, running)).toBeNull();
  });
  it('reads a finished or failed turn, not a stopped one', () => {
    expect(activityChange(running, idle)).toBe('finished');
    expect(activityChange(running, { ...idle, lastTurnStatus: 'failed' })).toBe('failed');
    expect(activityChange(running, { ...idle, lastTurnStatus: 'interrupted' })).toBeNull();
    expect(activityChange(idle, idle)).toBeNull();
  });
});
