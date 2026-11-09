export interface GPUTraceEvent {
  name?: string;
  ph?: string;
  dur?: number;
}

/** Native service transfers, separately counted from application alpha probes. */
export function summarizeNativeTrace(events: GPUTraceEvent[]) {
  const reads = events.filter((e) => e.name === 'GLES2::ReadPixels' && (e.ph === 'X' || e.ph === 'B'));
  const draws = events.filter(
    (e) => /^GLES2::Draw(Arrays|Elements)/.test(e.name ?? '') && (e.ph === 'X' || e.ph === 'B'),
  );
  const durations = reads
    .filter((e) => e.ph === 'X')
    .map((e) => (e.dur ?? 0) / 1000)
    .sort((a, b) => a - b);
  const total = durations.reduce((sum, value) => sum + value, 0);
  return {
    readPixels: reads.length,
    drawCommands: draws.length,
    drawCommandCoverage: draws.length > 0,
    readPixelsDurationMs: total,
    meanReadPixelsMs: durations.length ? total / durations.length : null,
    p95ReadPixelsMs: durations.length
      ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))]
      : null,
    scope:
      'Observed GLES2 GPU-service events; application probes counted separately. ' +
      'Without traced draw commands, zero reads does not establish absence of native readbacks.',
  };
}
