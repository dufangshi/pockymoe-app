import { describe, expect, it } from 'vitest';
import { smoothSpeech } from './sounds';
describe('speech envelope', () => {
  it('uses 60 ms attack and 120 ms release independent of display refresh rate', () => {
    expect(smoothSpeech(0, 1, .06)).toBeCloseTo(1 - Math.exp(-1));
    expect(smoothSpeech(1, 0, .12)).toBeCloseTo(Math.exp(-1));
    let value = 0;
    for (let i = 0; i < 6; i++) value = smoothSpeech(value, 1, .01);
    expect(value).toBeCloseTo(smoothSpeech(0, 1, .06));
    expect(smoothSpeech(1, 0, 1)).toBeLessThan(.001);
  });
});

it('suspends only after the last overlapping cue or speech finishes and resumes for the next cue', async () => {
  const { vi } = await import('vitest');
  vi.useFakeTimers(); vi.resetModules();
  const sources: (EventTarget & { onended?: () => void })[] = [];
  const node = () => ({ connect: vi.fn().mockReturnThis(), disconnect: vi.fn() });
  const source = () => {
    const value = Object.assign(new EventTarget(), node(), { start: vi.fn(), stop: vi.fn(), frequency: { value: 0 } });
    sources.push(value); return value;
  };
  const context = {
    state: 'suspended', currentTime: 0, destination: {},
    resume: vi.fn(async () => { context.state = 'running'; }),
    suspend: vi.fn(async () => { context.state = 'suspended'; }),
    createOscillator: source, createBufferSource: source,
    createGain: () => ({ ...node(), gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } }),
    createAnalyser: () => ({ ...node(), fftSize: 512 }),
    decodeAudioData: vi.fn(async () => ({})),
  };
  vi.stubGlobal('AudioContext', class { constructor() { return context; } });
  try {
    const { playSound, playSpeech } = await import('./sounds');
    await playSound('click'); await playSpeech(new Uint8Array(4));
    for (const cue of sources.slice(0, -1)) cue.dispatchEvent(new Event('ended'));
    await vi.advanceTimersByTimeAsync(6000); expect(context.suspend).not.toHaveBeenCalled();
    const voice = sources.at(-1)!; voice.dispatchEvent(new Event('ended')); voice.onended?.();
    await vi.advanceTimersByTimeAsync(4999); expect(context.suspend).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(context.state).toBe('suspended');
    await playSound('click'); expect(context.state).toBe('running');
  } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
});
