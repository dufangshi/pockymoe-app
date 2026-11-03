import { app } from 'electron';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { access, mkdir, mkdtemp, realpath, rm, statfs, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SignedUpdate } from './updateCore';
const exec = promisify(execFile);
declare const __UPDATER_MAC_CERT__: string;
export class ManualInstall extends Error {}
export class InsufficientSpace extends Error {}
export interface PreparedInstall { commit(): Promise<void>; cancel(): Promise<void> }
/** Injectable process/filesystem boundary; production callers never supply it. */
export interface InstallDependencies {
  platform: string; execPath: string; userData: string; pid: number; version: string; certificate: string; env: Record<string, string>;
  access(path: string, mode?: number): Promise<void>;
  mkdir(path: string): Promise<unknown>;
  mkdtemp(prefix: string): Promise<string>;
  realpath(path: string): Promise<string>;
  remove(path: string): Promise<void>;
  write(path: string, value: string, exclusive?: boolean): Promise<void>;
  available(path: string): Promise<bigint>;
  exec(file: string, args: string[]): Promise<{ stdout: string }>;
  spawn(file: string, args: string[], options: { env?: Record<string, string>; windowsHide?: boolean; windowsVerbatimArguments?: boolean }): ChildProcess;
  wait(ms: number): Promise<void>;
  quit(): void;
}
function defaults(): InstallDependencies {
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LANG', 'POCKYMOE_DESKTOP_USER_DATA']) if (process.env[key]) env[key] = process.env[key]!;
  return { platform: process.platform, execPath: process.execPath, userData: app.getPath('userData'), pid: process.pid, version: app.getVersion(), certificate: __UPDATER_MAC_CERT__, env,
    access, mkdir: path => mkdir(path), mkdtemp, realpath, remove: path => rm(path, { recursive: true, force: true }),
    write: (path, value, exclusive) => writeFile(path, value, { mode: 0o600, ...(exclusive ? { flag: 'wx' } : {}) }),
    available: async path => { const stat = await statfs(path, { bigint: true }); return stat.bavail * stat.bsize; },
    exec: (file, args) => exec(file, args), spawn: (file, args, options) => spawn(file, args, { detached: true, stdio: 'ignore', shell: false, ...options }), wait: ms => delay(ms), quit: () => app.quit() };
}
async function launched(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
}
async function sufficientSpace(path: string, entry: SignedUpdate, deps: InstallDependencies): Promise<void> {
  if (await deps.available(path) < BigInt(entry.size) * 3n) throw new InsufficientSpace('Not enough free disk space for update');
}
async function ignore(action: () => Promise<unknown>): Promise<void> { try { await action(); } catch { /* Best-effort cleanup cannot mask install errors. */ } }

