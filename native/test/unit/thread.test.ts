import { describe, expect, it } from 'vitest';
import type { ThreadDetailDto, ThreadEventEnvelope } from '@pockymoe/shared';
import { applyThreadEvent } from '../../src/state/threadEvents';
import { buildTranscript, foldReply, hiddenAmount, promptAttachments, promptPreviewEnd } from '../../src/features/thread/model';
import { parsePatch } from '../../src/features/diff/model';

const detail = (): ThreadDetailDto => ({
  thread: { id: 't', workspaceId: 'w', provider: 'acp', providerSessionId: null, source: 'app' as never, title: 'T', model: 'm', reasoningEffort: null,
    collaborationMode: 'default', approvalMode: 'yolo', status: 'idle', summaryText: null, lastError: null, activeTurnId: null, isLoaded: true, isPinned: false,
    createdAt: '', updatedAt: '', lastTurnStartedAt: null, lastTurnCompletedAt: null },
  workspace: { id: 'w', hostId: 'h', label: 'ws', absPath: '/ws', isFavorite: false, createdAt: '', lastOpenedAt: null },
  workspacePathStatus: 'present', turns: [], pendingRequests: [], pendingSteers: [],
});
const ev = <T extends ThreadEventEnvelope['type']>(type: T, payload: Extract<ThreadEventEnvelope, { type: T }>['payload']) =>
  ({ type, threadId: 't', timestamp: '2026-11-26T00:00:10Z', payload }) as ThreadEventEnvelope;

describe('live events', () => {
  it('starts a turn, streams deltas in order, completes', () => {
    let d = applyThreadEvent(detail(), ev('thread.turn.started', { turnId: 'u1' }));
    expect(d.thread.status).toBe('running');
    d = applyThreadEvent(d, ev('thread.output.delta', { turnId: 'u1', itemId: 'a', sequence: 0, delta: 'Hel' }));
    d = applyThreadEvent(d, ev('thread.output.delta', { turnId: 'u1', itemId: 'a', sequence: 1, delta: 'lo' }));
    // A replayed delta does not duplicate text.
    d = applyThreadEvent(d, ev('thread.output.delta', { turnId: 'u1', itemId: 'a', sequence: 1, delta: 'lo' }));
    expect(d.turns[0]!.items[0]!.text).toBe('Hello');
    d = applyThreadEvent(d, ev('thread.item.completed', { turnId: 'u1', item: { id: 'a', kind: 'agentMessage', text: 'Hello', status: 'completed' } }));
    d = applyThreadEvent(d, ev('thread.turn.completed', { turnId: 'u1', status: 'completed', error: null }));
    expect(d.thread.status).toBe('idle');
    expect(d.thread.activeTurnId).toBeNull();
    expect(d.turns[0]!.status).toBe('completed');
  });
  it('tracks requests', () => {
    const request = { id: 'r', kind: 'requestUserInput' as const, title: 'Q', description: null, turnId: 'u1', itemId: null, createdAt: '', questions: [] };
    let d = applyThreadEvent(detail(), ev('thread.request.created', { request }));
    d = applyThreadEvent(d, ev('thread.request.created', { request }));
    expect(d.pendingRequests).toHaveLength(1);
    d = applyThreadEvent(d, ev('thread.request.resolved', { requestId: 'r' }));
    expect(d.pendingRequests).toHaveLength(0);
  });
});

