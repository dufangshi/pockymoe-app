import { expect, it } from 'vitest';
import { summarizeMemory } from './benchmarkMemory';

it('keeps startup high-water marks and uses the final ten samples for settled memory', () => {
  const samples = Array.from({ length: 20 }, (_, i) => ({
    rendererWorkingSetKiB: (i < 10 ? 900 : 100 + i) * 1024,
    rendererHighWaterKiB: 1000 * 1024,
    gpuWorkingSetKiB: 40 * 1024,
    gpuHighWaterKiB: 80 * 1024,
  }));
  const result = summarizeMemory(samples);
  expect(result.renderer).toEqual({ peakMiB: 1000, sampledPeakMiB: 900, settledMiB: 114.5 });
  expect(result.gpu).toEqual({ peakMiB: 80, sampledPeakMiB: 40, settledMiB: 40 });
  expect(result.settledSamples).toBe(10);
  expect(() => summarizeMemory([])).toThrow();
});
