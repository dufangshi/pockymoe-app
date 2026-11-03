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
