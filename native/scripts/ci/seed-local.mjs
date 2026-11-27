// Seeds a local fake-runtime Supervisor for the iOS screenshot flow: a git workspace and two
// threads (a worked turn with commands, an edit and a markdown answer; a short reply).
//   node seed-local.mjs <base url> <workspace dir>
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const [base, dir] = process.argv.slice(2);
const api = async (path, init = {}) => {
  const res = await fetch(base + path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
};
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/README.md`, '# notes\n\nSample workspace for the iOS screenshots.\n');
const git = (...a) => execFileSync('git', ['-c', 'user.name=ci', '-c', 'user.email=ci@example.invalid', ...a], { cwd: dir });
git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'init');
const workspace = await api('/api/workspaces', { method: 'POST', body: JSON.stringify({ absPath: dir, label: 'notes' }) });
const workspaceId = workspace?.id ?? (await api('/api/workspaces')).find(w => w.absPath === dir).id;
const runtime = (await api('/api/agent-runtimes')).find(r => r.enabled && r.provider !== 'acp') ?? (await api('/api/agent-runtimes')).find(r => r.enabled);
const models = await api(`/api/agent-runtimes/${runtime.provider}/models`);
const model = (models.find(m => m.isDefault) ?? models[0]).model;
const start = async prompt => {
  const thread = await api('/api/threads/start', { method: 'POST', body: JSON.stringify({ workspaceId, provider: runtime.provider, model, approvalMode: 'yolo' }) });
  await api(`/api/threads/${thread.id}/prompt`, { method: 'POST', body: JSON.stringify({ prompt }) });
  return thread.id;
};
const ids = [
  await start('Split prompt-queue.ts into a durable queue'),
  await start('Reply with exactly ## Release notes\n\n- The queue is **durable** now.\n- See `queue-store.ts`.\n\n```ts\nconst store = openQueueStore(file);\n```'),
];
// Wait for both turns to finish (the demo turn takes about 12 s).
for (let i = 0; i < 60; i++) {
  const threads = await api('/api/threads');
  if (ids.every(id => threads.find(t => t.id === id)?.status === 'idle')) break;
  await new Promise(r => setTimeout(r, 1000));
}
console.log(JSON.stringify({ workspaceId, threads: ids }));
