import { createHash, verify } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { UpdateState } from '../shared/contract';

export function parseVersion(tag: string): bigint[] | null {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  return match ? match.slice(1).map(BigInt) : null;
}
export function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate), installed = parseVersion(current);
  if (!next || !installed) return false;
  for (let i = 0; i < 3; i++) if (next[i] !== installed[i]) return next[i] > installed[i];
  return false;
}
export interface SignedUpdate { version: string; platform: string; fileName: string; sha256: string; size: number; signature: string }
export function canonical(entry: SignedUpdate): string {
  return JSON.stringify({ version: entry.version, platform: entry.platform, fileName: entry.fileName, sha256: entry.sha256, size: entry.size });
}
export function signedUpdate(body: string, version: string, platform: string, publicKey: string): SignedUpdate | null {
  try {
    const matches = [...body.matchAll(/<!-- pockymoe-updates-v1\n([^]*?)\n-->/g)];
    if (matches.length !== 1) return null;
    const entries: unknown = JSON.parse(matches[0][1]);
    if (!Array.isArray(entries)) return null;
    const candidates = entries.filter(entry => entry?.platform === platform);
    if (candidates.length !== 1) return null;
    const e = candidates[0] as SignedUpdate;
    const suffix = platform === 'darwin-arm64' ? 'mac-arm64.dmg' : platform === 'win32-x64' ? 'win-x64.exe' : '';
    if (!suffix || e.version !== version || e.fileName !== `Pockymoe-${version}-${suffix}` || !/^[0-9a-f]{64}$/.test(e.sha256) || !Number.isSafeInteger(e.size) || e.size <= 0 || e.size > 2_000_000_000 || typeof e.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(e.signature)) return null;
    return verify(null, Buffer.from(canonical(e)), publicKey, Buffer.from(e.signature, 'base64')) ? e : null;
  } catch { return null; }
}
export async function verifyFile(file: string, entry: SignedUpdate): Promise<void> {
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== entry.size) throw new Error('size');
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    if (hash.digest('hex') !== entry.sha256) throw new Error('hash');
  } finally { await handle.close(); }
}
export interface UpdateDependencies {
  version: string; platform: string; directory: string; publicKey: string; feed: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  allowed: () => boolean;
  install: (file: string, entry: SignedUpdate) => Promise<void>;
  openExternal: (url: string) => Promise<unknown>;
  testBuild?: boolean;
  failureMessage?: (reason?: unknown) => string;
  now?: () => number;
}
export type CheckResult = 'latest' | 'downloading' | 'ready' | 'unverified' | 'failed' | 'deferred';
export class UpdateService {
  private current: UpdateState = { status: 'idle' };
  private listeners = new Set<(state: UpdateState) => void>();
  private etag = '';
  private cached: unknown;
  private pending: Promise<CheckResult> | null = null;
  private download: Promise<void> | null = null;
  private ready: { file: string; entry: SignedUpdate; releaseUrl: string } | null = null;
  private stopped = false;
  private unverifiedVersion = '';
  private installFailures = new Map<string, number>();
  private retry = { lastCheckAt: 0, checkAfter: 0, rateLimits: 0, versions: {} as Record<string, { failures: number; retryAfter: number }> };
  private now = (): number => this.deps.now?.() ?? Date.now();
  unverified = (): string => this.unverifiedVersion;
  private async saveRetry(): Promise<void> {
    await mkdir(this.deps.directory, { recursive: true, mode: 0o700 });
    const path = join(this.deps.directory, '.retry.json');
    await writeFile(path + '.tmp', JSON.stringify(this.retry), { mode: 0o600 });
    await rename(path + '.tmp', path);
  }
  private async loadRetry(): Promise<void> {
    try {
      const saved = JSON.parse(await readFile(join(this.deps.directory, '.retry.json'), 'utf8'));
      const now = this.now();
      if (Number.isFinite(saved.lastCheckAt)) this.retry.lastCheckAt = Math.max(0, Math.min(now, saved.lastCheckAt));
      if (Number.isFinite(saved.checkAfter)) this.retry.checkAfter = Math.max(0, Math.min(now + 24 * 3600_000, saved.checkAfter));
      if (Number.isInteger(saved.rateLimits)) this.retry.rateLimits = Math.max(0, Math.min(10, saved.rateLimits));
      for (const [version, value] of Object.entries(saved.versions || {}).slice(-64)) {
        const item = value as { failures: number; retryAfter: number };
        if (parseVersion(version) && isNewerVersion(version, this.deps.version) && Number.isInteger(item.failures) && item.failures > 0 && Number.isFinite(item.retryAfter)) {
          this.retry.versions[version] = { failures: Math.min(item.failures, 20), retryAfter: Math.max(0, Math.min(now + 24 * 3600_000, item.retryAfter)) };
        }
      }
    } catch { /* Missing/truncated policy never authenticates an installer. */ }
  }
  private async beginDownload(version: string): Promise<void> {
    const failures = (this.retry.versions[version]?.failures || 0) + 1;
    this.retry.versions[version] = { failures, retryAfter: this.now() + Math.min(24, 2 ** Math.min(failures - 1, 5)) * 3600_000 };
    // Persist before I/O: a killed process also leaves a bounded retry deadline.
    await this.saveRetry();
  }
  private abort?: AbortController;
  private restoring: Promise<void>;
  constructor(private deps: UpdateDependencies) { this.restoring = (async () => { await this.loadRetry(); await this.restore().catch(() => undefined); })(); }
  private async restore(): Promise<void> {
    const { directory, platform, publicKey, version } = this.deps;
    const saved = JSON.parse(await readFile(join(directory, '.ready.json'), 'utf8')) as SignedUpdate;
    if (!signedUpdate(`<!-- pockymoe-updates-v1\n${JSON.stringify([saved])}\n-->`, saved.version, platform, publicKey)) return;
    if (!isNewerVersion(saved.version, version)) {
      // Authenticate the flat filename before removing an already-installed payload.
      try { await rm(join(directory, saved.fileName), { force: true }); } catch { return; }
      for (const name of ['.ready.json', 'install-attempt.json', 'install-failed']) await rm(join(directory, name), { force: true }).catch(() => undefined);
      return;
    }
    const file = join(directory, saved.fileName); await verifyFile(file, saved);
    this.ready = { file, entry: saved, releaseUrl: `https://github.com/dufangshi/pockymoe-app/releases/tag/v${saved.version}` };
    const failed = await readFile(join(directory, 'install-failed'), 'utf8').then(() => true, () => false);
    const previous = await readFile(join(directory, 'install-attempt.json'), 'utf8').then(text => { const marker = JSON.parse(text); return marker.currentVersion === version && marker.targetVersion === saved.version; }).catch(() => false);
    this.set({ status: failed || previous ? 'error' : 'ready', version: saved.version, releaseUrl: `https://github.com/dufangshi/pockymoe-app/releases/tag/v${saved.version}`, ...(failed || previous ? { error: this.deps.failureMessage?.(previous ? 'previousAttempt' : undefined) || 'Installation failed; previous version restored' } : {}) });
  }
  state = (): UpdateState => ({ ...this.current });
  onChange = (listener: (state: UpdateState) => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private set(state: UpdateState): void { this.current = state; for (const listener of this.listeners) listener(this.state()); }
  check = (source: 'manual' | 'startup' | 'timer' | 'wake' | 'focus' = 'manual'): Promise<CheckResult> => {
    if (this.stopped || !this.deps.allowed()) return Promise.resolve('latest');
    if (this.current.status === 'installing') return Promise.resolve('ready');
    if (this.download) return Promise.resolve('downloading');
    if (this.pending) return this.pending;
    this.pending = (async () => {
      await this.restoring;
      if (this.now() < this.retry.checkAfter) return 'deferred' as const;
      if (source === 'focus' && this.now() - this.retry.lastCheckAt < 15 * 60_000) return this.ready ? 'ready' as const : 'latest' as const;
      if (source === 'wake' && this.now() - this.retry.lastCheckAt < 3600_000) return this.ready ? 'ready' as const : 'latest' as const;
      this.retry.lastCheckAt = this.now();
      await this.saveRetry();
      return this.checkRelease();
    })().catch(() => 'failed' as const).finally(() => { this.pending = null; });
    return this.pending;
  };
  private async checkRelease(): Promise<CheckResult> {
    await this.restoring;
    const response = await this.deps.fetch(this.deps.feed, { credentials: 'omit', headers: { Accept: 'application/vnd.github+json', ...(this.etag ? { 'If-None-Match': this.etag } : {}) }, signal: AbortSignal.timeout(20_000) });
    if (response.status === 403 || response.status === 429) {
      await response.body?.cancel();
      const now = this.now();
      const retryAfter = response.headers.get('retry-after');
      const seconds = retryAfter === null || retryAfter.trim() === '' ? NaN : Number(retryAfter);
      const retryAt = Number.isFinite(seconds) ? now + seconds * 1000 : Date.parse(retryAfter || '');
      const reset = response.headers.get('x-ratelimit-reset');
      const resetAt = reset ? Number(reset) * 1000 : NaN;
      this.retry.rateLimits = Math.min(10, this.retry.rateLimits + 1);
      const fallback = now + Math.min(24, 2 ** (this.retry.rateLimits - 1)) * 3600_000;
      const deadline = Math.max(Number.isFinite(retryAt) ? retryAt : 0, Number.isFinite(resetAt) ? resetAt : 0);
      this.retry.checkAfter = Math.min(now + 24 * 3600_000, Math.max(now + 60_000, deadline > now ? deadline : fallback));
      await this.saveRetry();
      return 'deferred';
    }
    if (response.ok || response.status === 304) {
      this.retry.checkAfter = 0; this.retry.rateLimits = 0;
      await this.saveRetry();
    }
    if (response.status === 304) await response.body?.cancel();
    else {
      if (!response.ok) { await response.body?.cancel(); return 'failed'; }
      // Bound API response before parsing; an untrusted release body cannot exhaust memory.
      const reader = response.body?.getReader();
      if (!reader) return 'failed';
      let bytes = 0; const chunks: Uint8Array[] = [];
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 2_000_000) throw new Error('oversized release'); chunks.push(value); } }
      finally { await reader.cancel(); }
      this.cached = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      this.etag = response.headers.get('etag') || '';
    }
    const release = this.cached as { tag_name?: string; prerelease?: boolean; draft?: boolean; html_url?: string; body?: string; assets?: { name: string; size: number; browser_download_url: string }[] } | undefined;
    if (!release || release.prerelease !== false || release.draft !== false || typeof release.tag_name !== 'string') return 'failed';
    const version = release.tag_name.replace(/^v/, '');
    if (!parseVersion(version)) return 'failed';
    if (!isNewerVersion(version, this.deps.version)) return this.ready ? 'ready' : 'latest';
    // A previously verified newer version is never replaced by an older release.
    if (this.ready && !isNewerVersion(version, this.ready.entry.version)) return 'ready';
    const releaseUrl = `https://github.com/dufangshi/pockymoe-app/releases/tag/${release.tag_name}`;
    const entry = signedUpdate(release.body || '', version, this.deps.platform, this.deps.publicKey);
    if (!entry) {
      this.unverifiedVersion = version;
      if (!this.ready) this.set({ status: 'idle' });
      return 'unverified';
    }
    const assets = release.assets?.filter(asset => asset.name === entry.fileName && asset.size === entry.size) || [];
    if (assets.length !== 1) return 'failed';
    const url = new URL(assets[0].browser_download_url);
    const expected = `https://github.com/dufangshi/pockymoe-app/releases/download/${release.tag_name}/${entry.fileName}`;
    if (url.href !== expected && !(this.deps.testBuild && url.origin === new URL(this.deps.feed).origin)) return 'failed';
    if ((this.retry.versions[version]?.retryAfter || 0) > this.now()) return 'failed';
    await this.beginDownload(version);
    this.set({ status: 'downloading', version, releaseUrl });
    this.download = this.downloadFile(url.href, entry).catch(() => {
      // Background failures stay invisible; the next scheduled check retries.
      this.set(this.ready ? { status: 'ready', version: this.ready.entry.version, releaseUrl: this.ready.releaseUrl } : { status: 'idle' });
    }).finally(() => { this.download = null; });
    return 'downloading';
  }
  private async downloadFile(url: string, entry: SignedUpdate): Promise<void> {
    const { directory } = this.deps;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const part = join(directory, `${entry.fileName}.part`), file = join(directory, entry.fileName);
    // A process interrupted during download leaves only a .part, never a ready state.
    await rm(part, { force: true });
    this.abort = new AbortController();
    const timeout = setTimeout(() => this.abort?.abort(), 30 * 60_000); timeout.unref();
    try {
      const response = await this.deps.fetch(url, { credentials: 'omit', signal: this.abort.signal });
      if (!response.ok || !response.body) throw new Error('download');
      const declared = response.headers.get('content-length');
      if (declared && Number(declared) !== entry.size) { await response.body.cancel(); throw new Error('size'); }
      const handle = await open(part, 'wx', 0o600);
      let size = 0;
      try {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          if (this.stopped) throw new Error('cancelled');
          size += chunk.length;
          if (size > entry.size) throw new Error('size');
          await handle.writeFile(chunk);
        }
      } finally { await handle.close(); }
      await verifyFile(part, entry);
      if (this.stopped) throw new Error('cancelled');
      await rename(part, file);
      await writeFile(join(directory, '.ready.json'), JSON.stringify(entry), { mode: 0o600 });
      delete this.retry.versions[entry.version];
      await this.saveRetry();
      this.ready = { file, entry, releaseUrl: this.current.releaseUrl! };
      this.set({ status: 'ready', version: entry.version, releaseUrl: this.current.releaseUrl });
      // Only verified artifacts remain; never trust persisted ready metadata on restart.
      for (const name of await readdir(directory)) if (![entry.fileName, '.ready.json', '.retry.json', '.retry.json.tmp'].includes(name)) await rm(join(directory, name), { recursive: true, force: true }).catch(() => undefined);
    } finally { clearTimeout(timeout); this.abort = undefined; await rm(part, { force: true }); }
  }
  install = async (): Promise<void> => {
    if (!this.ready || this.current.status === 'installing') return;
    const { file, entry } = this.ready;
    if (!isNewerVersion(entry.version, this.deps.version) || (this.installFailures.get(entry.version) || 0) >= 3) return;
    this.set({ ...this.current, status: 'installing', error: undefined });
    try {
      await verifyFile(file, entry);
      await rm(join(this.deps.directory, 'install-failed'), { force: true });
      await this.deps.install(file, entry);
      this.set({ ...this.current, status: 'ready' });
    } catch (error) {
      const cancelled = !!error && typeof error === 'object' && 'code' in error && error.code === 'updateCancelled';
      const failures = (this.installFailures.get(entry.version) || 0) + (cancelled ? 0 : 1);
      this.installFailures.set(entry.version, failures);
      this.set({ ...this.current, status: 'error', retryAllowed: failures < 3, error: this.deps.failureMessage?.(failures >= 3 ? 'retryLimit' : error) || 'Installation failed' });
    }
  };
  openDownload = async (): Promise<void> => { if (this.ready) await this.deps.openExternal(this.ready.releaseUrl); };
  dispose(): void { this.stopped = true; this.abort?.abort(); this.listeners.clear(); }
  // Tests can wait for actual I/O without exposing a page-controlled download API.
  async settled(): Promise<void> { await this.restoring; await this.pending; await this.download; }
}
