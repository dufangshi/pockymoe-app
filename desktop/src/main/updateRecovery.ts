import { lstat, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Cleanup never follows links or removes a bundle that this process runs from. */
export async function recoverUpdateStartup(options: { platform: string; execPath: string; userData: string }): Promise<{ restoredFromBackup: boolean; cleanupErrors: number; appPath?: string }> {
  let restoredFromBackup = false, cleanupErrors = 0;
  if (options.platform !== 'darwin') return { restoredFromBackup, cleanupErrors };
  let current = join(dirname(options.execPath), '../..');
  // Normalize without realpath: the original name may currently be missing.
  current = join(current);
  const parent = dirname(current), name = current.slice(parent.length + 1);
  const backup = /^(.+\.app)\.update-backup-\d+$/.exec(name);
  const originalName = backup?.[1] || name;
  const alive = (pid: string): boolean => { try { process.kill(Number(pid), 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; } };
  const isDirectory = async (path: string): Promise<boolean> => lstat(path).then(stat => stat.isDirectory() && !stat.isSymbolicLink(), () => false);
  if (backup) {
    const original = join(parent, backup[1]);
    const absent = await lstat(original).then(() => false, error => error.code === 'ENOENT');
    if (absent && await isDirectory(current)) {
      try { await rename(current, original); current = original; restoredFromBackup = true; }
      catch { cleanupErrors++; }
    }
  }
  const names = await readdir(parent).catch(() => [] as string[]);
  for (const entry of names) {
    const siblingPid = /^\.Pockymoe-update-(\d+)\.app$/.exec(entry)?.[1];
    const backupPid = entry.startsWith(`${originalName}.update-backup-`) ? /\.update-backup-(\d+)$/.exec(entry)?.[1] : undefined;
    const pid = siblingPid || backupPid;
    if (!pid || alive(pid)) continue;
    const path = join(parent, entry);
    if (path === current || !await isDirectory(path)) continue;
    // A backup is the only recoverable copy when the original is absent. Keep it.
    if (backupPid && !await isDirectory(join(parent, originalName))) continue;
    try { await rm(path, { recursive: true, force: true }); } catch { cleanupErrors++; }
  }
  return { restoredFromBackup, cleanupErrors, appPath: current };
}

export interface SwapJob { pid: number; current: string; sibling: string; requirement: string; work: string; env: Record<string, string> }
export interface SwapDependencies {
  waitForExit(pid: number): Promise<void>;
  verify(path: string): void;
  rename(from: string, to: string): void;
  remove(path: string): void;
  failed(): void;
  /** Returns false for a spawn/early-exit failure and kills a failed child. */
  launch(path: string): Promise<boolean>;
}
async function ignore(action: () => unknown | Promise<unknown>): Promise<void> { try { await action(); } catch { /* Recovery continues after each independent failure. */ } }

/** Every failure path attempts restoration and relaunch independently of logging/cleanup. */
export async function swapPreparedUpdate(job: SwapJob, deps: SwapDependencies): Promise<void> {
  const backup = `${job.current}.update-backup-${job.pid}`;
  let exited = false, backedUp = false, swapped = false;
  try {
    await deps.waitForExit(job.pid); exited = true;
    deps.verify(job.sibling);
    deps.rename(job.current, backup); backedUp = true;
    deps.rename(job.sibling, job.current); swapped = true;
    if (!await deps.launch(job.current)) throw new Error('Updated app failed to start');
    backedUp = false; // A running B is committed; deleting a backup cannot undo it.
    await ignore(() => deps.remove(backup));
  } catch {
    await ignore(() => deps.failed());
    if (exited) {
      let launchPath = job.current;
      if (backedUp) {
        if (swapped) {
          // Rename the failed B aside first: a failed recursive delete must not
          // stop restoration. If both fail, launch A from its preserved backup.
          try { deps.rename(job.current, job.sibling); }
          catch { await ignore(() => deps.remove(job.current)); }
        }
        try { deps.rename(backup, job.current); }
        catch { launchPath = backup; }
      }
      // Marker writes, removal and even restore rename errors must not skip this.
      await ignore(() => deps.launch(launchPath));
    }
  } finally {
    await ignore(() => deps.remove(job.sibling));
    await ignore(() => deps.remove(job.work));
  }
}