describe('transcript model', () => {
  it('folds work into one line and keeps the last answer', () => {
    const d = detail();
    d.turns = [{ id: 'u1', startedAt: '2026-11-26T00:00:00Z', completedAt: '2026-11-26T00:00:12Z', status: 'completed', error: null, items: [
      { id: 'p', kind: 'userMessage', text: 'Do it' },
      { id: 'c1', kind: 'commandExecution', text: 'npm test', status: 'completed' },
      { id: 'c2', kind: 'commandExecution', text: 'npm test', status: 'failed' },
      { id: 'n', kind: 'agentMessage', text: 'Looking' },
      { id: 'f', kind: 'fileChange', text: 'src/a.ts', status: 'completed', addedLines: 2, removedLines: 1, changedFiles: 1 },
      { id: 'a', kind: 'agentMessage', text: 'Done.' },
    ] }];
    const [turn] = buildTranscript(d, []);
    expect(turn!.prompt?.text).toBe('Do it');
    expect(turn!.sections.filter(s => s.kind === 'answer').map(s => s.kind === 'answer' && s.item.id)).toEqual(['a']);
    expect(turn!.counts).toMatchObject({ commands: 2, failed: 1, fileChanges: 1, addedLines: 2, removedLines: 1 });
    expect(turn!.files.map(f => f.path)).toEqual(['src/a.ts']);
    expect(turn!.durationMs).toBe(12000);
  });
  it('shows prompts still being sent as their own turns', () => {
    const turns = buildTranscript(detail(), [{ clientRequestId: 'x', text: 'hi', createdAt: '', state: 'sending', attachments: [] }]);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.local?.state).toBe('sending');
  });
  it('folds long replies outside code fences', () => {
    const text = `${'word '.repeat(240)}\n\`\`\`\n${'code\n'.repeat(80)}\`\`\`\n${'tail '.repeat(200)}`;
    const head = foldReply(text)!;
    expect(head.length).toBeLessThan(text.length);
    expect((head.match(/```/g) ?? []).length % 2).toBe(0);
    expect(foldReply('short')).toBeNull();
  });
});

describe('diffs', () => {
  it('splits files and counts lines, including untracked files', () => {
    const { files } = parsePatch('diff --git a/x.ts b/x.ts\nindex 1..2\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n--- /dev/null\n+++ b/new.md\n@@ -0,0 +1 @@\n+hi\n');
    expect(files.map(f => [f.path, f.additions, f.deletions])).toEqual([['x.ts', 1, 1], ['new.md', 1, 0]]);
  });
});

describe('prompt attachments', () => {
  it('splits photo and file markers from the text', () => {
    expect(promptAttachments('Look at this\n[PHOTO ./.temp/threads/t1/cat.png]\n[FILE ./.temp/threads/t1/notes.pdf] please'))
      .toEqual({ text: 'Look at this\n\nplease', photos: ['./.temp/threads/t1/cat.png'], files: ['./.temp/threads/t1/notes.pdf'] });
  });
  it('keeps text without markers and empty markers as they are', () => {
    expect(promptAttachments('plain [PHOTO ] text')).toEqual({ text: 'plain [PHOTO ] text', photos: [], files: [] });
    expect(promptAttachments('[PHOTO a.png]')).toEqual({ text: '', photos: ['a.png'], files: [] });
  });
});

describe('attachment placeholders', () => {
  it('match the Web composer and number repeated names', async () => {
    const { attachmentPlaceholder } = await import('../../src/features/thread/placeholder');
    expect(attachmentPlaceholder('photo', 'cat.png', new Set())).toBe('[PHOTO cat.png]');
    expect(attachmentPlaceholder('file', 'a [b].txt', new Set())).toBe('[FILE a b .txt]');
    expect(attachmentPlaceholder('photo', 'cat.png', new Set(['[PHOTO cat.png]']))).toBe('[PHOTO cat.png (2)]');
  });
  it('let a sent prompt match its stored copy after the paths are rewritten', async () => {
    const { promptMatchKey } = await import('../../src/features/thread/placeholder');
    expect(promptMatchKey('What is this?\n[PHOTO 19.png]')).toBe(promptMatchKey('What is this? [PHOTO ./.temp/threads/t1/19.png]'));
    expect(promptMatchKey('What is this?\n[PHOTO 19.png]')).not.toBe(promptMatchKey('What is this?'));
  });
});

describe('prompt folding (the Web rule)', () => {
  it('shows short prompts whole and folds at 8 lines, 160 words or 600 characters', () => {
    expect(promptPreviewEnd('short prompt')).toBeNull();
    const lines = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n');
    expect(lines.slice(0, promptPreviewEnd(lines)!).split('\n')).toHaveLength(8);
    const words = Array.from({ length: 200 }, () => 'w').join(' ');
    expect(promptPreviewEnd(words)).toBe(320);
    expect(promptPreviewEnd('x'.repeat(900))).toBe(600);
  });
  it('rounds the hidden amount like the Web label', () => {
    expect(hiddenAmount(150)).toBeNull();
    expect(hiddenAmount(449)).toBe(400);
    expect(hiddenAmount(1490)).toBe(1000);
  });
});
