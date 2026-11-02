// Detached, no shell. Loaded fully before the running bundle is renamed.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
interface Job { pid: number; current: string; sibling: string; requirement: string; work: string; env: Record<string, string> }
async function main(): Promise<void> {
  const job = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Job;
  writeFileSync(join(job.work, 'ready'), 'ready', { mode: 0o600, flag: 'wx' });
  const backup = `${job.current}.update-backup-${job.pid}`;
  let backedUp = false, swapped = false, exited = false;
  const launch = (): ReturnType<typeof spawn> => {
    const child = spawn(join(job.current, 'Contents/MacOS/Pockymoe'), [], { detached: true, stdio: 'ignore', shell: false, env: job.env });
    // Observe early launch failure before removing the rollback copy.
    child.on('error', () => undefined); return child;
  };
  try {
    for (let i = 0; i < 600; i++) {
      try { process.kill(job.pid, 0); } catch { exited = true; break; }
      await delay(100);
    }
    if (!exited) throw new Error('App did not exit');
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', job.requirement, job.sibling], { stdio: 'ignore' });
    renameSync(job.current, backup); backedUp = true;
    renameSync(job.sibling, job.current); swapped = true;
    const child = launch();
    await delay(5000);
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) throw new Error('Updated app failed to start');
    child.unref();
    backedUp = false; // A running B is committed; cleanup cannot trigger rollback.
    try { rmSync(backup, { recursive: true, force: true }); } catch { /* Leave backup for manual cleanup. */ }
  } catch {
    if (backedUp) {
      if (swapped) rmSync(job.current, { recursive: true, force: true });
      renameSync(backup, job.current); backedUp = false;
    }
    // Never include subprocess output, paths or signing subjects in UI errors.
    writeFileSync(join(job.work, '../install-failed'), 'rollback', { mode: 0o600 });
    if (exited) { const child = launch(); child.unref(); }
  } finally {
    rmSync(job.sibling, { recursive: true, force: true });
    rmSync(job.work, { recursive: true, force: true });
  }
}
void main().catch(() => { process.exitCode = 1; });
