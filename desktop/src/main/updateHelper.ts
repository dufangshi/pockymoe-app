// Detached, no shell. Loaded fully before the running bundle is renamed.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { swapPreparedUpdate, type SwapJob } from './updateRecovery';

async function main(): Promise<void> {
  const job = JSON.parse(readFileSync(process.argv[2], 'utf8')) as SwapJob;
  writeFileSync(join(job.work, 'ready'), 'ready', { mode: 0o600, flag: 'wx' });
  await swapPreparedUpdate(job, {
    waitForExit: async pid => {
      for (let i = 0; i < 600; i++) {
        try { process.kill(pid, 0); } catch { return; }
        await delay(100);
      }
      throw new Error('App did not exit');
    },
    verify: path => { execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '-R', job.requirement, path], { stdio: 'ignore' }); },
    rename: renameSync,
    remove: path => { rmSync(path, { recursive: true, force: true }); },
    failed: () => { writeFileSync(join(job.work, '../install-failed'), 'rollback', { mode: 0o600 }); },
    launch: async path => {
      const child = spawn(join(path, 'Contents/MacOS/Pockymoe'), [], { detached: true, stdio: 'ignore', shell: false, env: job.env });
      let failed = false;
      child.on('error', () => { failed = true; });
      await delay(5000);
      if (failed || !child.pid || child.exitCode !== null || child.signalCode !== null) {
        try { child.kill(); } catch { /* Already exited. */ }
        return false;
      }
      child.unref(); return true;
    }
  });
}
void main().catch(() => { process.exitCode = 1; });
