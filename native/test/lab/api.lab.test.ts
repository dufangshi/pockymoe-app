// Every DeviceApi call the screens make, against a lab relay device with the fake runtime:
// routes, methods and bodies must be the ones the Supervisor takes. Creates and deletes its
// own thread.   LAB=… npx vitest run --config vitest.lab.config.mts test/lab/api.lab.test.ts
import { expect, it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { workspaceBody } from '../../src/features/workspaces/workspaceInput';
import { LAB, labDevice, waitFor } from './labSession';

it('drives the device API end to end', async () => {
  const { api } = await labDevice();
  expect((await api.version()).version).toBeTruthy();
  let workspaces = await api.workspaces();
  if (!workspaces.length) {
    // A fresh direct Supervisor: add a folder workspace the way AddWorkspaceSheet does.
    const dir = join(LAB, 'local/ws/api-test'); mkdirSync(dir, { recursive: true });
    await api.raw('/api/workspaces', { method: 'POST', body: JSON.stringify(workspaceBody('path', dir, 'api-test', null)), headers: { 'content-type': 'application/json' } });
    workspaces = await api.workspaces();
  }
  const workspace = workspaces.find(w => w.label === 'pockymoe') ?? workspaces[0]!;
  const runtime = (await api.runtimes()).find(r => r.enabled)!;
  const models = await api.runtimeModels(runtime.provider);
  expect(models.length).toBeGreaterThan(0);
  await api.runtimeAgents('acp');

  const thread = await api.createThread({ workspaceId: workspace.id, provider: runtime.provider, model: models[0]!.model, approvalMode: 'yolo' });
  try {
    expect((await api.threads()).some(t => t.id === thread.id)).toBe(true);
    await api.prompt(thread.id, { prompt: 'Say hello from the API test', clientRequestId: crypto.randomUUID() });
    const done = await waitFor(async () => { const d = await api.threadDetail(thread.id); return d.turns.length && !d.thread.activeTurnId && d.thread.status !== 'running' ? d : null; }, 'the first turn');
    const turn = done.turns.at(-1)!;
    expect(turn.items.some(i => i.kind === 'userMessage' && i.text.includes('Say hello'))).toBe(true);
    expect((await api.turnDetail(thread.id, turn.id)).id).toBe(turn.id);
    const reply = turn.items.find(i => i.kind === 'agentMessage');
    if (reply) expect(typeof (await api.itemDetail(thread.id, reply.id)).text).toBe('string');
    await api.threadModels(thread.id);
    // The picker's handoff note reads these fields (crates/runtime/src/service/handoff.rs).
    const preview = await api.harnessPreview(thread.id, { provider: 'acp', agentId: 'claude', model: null });
    expect(typeof preview.turns).toBe('number');
    expect(typeof preview.text).toBe('string');
    expect(typeof preview.resumesSession).toBe('boolean');
    expect(Array.isArray(preview.omittedTurns)).toBe(true);
    expect(typeof (await api.modelPricing()).models).toBe('object');
    expect((await api.threadCapabilities(thread.id)).effectiveCapabilities).toBeTruthy();

    const renamed = await api.rename(thread.id, 'API test thread');
    expect(renamed.title).toBe('API test thread');
    await api.updateSettings(thread.id, { model: models[0]!.model });
    await api.search('API test');
    await api.compact(thread.id);

    // A held turn: a second prompt queues as a pending steer, which can be cancelled or steered.
    const events = (body: object) => api.raw('/api/e2e/events', { method: 'POST', body: JSON.stringify({ threadId: thread.id, ...body }), headers: { 'content-type': 'application/json' } });
    // The fake runtime can take longer than the fixture's 3 s to start a turn, and the turn
    // can be active a moment before its controller is: attach again until it answers.
    await waitFor(() => events({ type: 'start' }).then(() => true, () => false), 'the held turn', 60);
    await api.prompt(thread.id, { prompt: 'Queued while running', clientRequestId: crypto.randomUUID() });
    const queued = await waitFor(async () => (await api.threadDetail(thread.id)).pendingSteers.at(0), 'a pending steer');
    await api.cancelSteer(thread.id, queued.id);
    await waitFor(async () => (await api.threadDetail(thread.id)).pendingSteers.length === 0, 'the cancelled steer to go');
    await api.prompt(thread.id, { prompt: 'Steer this in', clientRequestId: crypto.randomUUID() });
    const steer = await waitFor(async () => (await api.threadDetail(thread.id)).pendingSteers.at(0), 'a second pending steer');
    await api.steerNow(thread.id, steer.id);

    // An approval answered the way RequestCard answers it.
    await events({ type: 'approval' });
    const request = await waitFor(async () => (await api.threadDetail(thread.id)).pendingRequests.at(0), 'the approval');
    // The fixture's approval is a permission request without questions: allowed as a whole.
    const option = request.questions[0]?.options?.[0]?.label;
    await api.respond(thread.id, request.id, option ? { answers: { [request.questions[0]!.id]: { answers: [option] } } } : { allow: true });
    await waitFor(async () => (await api.threadDetail(thread.id)).pendingRequests.length === 0, 'the approval to close');

    await api.interrupt(thread.id);
    await waitFor(async () => { const d = await api.threadDetail(thread.id); return !d.thread.activeTurnId && d.thread.status !== 'running'; }, 'the stop');
    await api.release(thread.id, { interrupt: true });
  } finally {
    await api.deleteThread(thread.id);
  }
  expect((await api.threads()).some(t => t.id === thread.id)).toBe(false);
}, 300_000);
