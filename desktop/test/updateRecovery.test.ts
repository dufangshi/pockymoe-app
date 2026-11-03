import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recoverUpdateStartup, swapPreparedUpdate, type SwapDependencies, type SwapJob } from '../src/main/updateRecovery';
const job: SwapJob = { pid: 123, current: '/apps/Pockymoe.app', sibling: '/apps/.Pockymoe-update-123.app', requirement: 'pin', work: '/profile/updates/install-fixture', env: {} };
const backup = `${job.current}.update-backup-${job.pid}`;
function fixture(fail?: string) {
  const paths = new Set([job.current, job.sibling, job.work]);
  const marker = vi.fn(() => { if (fail === 'marker') throw new Error('marker'); });
  const launch = vi.fn(async (path: string) => !(path === job.current && paths.has(backup)));
  const rename = vi.fn((from: string, to: string) => {
    if (fail === 'backupRename' && from === job.current && to === backup || fail === 'stageRename' && from === job.sibling || fail === 'restoreRename' && from === backup || fail === 'removeAndRename' && from === job.current && to === job.sibling) throw new Error('rename');
    if (!paths.has(from) || paths.has(to)) throw new Error('missing/existing path'); paths.delete(from); paths.add(to);
  });
  const remove = vi.fn((path: string) => { if (fail === 'removeAndRename' && path === job.current || fail === 'cleanup') throw new Error('remove'); paths.delete(path); });
  const deps: SwapDependencies = { waitForExit: vi.fn(async () => { if (fail === 'wait') throw new Error('live'); }), verify: vi.fn(() => { if (fail === 'verify') throw new Error('verify'); }), rename, remove, failed: marker, launch };
  return { deps, paths, marker, launch, rename, remove };
}
it('commits a successful launch even if backup cleanup fails', async () => {
  const f = fixture('cleanup'); f.launch.mockResolvedValue(true); await swapPreparedUpdate(job, f.deps);
  expect(f.launch).toHaveBeenCalledOnce(); expect(f.marker).not.toHaveBeenCalled(); expect(f.paths.has(job.current)).toBe(true);
});
it.each(['verify', 'backupRename', 'stageRename', 'marker', 'restoreRename', 'removeAndRename', 'cleanup'])('still attempts restore/relaunch when %s fails', async phase => {
  const f = fixture(phase); await swapPreparedUpdate(job, f.deps); expect(f.marker).toHaveBeenCalled();
  const lastLaunch = f.launch.mock.calls.at(-1)?.[0]; expect(lastLaunch).toBe(phase === 'restoreRename' || phase === 'removeAndRename' ? backup : job.current); expect(f.paths.has(lastLaunch!)).toBe(true);
});
it('does not relaunch a second app while original refuses to exit', async () => {
  const f = fixture('wait'); await swapPreparedUpdate(job, f.deps); expect(f.marker).toHaveBeenCalled(); expect(f.launch).not.toHaveBeenCalled(); expect(f.paths.has(job.current)).toBe(true);
});
it('a thrown B launch still restores and attempts A launch', async () => {
  const f = fixture(); f.launch.mockRejectedValueOnce(new Error('spawn')).mockResolvedValueOnce(true); await swapPreparedUpdate(job, f.deps); expect(f.launch).toHaveBeenCalledTimes(2); expect(f.paths.has(job.current)).toBe(true); expect(f.paths.has(backup)).toBe(false);
});
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'pockymoe-recovery-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const exists = (path: string) => lstat(path).then(() => true, () => false);
it('restores a running backup when original bundle is missing', async () => {
  const backup = join(directory, 'Pockymoe Copy.app.update-backup-999999999'); await mkdir(backup);
  const result = await recoverUpdateStartup({ platform: 'darwin', execPath: join(backup, 'Contents/MacOS/Pockymoe'), userData: '/unused' });
  expect(result.restoredFromBackup).toBe(true); expect(result.appPath).toBe(join(directory, 'Pockymoe Copy.app')); expect(await exists(backup)).toBe(false); expect(await exists(result.appPath!)).toBe(true);
});
it('sweeps stale owned bundles but preserves links, live PID, unrelated files and running bundle', async () => {
  const current = join(directory, 'Pockymoe.app'), stale = join(directory, '.Pockymoe-update-999999999.app'), backup = `${current}.update-backup-999999999`, live = join(directory, `.Pockymoe-update-${process.pid}.app`);
  for (const path of [current, stale, backup, live]) await mkdir(path);
  const external = join(directory, 'unrelated'); await mkdir(external); await writeFile(join(external, 'keep'), 'keep'); const link = join(directory, '.Pockymoe-update-999999998.app'); await symlink(external, link);
  await recoverUpdateStartup({ platform: 'darwin', execPath: join(current, 'Contents/MacOS/Pockymoe'), userData: '/unused' });
  expect(await exists(stale)).toBe(false); expect(await exists(backup)).toBe(false); expect(await exists(current)).toBe(true); expect(await exists(live)).toBe(true); expect(await exists(link)).toBe(true); expect(await readFile(join(external, 'keep'), 'utf8')).toBe('keep');
});
