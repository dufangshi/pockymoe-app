import { describe, expect, it } from 'vitest';
import { ClipSequencer } from './clipSequence';

const clip = (name: string, role?: 'intro' | 'outro') => ({ path: `clips/${name}.webp`, frames: 4, ...(role ? { role } : {}) });
const states = {
  idle: [clip('idle'), clip('idle_tuck')],
  running: [clip('work')],
  dragging: [clip('lift', 'intro'), clip('float')],
  resting: [clip('lie', 'intro'), clip('sleep'), clip('rise', 'outro')],
};
const names = (sequence: ClipSequencer, mood: string, times: number, now = 0) => Array.from({ length: times }, () => sequence.next(mood, now)?.path.slice(6, -5));

describe('ClipSequencer', () => {
  it('cycles a state without its intro or outro', () => {
    expect(names(new ClipSequencer(states, () => 1), 'idle', 3)).toEqual(['idle', 'idle_tuck', 'idle']);
  });
  it('plays an intro once on entering a state', () => {
    expect(names(new ClipSequencer(states, () => 1), 'dragging', 3)).toEqual(['lift', 'float', 'float']);
  });
  it('rests only from idle, after a clip has played there', () => {
    const sequence = new ClipSequencer(states, () => 0);
    expect(names(sequence, 'idle', 3)).toEqual(['idle', 'lie', 'sleep']);
    expect(names(new ClipSequencer(states, () => 0), 'running', 2)).toEqual(['work', 'work']);
  });
  it('gets up when its time is over', () => {
    const sequence = new ClipSequencer(states, () => 0);
    names(sequence, 'idle', 2);
    expect(sequence.next('idle', 59_000)?.path).toBe('clips/sleep.webp');
    expect(sequence.next('idle', 61_000)?.path).toBe('clips/rise.webp');
  });
  it('gets up as soon as anything happens, before showing the new state', () => {
    const sequence = new ClipSequencer(states, () => 0);
    names(sequence, 'idle', 2);
    expect(names(sequence, 'running', 2)).toEqual(['rise', 'work']);
  });
  it('holds still on a looping clip for reduced motion', () => {
    expect(new ClipSequencer(states).still('dragging')?.path).toBe('clips/float.webp');
  });
  it('has nothing to play for a state without clips', () => {
    expect(new ClipSequencer(states).next('failed', 0)).toBeNull();
  });
});