/** Stage and detach before any windows close; commit is called only after all close. */
export async function prepareInstall(file: string, entry: SignedUpdate, deps: InstallDependencies = defaults()): Promise<PreparedInstall> {
  let state: 'prepared' | 'committed' | 'cancelled' = 'prepared';
  if (deps.platform === 'win32') {
    await sufficientSpace(dirname(deps.execPath), entry, deps);
    return {
      cancel: async () => { if (state === 'prepared') state = 'cancelled'; },
      commit: async () => {
        if (state !== 'prepared') throw new Error('Update preparation is no longer available');
        // Recheck after document confirmation; do not quit into a full disk.
        await sufficientSpace(dirname(deps.execPath), entry, deps);
        await deps.write(join(deps.userData, 'updates/install-attempt.json'), JSON.stringify({ currentVersion: deps.version, targetVersion: entry.version }));
        // Pin the destination to this running copy, even if registry state points elsewhere.
        // NSIS requires an unquoted final /D= remainder, including any spaces.
        // Bypass Node/libuv argument quoting; the preceding switches contain no spaces.
        const child = deps.spawn(file, ['/S', '--updated', '--force-run', `/D=${dirname(deps.execPath)}`], { windowsHide: true, windowsVerbatimArguments: true });
        await launched(child); state = 'committed'; child.unref(); deps.quit();
      }
    };
  }
  if (deps.platform !== 'darwin') throw new Error('Unsupported update platform');
  const current = await deps.realpath(join(dirname(deps.execPath), '../..'));
  const requirement = `=certificate leaf = H"${deps.certificate}"`;
  if (current.includes('/AppTranslocation/') || current.startsWith('/Volumes/')) throw new ManualInstall();
  try {
    await deps.access(dirname(current), constants.W_OK);
    await deps.access(current, constants.W_OK);
    await deps.exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', requirement, current]);
  } catch { throw new ManualInstall(); }
  await sufficientSpace(dirname(current), entry, deps);
  const work = await deps.mkdtemp(join(deps.userData, 'updates/install-'));
  const mount = join(work, 'mount');
  const sibling = join(dirname(current), `.Pockymoe-update-${deps.pid}.app`);
  let mounted = false;
  const cleanup = async (): Promise<void> => {
    if (mounted) {
      await ignore(async () => { await deps.exec('/usr/bin/hdiutil', ['detach', mount]); mounted = false; });
      if (mounted) await ignore(async () => { await deps.exec('/usr/bin/hdiutil', ['detach', '-force', mount]); mounted = false; });
    }
    await ignore(() => deps.remove(sibling));
    if (!mounted) await ignore(() => deps.remove(work));
  };
  try {
    await deps.mkdir(mount);
    // File already passed release signature/hash verification. Mount only now.
    await deps.exec('/usr/bin/hdiutil', ['attach', file, '-readonly', '-nobrowse', '-mountpoint', mount]); mounted = true;
    const source = join(mount, 'Pockymoe.app');
    await deps.exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', requirement, source]);
    const { stdout } = await deps.exec('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', join(source, 'Contents/Info.plist')]);
    if (stdout.trim() !== entry.version) throw new Error('Bundle version differs from signed version');
    await deps.remove(sibling);
    // ditto preserves bundle signatures without Electron caching mounted ASARs.
    await deps.exec('/usr/bin/ditto', [source, sibling]);
    await deps.exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', requirement, sibling]);
    await deps.exec('/usr/bin/hdiutil', ['detach', mount]); mounted = false;
  } catch (error) { await cleanup(); throw error; }
  return {
    cancel: async () => { if (state !== 'prepared') return; state = 'cancelled'; await cleanup(); },
    commit: async () => {
      if (state !== 'prepared') throw new Error('Update preparation is no longer available');
      let child: ChildProcess | undefined;
      try {
        await sufficientSpace(dirname(current), entry, deps);
        const job = join(work, 'job.json');
        await deps.write(job, JSON.stringify({ pid: deps.pid, current, sibling, requirement, work, env: deps.env }), true);
        child = deps.spawn(deps.execPath, [join(__dirname, 'updateHelper.js'), job], { env: { ...deps.env, ELECTRON_RUN_AS_NODE: '1' } });
        await launched(child);
        let ready = false;
        for (let i = 0; i < 50; i++) {
          ready = await deps.access(join(work, 'ready')).then(() => true, () => false);
          if (ready) break;
          if (child.exitCode !== null || child.signalCode !== null) throw new Error('Update helper exited before readiness');
          await deps.wait(100);
        }
        if (!ready) throw new Error('Update helper did not become ready');
        state = 'committed'; child.unref(); deps.quit();
      } catch (error) {
        if (child) try { child.kill(); } catch { /* Already exited. */ }
        state = 'cancelled'; await cleanup(); throw error;
      }
    }
  };
}
/** Legacy internal wrapper; production orchestration uses prepareInstall. */
export async function installVerified(file: string, entry: SignedUpdate): Promise<void> { const prepared = await prepareInstall(file, entry); await prepared.commit(); }
