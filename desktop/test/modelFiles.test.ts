import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: execute }));
import { extractModel, retryModelFile } from '../src/main/voice/model';
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it.each(['EPERM', 'EBUSY', 'EACCES'])('retries a transient Windows %s file lock', async code => {
  vi.useFakeTimers(); let calls = 0;
  const operation = vi.fn(() => { if (++calls < 3) throw Object.assign(new Error('locked'), { code }); });
  const promise = retryModelFile(operation, 'win32');
  await vi.runAllTimersAsync(); await promise; expect(operation).toHaveBeenCalledTimes(3);
});
it('does not retry unrelated or non-Windows filesystem errors', async () => {
  for (const [platform, code] of [['win32', 'ENOENT'], ['darwin', 'EPERM']] as const) {
    const operation = vi.fn(() => { throw Object.assign(new Error('failure'), { code }); });
    await expect(retryModelFile(operation, platform)).rejects.toMatchObject({ code }); expect(operation).toHaveBeenCalledTimes(1);
  }
});
it('kills cancelled tar and waits for close before settling extraction', async () => {
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() }); execute.mockReturnValue(child);
  const abort = new AbortController(); let settled = false;
  const promise = extractModel('张三 voice/archive', '张三 voice/staging', abort.signal).catch(error => { settled = true; throw error; });
  const rejected = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  abort.abort(); expect(child.kill).toHaveBeenCalledTimes(1);
  await Promise.resolve(); expect(settled).toBe(false);
  child.emit('close', 1); await rejected;
});
it('remove keeps staging alive until cancelled tar exits', async () => {
  const { mkdtempSync, existsSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const { LocalModel } = await import('../src/main/voice/model');
  const dir = mkdtempSync(join(tmpdir(), 'pockymoe-model-remove-'));
  const child = Object.assign(new EventEmitter(), { kill: vi.fn() }); execute.mockReturnValue(child);
  const bytes = new Uint8Array([1, 2, 3]);
  const model = new LocalModel(dir, async () => new Response(bytes), () => undefined, { name: 'fixture', bytes: bytes.length, url: 'https://example.invalid', sha256: createHash('sha256').update(bytes).digest('hex') });
  try {
    const download = model.download();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    const removal = model.remove();
    expect(child.kill).toHaveBeenCalledTimes(1); expect(existsSync(join(dir, 'staging'))).toBe(true);
    child.emit('close', 1); await download; await removal;
    expect(existsSync(dir)).toBe(false); expect(model.state).toBe('absent');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
it('stops retrying a persistent lock after three seconds', async () => {
  vi.useFakeTimers();
  const operation = vi.fn(() => { throw Object.assign(new Error('locked'), { code: 'EPERM' }); });
  const promise = retryModelFile(operation, 'win32');
  const rejected = expect(promise).rejects.toMatchObject({ code: 'EPERM' });
  await vi.advanceTimersByTimeAsync(3000); await rejected;
  expect(operation).toHaveBeenCalledTimes(31);
});
