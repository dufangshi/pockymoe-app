import { afterEach, expect, it, vi } from 'vitest';
import { PetPointerPoll, type PointerSample } from './pointerPoll';

afterEach(() => vi.useRealTimers());
it('bounds still distant pointer wakeups and immediately observes entry between slow probes', () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  let point: PointerSample = { x: -5000, y: -5000, far: true, settling: false };
  const read = vi.fn(() => point), poll = new PetPointerPoll(read);
  poll.setRunning(true); vi.advanceTimersByTime(10_000);
  expect(read.mock.calls.length).toBeLessThanOrEqual(30);
  expect(read.mock.calls.length).toBeGreaterThanOrEqual(20);
  const before = read.mock.calls.length;
  point = { x: 100, y: 100, far: false, settling: false };
  poll.wake(); expect(read).toHaveBeenCalledTimes(before + 1);
  vi.advanceTimersByTime(1000); expect(read).toHaveBeenCalledTimes(before + 11);
  poll.setRunning(false); const stopped = read.mock.calls.length;
  vi.advanceTimersByTime(60_000); expect(read).toHaveBeenCalledTimes(stopped); expect(vi.getTimerCount()).toBe(0);
});
it('keeps movement, nearby pointers and transition deadlines responsive', () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  for (const mode of ['moving', 'near', 'settling']) {
    let x = 0;
    const read = vi.fn(() => ({ x: mode === 'moving' ? x++ : 0, y: 0, far: mode !== 'near', settling: mode === 'settling' }));
    const poll = new PetPointerPoll(read); poll.setRunning(true); vi.advanceTimersByTime(3000);
    expect(read).toHaveBeenCalledTimes(30); poll.setRunning(false);
  }
});
it('retires a destroyed native window without leaving a timer', () => {
  vi.useFakeTimers();
  const read = vi.fn(() => null), poll = new PetPointerPoll(read);
  poll.setRunning(true); vi.advanceTimersByTime(1000);
  expect(read).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
