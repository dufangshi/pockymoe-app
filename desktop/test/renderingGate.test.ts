import { afterEach, expect, it, vi } from 'vitest';
import { installRenderingGate, setPageRendering } from '../src/shared/renderingGate';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('holds RAF and animations while timers remain live, then restores pending work', () => {
  vi.useFakeTimers();
  let sequence = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const page = {
    dispatchEvent: vi.fn(),
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  };
  const playing = { playState: 'running', pause() { this.playState = 'paused'; }, play() { this.playState = 'running'; } };
  const paused = { ...playing, playState: 'paused' };
  const remove = vi.fn(), append = vi.fn();
  vi.stubGlobal('window', page);
  const dataset: Record<string, string> = {};
  vi.stubGlobal('document', { documentElement: { dataset }, head: { append }, createElement: () => ({ remove }), getAnimations: () => [playing, paused] });
  installRenderingGate();
  const render = vi.fn(), cancelled = vi.fn();
  page.requestAnimationFrame(render);
  setPageRendering(false);
  expect(dataset.pockymoeRendering).toBe('paused');
  expect(page.dispatchEvent).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0); expect(playing.playState).toBe('paused');
  const id = page.requestAnimationFrame(cancelled); page.cancelAnimationFrame(id);
  const heartbeat = vi.fn(); setTimeout(heartbeat, 1000); vi.advanceTimersByTime(1000);
  expect(heartbeat).toHaveBeenCalledOnce(); expect(render).not.toHaveBeenCalled();
  setPageRendering(true);
  expect(dataset.pockymoeRendering).toBeUndefined();
  expect(remove).toHaveBeenCalledOnce(); expect(frames.size).toBe(1);
  expect(playing.playState).toBe('running'); expect(paused.playState).toBe('paused');
  for (const callback of frames.values()) callback(1000);
  expect(render).toHaveBeenCalledWith(1000); expect(cancelled).not.toHaveBeenCalled();
});
