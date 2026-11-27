import { describe, expect, it } from 'vitest';
import { effortColor, effortSliderColors } from './effortModel';

const levels = ['low', 'medium', 'high', 'xhigh'].map(reasoningEffort => ({ reasoningEffort }));

describe('effortSliderColors (the Web slider, shared UI b251204)', () => {
  it('fills through every level colour up to the chosen one and rings it in its own colour', () => {
    const dark = effortSliderColors(levels, 2, { plum: false, dark: true });
    expect(dark.fill).toEqual(['low', 'medium', 'high'].map(l => effortColor(l)));
    expect(dark.accent).toBe(effortColor('high'));
    expect(dark.ink).toBe(effortColor('high'));
  });
  it('darkens the scale on light pages and gives the first level a solid fill', () => {
    const light = effortSliderColors(levels, 0, { plum: false, dark: false });
    expect(light.fill).toEqual([effortColor('low'), effortColor('low')]);
    expect(light.accent).not.toBe(effortColor('low'));
    const sum = (hex: string) => [1, 3, 5].reduce((total, i) => total + parseInt(hex.slice(i, i + 2), 16), 0);
    expect(sum(light.ink)).toBeLessThan(sum(effortColor('low')));
  });
  it('keeps Plum Pocket on its own scale from lavender', () => {
    const plum = effortSliderColors(levels, 1, { plum: true, dark: false });
    expect(plum.fill).toEqual(['#9479cf', '#f0a414']);
    expect(plum.accent).toBe('#f0a414');
  });
});
