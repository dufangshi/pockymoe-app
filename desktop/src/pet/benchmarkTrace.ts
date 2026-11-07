export interface GPUTraceEvent {
  name?: string;
  ph?: string;
  dur?: number;
}

/** Native service transfers, separately counted from application alpha probes. */
export function summarizeNativeTrace(events: GPUTraceEvent[]) {
  const reads = events.filter((e) => e.name === 'GLES2::ReadPixels' && (e.ph === 'X' || e.ph === 'B'));
  const durations = reads
    .filter((e) => e.ph === 'X')
    .map((e) => (e.dur ?? 0) / 1000)
    .sort((a, b) => a - b);
  const total = durations.reduce((sum, value) => sum + value, 0);
  return {
    readPixels: reads.length,
    readPixelsDurationMs: total,
    meanReadPixelsMs: durations.length ? total / durations.length : null,
    p95ReadPixelsMs: durations.length
      ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))]
      : null,
    scope:
      'Native GPU-service transfers in the isolated benchmark app; application probes counted separately.',
  };
}
