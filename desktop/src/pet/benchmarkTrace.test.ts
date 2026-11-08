import { describe, expect, it } from 'vitest';
import { summarizeNativeTrace } from './benchmarkTrace';

describe('native benchmark trace coverage', () => {
  it('does not certify missing readback events without a draw positive control', () => {
    const result = summarizeNativeTrace([{ name: 'Scheduler::RunTask', ph: 'X', dur: 20 }]);
    expect(result.readPixels).toBe(0);
    expect(result.drawCommandCoverage).toBe(false);
    expect(result.meanReadPixelsMs).toBeNull();
  });

  it('counts complete events and begin/end pairs once', () => {
    const result = summarizeNativeTrace([
      { name: 'GLES2::DrawElements', ph: 'X' },
      { name: 'GLES2::DrawArraysInstanced', ph: 'B' },
      { name: 'GLES2::DrawArraysInstanced', ph: 'E' },
      { name: 'GLES2::ReadPixels', ph: 'B' },
      { name: 'GLES2::ReadPixels', ph: 'E' },
      { name: 'GLES2::ReadPixels', ph: 'X', dur: 2500 },
    ]);
    expect(result.drawCommands).toBe(2);
    expect(result.drawCommandCoverage).toBe(true);
    expect(result.readPixels).toBe(2);
    expect(result.meanReadPixelsMs).toBe(2.5);
  });
});
