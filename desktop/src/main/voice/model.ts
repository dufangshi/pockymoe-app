import { modelTar } from '../platform';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { LocalModelState } from '../../shared/voice';

export async function retryModelFile(operation: () => void, platform = process.platform): Promise<void> {
  const deadline = Date.now() + 3000;
  for (;;) {
    try { operation(); return; }
    catch (error) {
      if (platform !== 'win32' || !['EPERM', 'EBUSY', 'EACCES'].includes((error as NodeJS.ErrnoException).code || '') || Date.now() >= deadline) throw error;
      await delay(100);
    }
  }
}
const removeFile = (path: string): Promise<void> => retryModelFile(() => rmSync(path, { recursive: true, force: true, maxRetries: process.platform === 'win32' ? 5 : 0, retryDelay: 100 }));
// Abort's error can precede exit. Never remove extraction files before close.
export function extractModel(archive: string, staging: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    // Windows tar decodes argv paths through the system codepage. Node sets cwd
    // through the Unicode process API, so keep archive/destination arguments relative.
    const child = execFile(tar(), ['-xjf', relative(staging, archive), '-C', '.'], { cwd: staging, windowsHide: process.platform === 'win32' });
    let failure: Error | null = null;
    const cancel = (): void => { child.kill(); };
    signal.addEventListener('abort', cancel, { once: true });
    child.on('error', error => { failure = error; });
    child.on('close', code => {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) reject(signal.reason);
      else if (failure || code !== 0) reject(failure || new Error('extraction'));
      else resolve();
    });
    if (signal.aborted) cancel();
  });
}
export const MODEL = {
  name: 'kokoro-int8-multi-lang-v1_1',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2',
  sha256: '259c9c8bc906d6078e4e0570421885dabb68b539c2f970fcbb890a58eeaf3e9c',
  bytes: 147_052_523,
};
export interface ModelSource { url: string; sha256: string; bytes: number; name: string }
type Fetch = (url: string, init: RequestInit) => Promise<Response>;
const sha256 = async (path: string): Promise<string> => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
};
const tar = (): string => modelTar(process.platform, process.env.SystemRoot);
/** Downloads the pinned model into userData, resuming a partial file. Only a verified archive is unpacked. */
export class LocalModel {
  state: LocalModelState;
  progress = 0;
  error: string | null = null;
  private abort: AbortController | null = null;
  private running: Promise<void> | null = null;
  private removing = false;
  constructor(private dir: string, private fetcher: Fetch, private changed: () => void, private source: ModelSource = MODEL, private stallMs = 30_000) {
    this.state = this.installed() ? 'ready' : 'absent';
  }
  get path(): string { return join(this.dir, this.source.name); }
  private get archive(): string { return join(this.dir, `${this.source.name}.tar.bz2.partial`); }
  private installed(): boolean { return existsSync(join(this.path, 'model.int8.onnx')); }
  private set(state: LocalModelState, error: string | null = null): void { this.state = state; this.error = error; this.changed(); }
  download(): Promise<void> {
    if (this.removing) return Promise.resolve();
    if (this.running) return this.running;
    const running = this.performDownload();
    this.running = running;
    const settled = (): void => { if (this.running === running) this.running = null; };
    void running.then(settled, settled);
    return running;
  }
  private async performDownload(): Promise<void> {
    if (this.state === 'downloading' || this.state === 'extracting' || this.state === 'ready') return;
    const abort = this.abort = new AbortController();
    mkdirSync(this.dir, { recursive: true });
    this.progress = 0; this.set('downloading');
    try {
      let from = existsSync(this.archive) ? statSync(this.archive).size : 0;
      if (from < this.source.bytes) {
        const response = await this.fetcher(this.source.url, { signal: abort.signal, ...(from ? { headers: { range: `bytes=${from}-` } } : {}) });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        if (response.status !== 206) from = 0;
        let received = from, shown = 0;
        const body = Readable.fromWeb(response.body as never);
        // A connection that hangs must fail so it can be retried; the partial file is kept and resumed.
        const stall = new AbortController();
        let timer = setTimeout(() => stall.abort(), this.stallMs);
        body.on('data', (chunk: Buffer) => {
          clearTimeout(timer); timer = setTimeout(() => stall.abort(), this.stallMs);
          received += chunk.length; this.progress = received / this.source.bytes;
          if (this.progress - shown >= .01) { shown = this.progress; this.changed(); }
        });
        try { await pipeline(body, createWriteStream(this.archive, { flags: from ? 'a' : 'w' }), { signal: AbortSignal.any([abort.signal, stall.signal]) }); }
        finally { clearTimeout(timer); }
      }
      if (await sha256(this.archive) !== this.source.sha256) { await removeFile(this.archive); throw new Error('checksum'); }
      abort.signal.throwIfAborted();
      this.progress = 1; this.set('extracting');
      const staging = join(this.dir, 'staging');
      await removeFile(staging); mkdirSync(staging, { recursive: true });
      await extractModel(this.archive, staging, abort.signal);
      abort.signal.throwIfAborted();
      await removeFile(this.path);
      await retryModelFile(() => { abort.signal.throwIfAborted(); renameSync(join(staging, this.source.name), this.path); });
      await removeFile(staging); await removeFile(this.archive);
      this.set('ready');
    } catch (error) {
      if (abort.signal.aborted) this.set('absent');
      else this.set('absent', error instanceof Error && error.message === 'checksum' ? 'checksum' : 'download');
    } finally { if (this.abort === abort) this.abort = null; }
  }
  cancel(): void { this.abort?.abort(); }
  async remove(): Promise<void> {
    this.removing = true; this.cancel();
    try { await this.running; await removeFile(this.dir); this.progress = 0; this.set('absent'); }
    finally { this.removing = false; }
  }
}
