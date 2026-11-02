import { app } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { access, cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SignedUpdate } from './updateCore';
const exec = promisify(execFile);
declare const __UPDATER_MAC_CERT__: string;

export async function installVerified(file: string, entry: SignedUpdate): Promise<void> {
  if (process.platform === 'win32') {
    // oneClick NSIS honors /S --force-run, including silent per-user installs.
    const child = spawn(file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore', shell: false, windowsHide: true });
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref(); app.quit(); return;
  }
  if (process.platform !== 'darwin') throw new Error('Unsupported update platform');
  const current = await realpath(join(dirname(process.execPath), '../..'));
  const requirement = `=certificate leaf = H"${__UPDATER_MAC_CERT__}"`;
  // Development-signed, translocated, read-only and disk-image copies do not
  // replace themselves. The wrapper sends them to the exact release page.
  if (current.includes('/AppTranslocation/') || current.startsWith('/Volumes/')) throw new ManualInstall();
  try {
    await access(dirname(current), constants.W_OK);
    await access(current, constants.W_OK);
    await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', requirement, current]);
  } catch { throw new ManualInstall(); }
  const work = await mkdtemp(join(app.getPath('userData'), 'updates/install-'));
  const mount = join(work, 'mount'); await mkdir(mount);
  const sibling = join(dirname(current), `.Pockymoe-update-${process.pid}.app`);
  let mounted = false, helperStarted = false;
  try {
    // file has already passed Ed25519 signature, size, version and SHA256 checks.
    await exec('/usr/bin/hdiutil', ['attach', file, '-readonly', '-nobrowse', '-mountpoint', mount]); mounted = true;
    const source = join(mount, 'Pockymoe.app');
    await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', requirement, source]);
    const { stdout } = await exec('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', join(source, 'Contents/Info.plist')]);
    if (stdout.trim() !== entry.version) throw new Error('Bundle version differs from signed version');
    await rm(sibling, { force: true, recursive: true });
    await cp(source, sibling, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
    await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', requirement, sibling]);
    await exec('/usr/bin/hdiutil', ['detach', mount]); mounted = false;
    const job = join(work, 'job.json');
    const env: Record<string, string> = {};
    for (const key of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LANG', 'POCKYMOE_DESKTOP_USER_DATA']) if (process.env[key]) env[key] = process.env[key]!;
    await writeFile(job, JSON.stringify({ pid: process.pid, current, sibling, requirement, work, env }), { mode: 0o600, flag: 'wx' });
    const child = spawn(process.execPath, [join(__dirname, 'updateHelper.js'), job], { detached: true, stdio: 'ignore', shell: false, env: { ...env, ELECTRON_RUN_AS_NODE: '1' } });
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    helperStarted = true; child.unref(); app.quit();
  } finally {
    if (mounted) await exec('/usr/bin/hdiutil', ['detach', mount]).catch(() => undefined);
    if (!helperStarted) { await rm(sibling, { force: true, recursive: true }); await rm(work, { force: true, recursive: true }); }
  }
}
export class ManualInstall extends Error {}
