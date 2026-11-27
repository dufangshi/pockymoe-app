// A new thread in its own worktree, as NewThreadView asks for it (POST
// /api/threads/start-worktree): the path and branch the form previews, a retried request id
// that returns the first outcome, and a failed repository setup that keeps the thread.
// Needs a runtime with the route (agent/switch-ui or later) on a direct lab Supervisor:
//   DIRECT=http://localhost:19206 LAB=<lab dir with local/ws> npx vitest run --config vitest.lab.config.mts test/lab/worktree.lab.test.ts
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { workspaceBody } from '../../src/features/workspaces/workspaceInput';
import { worktreeNameFrom, worktreePath } from '../../src/features/thread/worktree';
import { LAB, labDevice } from './labSession';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=lab', '-c', 'user.email=lab@example.invalid', ...args], { cwd, encoding: 'utf8' });
function repo(name: string, setup?: object) {
  const dir = join(LAB, 'local/ws', name);
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(dir, { recursive: true });
    git(dir, 'init', '-q', '-b', 'main');
    if (setup) { mkdirSync(join(dir, '.pockymoe'), { recursive: true }); writeFileSync(join(dir, '.pockymoe/worktree.json'), JSON.stringify(setup)); git(dir, 'add', '.'); }
    git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
  }
  return dir;
}

it.skipIf(!process.env.DIRECT)('creates a thread in a new worktree', async () => {
  const { api } = await labDevice();
  const workspaceFor = async (dir: string, label: string) => {
    let found = (await api.workspaces()).find(w => w.absPath === dir);
    if (!found) {
      await api.raw('/api/workspaces', { method: 'POST', body: JSON.stringify(workspaceBody('path', dir, label, null)), headers: { 'content-type': 'application/json' } });
      found = (await api.workspaces()).find(w => w.absPath === dir)!;
    }
    return found;
  };
  const runtime = (await api.runtimes()).find(r => r.enabled)!;
  const model = (await api.runtimeModels(runtime.provider))[0]!.model;
  const stamp = Date.now().toString(36);
  const created: string[] = [];
  try {
    const plain = await workspaceFor(repo('wt-plain'), 'wt-plain');
    const name = worktreeNameFrom(`Fix the login ${stamp}\nand more`)!;
    const input = { workspaceId: plain.id, provider: runtime.provider, model, approvalMode: 'yolo' as const };
    const clientRequestId = crypto.randomUUID();
    const first = await api.createThreadInWorktree(input, { name, clientRequestId });
    created.push(first.thread.id);
    expect(first.created).toBe(true);
    expect(first.worktree.path).toBe(worktreePath(plain.absPath, name));
    expect(first.worktree.branch).toBe(`agent/${name}`);
    expect(first.setup).toBeNull();
    expect(first.thread.worktreePath).toBe(first.worktree.path);
    expect(existsSync(first.worktree.path)).toBe(true);

    // The same id and input (a retried send) returns the first outcome, no second worktree.
    const again = await api.createThreadInWorktree(input, { name, clientRequestId });
    expect(again.created).toBe(false);
    expect(again.thread.id).toBe(first.thread.id);
    // The same id with another input is refused.
    await expect(api.createThreadInWorktree(input, { name: `${name}-x`, clientRequestId })).rejects.toThrow();
    // A name the device refuses comes back as a readable error.
    await expect(api.createThreadInWorktree(input, { name: 'Bad Name', clientRequestId: crypto.randomUUID() })).rejects.toThrow(/name/i);

    // A failing repository setup keeps the thread and reports the failure and its output.
    const setup = await workspaceFor(repo('wt-setup', { commands: ['echo lab-setup-output; exit 7'] }), 'wt-setup');
    const failed = await api.createThreadInWorktree({ ...input, workspaceId: setup.id }, { name: `setup-${stamp}`, clientRequestId: crypto.randomUUID() });
    created.push(failed.thread.id);
    expect(failed.setup?.completed).toBe(false);
    expect(`${failed.setup?.error} ${(failed.setup?.output ?? []).join(' ')}`).toMatch(/7|lab-setup-output/);
    expect((await api.threads()).some(t => t.id === failed.thread.id)).toBe(true);
  } finally {
    for (const id of created) await api.deleteThread(id).catch(() => undefined);
  }
});
