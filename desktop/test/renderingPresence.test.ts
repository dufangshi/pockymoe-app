import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { RenderingPresence } from '../src/main/renderingPresence';

const instances: RenderingPresence[] = [];
afterEach(() => { instances.forEach(instance => instance.dispose()); instances.length = 0; vi.useRealTimers(); });
function fixture(locked = false) {
  vi.useFakeTimers(); vi.setSystemTime(0);
  let lastInput = 0;
  const power = Object.assign(new EventEmitter(), {
    getSystemIdleTime: vi.fn(() => Math.floor((Date.now() - lastInput) / 1000)),
    getSystemIdleState: vi.fn(() => locked ? 'locked' : 'active'),
  });
  const presence = new RenderingPresence(power); instances.push(presence);
  return { power, presence, input: () => { lastInput = Date.now(); presence.input(); } };
}
it('holds only pet ambience at two minutes, without gating watched UI, and catches input within one second', () => {
  const { power, presence } = fixture();
  const changed = vi.fn(); presence.subscribe(changed);
  const idleChanged = vi.fn(); presence.subscribeIdle(idleChanged);
  vi.advanceTimersByTime(119000);
  expect(presence.get()).toBe(true); expect(power.getSystemIdleTime).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(1000);
  expect(presence.get()).toBe(true); expect(changed).not.toHaveBeenCalled();
  expect(presence.isIdle()).toBe(true); expect(idleChanged).toHaveBeenLastCalledWith(true);
  expect(power.getSystemIdleTime).toHaveBeenCalledTimes(2);
  power.getSystemIdleTime.mockReturnValue(0);
  vi.advanceTimersByTime(1000);
  expect(presence.get()).toBe(true);
  expect(presence.isIdle()).toBe(false); expect(changed).not.toHaveBeenCalled();
});
it('responds immediately to local input and never lets input override lock, suspend or inactive session', () => {
  const { power, presence, input } = fixture();
  vi.advanceTimersByTime(120000); expect(presence.isIdle()).toBe(true); expect(presence.get()).toBe(true);
  input(); expect(presence.isIdle()).toBe(false);
  power.emit('lock-screen'); power.emit('suspend');
  expect(vi.getTimerCount()).toBe(0);
  input(); power.emit('resume');
  expect(presence.get()).toBe(false); expect(vi.getTimerCount()).toBe(0);
  power.emit('unlock-screen'); expect(presence.get()).toBe(true);
  power.emit('user-did-resign-active'); expect(presence.get()).toBe(false);
  input(); expect(presence.get()).toBe(false);
  power.emit('user-did-become-active'); expect(presence.get()).toBe(true);
});
it('starts paused on the lock screen and removes timers and power listeners on disposal', () => {
  const { power, presence } = fixture(true);
  expect(presence.get()).toBe(false); expect(vi.getTimerCount()).toBe(0);
  power.emit('unlock-screen'); expect(presence.get()).toBe(true);
  presence.dispose(); expect(vi.getTimerCount()).toBe(0);
  expect(power.eventNames()).toEqual([]);
});
it('ignores activation callbacks while the OS still reports no input', () => {
  const { presence, input } = fixture();
  vi.advanceTimersByTime(120000); expect(presence.isIdle()).toBe(true);
  presence.input(); expect(presence.isIdle()).toBe(true);
  expect(vi.getTimerCount()).toBe(1);
  input(); expect(presence.isIdle()).toBe(false);
});
