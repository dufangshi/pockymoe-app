import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: {} }));
import { InsufficientSpace, prepareInstall, type InstallDependencies } from '../src/main/updateInstall';
import type { SignedUpdate } from '../src/main/updateCore';
const current = join('/fixture', 'Pockymoe.app'), profile = join('/profile'), work = join(profile, 'updates', 'install-fixture'), sibling = join('/fixture', '.Pockymoe-update-123.app');
const entry: SignedUpdate = { version: '1.2.3', platform: 'darwin-arm64', fileName: 'Pockymoe-1.2.3-mac-arm64.dmg', sha256: 'a'.repeat(64), size: 100, signature: '' };
function fixture(platform = 'darwin') {
  const calls: string[] = [];
  const child = Object.assign(new EventEmitter(), { pid: 42, exitCode: null, signalCode: null, unref: vi.fn(), kill: vi.fn() });
  const available = vi.fn().mockResolvedValue(300n), exec = vi.fn().mockResolvedValue({ stdout: '1.2.3\n' });
  const remove = vi.fn().mockResolvedValue(undefined), access = vi.fn().mockResolvedValue(undefined);
  const write = vi.fn().mockImplementation(async () => { calls.push('marker'); });
  const spawn = vi.fn().mockImplementation(() => { calls.push('spawn'); queueMicrotask(() => child.emit('spawn')); return child; });
  const quit = vi.fn().mockImplementation(() => { calls.push('quit'); });
  const deps: InstallDependencies = { platform, execPath: platform === 'darwin' ? join(current, 'Contents', 'MacOS', 'Pockymoe') : join('/fixture', 'Pockymoe.exe'), userData: profile, pid: 123, version: '1.2.2', certificate: 'b'.repeat(40), env: {}, access, mkdir: vi.fn().mockResolvedValue(undefined), mkdtemp: vi.fn().mockResolvedValue(work), realpath: vi.fn().mockResolvedValue(current), remove, write, available, exec, spawn, wait: vi.fn().mockResolvedValue(undefined), quit };
  return { deps, child, available, exec, remove, access, write, spawn, quit, calls };
}
beforeEach(() => vi.clearAllMocks());
it('stages, verifies and detaches Mac before starting a helper or quitting', async () => {
  const f = fixture(); const prepared = await prepareInstall('/verified.dmg', entry, f.deps);
  expect(f.spawn).not.toHaveBeenCalled(); expect(f.quit).not.toHaveBeenCalled();
  expect(f.exec).toHaveBeenCalledWith('/usr/bin/hdiutil', ['attach', '/verified.dmg', '-readonly', '-nobrowse', '-mountpoint', join(work, 'mount')]);
  expect(f.exec).toHaveBeenLastCalledWith('/usr/bin/hdiutil', ['detach', join(work, 'mount')]);
  expect(f.exec).toHaveBeenCalledWith('/usr/bin/codesign', expect.arrayContaining(['=certificate leaf = H"' + 'b'.repeat(40) + '"']));
  await prepared.commit(); expect(f.child.unref).toHaveBeenCalledOnce(); expect(f.quit).toHaveBeenCalledOnce();
});
it('cancels a prepared Mac update without helper, marker or quit', async () => {
  const f = fixture(); const prepared = await prepareInstall('/verified.dmg', entry, f.deps); await prepared.cancel();
  expect(f.remove).toHaveBeenCalledWith(sibling); expect(f.remove).toHaveBeenCalledWith(work);
  await expect(prepared.commit()).rejects.toThrow(); expect(f.spawn).not.toHaveBeenCalled(); expect(f.quit).not.toHaveBeenCalled();
});
it.each(['darwin', 'win32'])('rejects insufficient %s space before staging or quitting', async platform => {
  const f = fixture(platform); f.available.mockResolvedValue(299n);
  await expect(prepareInstall('/verified', entry, f.deps)).rejects.toBeInstanceOf(InsufficientSpace);
  expect(f.spawn).not.toHaveBeenCalled(); expect(f.quit).not.toHaveBeenCalled(); expect(f.exec).not.toHaveBeenCalledWith('/usr/bin/hdiutil', expect.anything());
});
it.each(['darwin', 'win32'])('rechecks %s space at commit without quitting into a full disk', async platform => {
  const f = fixture(platform); const prepared = await prepareInstall('/verified', entry, f.deps); f.available.mockResolvedValue(0n);
  await expect(prepared.commit()).rejects.toBeInstanceOf(InsufficientSpace); await prepared.cancel();
  expect(f.spawn).not.toHaveBeenCalled(); expect(f.quit).not.toHaveBeenCalled();
});
it('writes Windows attempt before installer launch, only at commit', async () => {
  const f = fixture('win32'); const prepared = await prepareInstall('/verified.exe', entry, f.deps);
  expect(f.write).not.toHaveBeenCalled(); expect(f.spawn).not.toHaveBeenCalled(); await prepared.commit();
  expect(f.calls).toEqual(['marker', 'spawn', 'quit']);
  expect(f.write).toHaveBeenCalledWith(join(profile, 'updates', 'install-attempt.json'), JSON.stringify({ currentVersion: '1.2.2', targetVersion: '1.2.3' }));
  expect(f.spawn).toHaveBeenCalledWith('/verified.exe', ['/S', '--updated', '--force-run', '/D=/fixture'], { windowsHide: true });
});
it('stays running if Windows attempt marker cannot be recorded', async () => {
  const f = fixture('win32'); f.write.mockRejectedValue(new Error('disk write')); const prepared = await prepareInstall('/verified.exe', entry, f.deps);
  await expect(prepared.commit()).rejects.toThrow('disk write'); expect(f.spawn).not.toHaveBeenCalled(); expect(f.quit).not.toHaveBeenCalled();
});
it.each(['attach', 'sourceSignature', 'bundleVersion', 'copy', 'stagedSignature', 'detach'])('cleans failed Mac %s preparation without teardown', async phase => {
  const f = fixture();
  f.exec.mockImplementation(async (file: string, args: string[]) => {
    const target = args.at(-1)?.replace(/\\/g, '/');
    const failing = phase === 'attach' && args[0] === 'attach' || phase === 'sourceSignature' && file.endsWith('codesign') && target?.includes('/mount/') || phase === 'bundleVersion' && file.endsWith('PlistBuddy') || phase === 'copy' && file.endsWith('ditto') || phase === 'stagedSignature' && file.endsWith('codesign') && target?.includes('.Pockymoe-update-') || phase === 'detach' && args[0] === 'detach';
    if (failing) throw new Error(phase); return { stdout: '1.2.3\n' };
  });
  await expect(prepareInstall('/verified.dmg', entry, f.deps)).rejects.toThrow(phase);
  expect(f.spawn).not.toHaveBeenCalled(); expect(f.quit).not.toHaveBeenCalled(); expect(f.remove).toHaveBeenCalledWith(sibling);
  if (phase === 'detach') expect(f.remove).not.toHaveBeenCalledWith(work);
});
it('does not quit if helper cannot acknowledge readiness', async () => {
  const f = fixture(); const prepared = await prepareInstall('/verified.dmg', entry, f.deps); f.access.mockRejectedValue(new Error('not ready'));
  await expect(prepared.commit()).rejects.toThrow('did not become ready'); expect(f.child.kill).toHaveBeenCalledOnce(); expect(f.quit).not.toHaveBeenCalled();
});
it('does not quit if helper process creation fails', async () => {
  const f = fixture(); const prepared = await prepareInstall('/verified.dmg', entry, f.deps);
  f.spawn.mockImplementation(() => { queueMicrotask(() => f.child.emit('error', new Error('spawn failed'))); return f.child; });
  await expect(prepared.commit()).rejects.toThrow('spawn failed'); expect(f.quit).not.toHaveBeenCalled();
});
