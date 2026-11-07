import { describe, expect, it, vi } from 'vitest';
import { RiveHitReadback } from './riveHit';
function fixture() {
  let now = 0, ready = false;
  const gl = { PIXEL_PACK_BUFFER: 1, PIXEL_PACK_BUFFER_BINDING: 2, STREAM_READ: 3, RGBA: 4, UNSIGNED_BYTE: 5, SYNC_GPU_COMMANDS_COMPLETE: 6, TIMEOUT_EXPIRED: 7, WAIT_FAILED: 8,
    createBuffer: vi.fn(() => ({})), bindBuffer: vi.fn(), bufferData: vi.fn(), getParameter: vi.fn(() => null), readPixels: vi.fn(), fenceSync: vi.fn(() => ({})), flush: vi.fn(), deleteSync: vi.fn(), deleteBuffer: vi.fn(),
    clientWaitSync: vi.fn(() => ready ? 9 : 7), getBufferSubData: vi.fn((_target, _offset, data: Uint8Array) => { data[3] = 211; }) };
  const probe = new RiveHitReadback(gl as unknown as WebGL2RenderingContext, () => now);
  return { gl, probe, time: (value: number) => { now = value; }, signal: () => { ready = true; } };
}
describe('asynchronous Rive alpha hit testing', () => {
  it('does no readback without pointer demand and never waits for an unsignalled fence', () => {
    const { gl, probe, signal } = fixture(); probe.issue(); expect(gl.readPixels).not.toHaveBeenCalled();
    expect(probe.alphaAt(20, 30, 100, 200)).toBe(0); probe.issue();
    expect(gl.readPixels).toHaveBeenCalledWith(20, 169, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    expect(probe.poll(100, 200)).toBe(false); expect(gl.clientWaitSync).toHaveBeenCalledWith(expect.anything(), 0, 0); expect(gl.getBufferSubData).not.toHaveBeenCalled();
    signal(); expect(probe.poll(100, 200)).toBe(true); expect(probe.alphaAt(20, 30, 100, 200)).toBe(211);
    probe.issue(); expect(gl.readPixels).toHaveBeenCalledTimes(1);
  });
  it('coalesces movement to 10Hz, rejects stale pixels and releases owned resources', () => {
    const { gl, probe, signal, time } = fixture(); probe.alphaAt(1, 1, 100, 200); probe.issue(); signal(); probe.poll(100, 200);
    expect(probe.alphaAt(2, 2, 100, 200)).toBe(0); probe.alphaAt(3, 3, 100, 200); time(99); expect(probe.needsDraw).toBe(false);
    time(100); probe.issue(); expect(gl.readPixels).toHaveBeenLastCalledWith(3, 196, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    expect(probe.poll(200, 400)).toBe(false); expect(probe.alphaAt(3, 3, 200, 400)).toBe(0);
    probe.dispose(); expect(gl.deleteBuffer).toHaveBeenCalledOnce(); expect(gl.deleteSync).toHaveBeenCalledTimes(2);
  });
  it('does not schedule probes while tucked or outside, and cancels queued demand', () => {
    const { gl, probe } = fixture(); probe.alphaAt(20, 30, 100, 200, true); expect(probe.needsDraw).toBe(false);
    probe.alphaAt(20, 30, 100, 200); probe.suspend(); probe.issue(); expect(gl.readPixels).not.toHaveBeenCalled();
    probe.alphaAt(20, 30, 100, 200); probe.alphaAt(-1, 30, 100, 200); probe.issue(); expect(gl.readPixels).not.toHaveBeenCalled();
  });
});
