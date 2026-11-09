export interface ProcessMemorySample {
  rendererWorkingSetKiB: number;
  rendererHighWaterKiB: number;
  gpuWorkingSetKiB: number;
  gpuHighWaterKiB: number;
}

/** OS high-water marks include startup; settled RSS is the final ten 1 Hz samples. */
export function summarizeMemory(samples: ProcessMemorySample[]) {
  if (!samples.length) throw new Error('No process memory samples');
  const tail = samples.slice(-10);
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const summaryFor = (kind: 'renderer' | 'gpu') => ({
    peakMiB: Math.max(...samples.map((s) => s[`${kind}HighWaterKiB`])) / 1024,
    sampledPeakMiB: Math.max(...samples.map((s) => s[`${kind}WorkingSetKiB`])) / 1024,
    settledMiB: median(tail.map((s) => s[`${kind}WorkingSetKiB`])) / 1024,
  });
  return {
    renderer: summaryFor('renderer'),
    gpu: summaryFor('gpu'),
    unit: 'MiB; Electron workingSetSize/peakWorkingSetSize are KiB',
    settledSamples: tail.length,
  };
}
