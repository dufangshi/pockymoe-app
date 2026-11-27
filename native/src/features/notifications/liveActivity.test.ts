import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ThreadDto } from '@pockymoe/shared';
import { buildActivitySnapshot } from './activitySnapshot';

const root = join(__dirname, '../../..');
describe('Live Activity Swift shared between the widget and the app module', () => {
  it.each(['ActivityPolicy.swift', 'ActivityMetadataCache.swift', 'LiveActivityAttributes.swift'])('%s is the same in both targets', name => {
    expect(readFileSync(join(root, 'modules/pockymoe-native/ios/LiveActivity', name), 'utf8')).toBe(readFileSync(join(root, 'targets/live-activity', name), 'utf8'));
  });
});

const now = Date.parse('2026-11-27T12:00:00.000Z');
const thread = (id: string, extra: Partial<ThreadDto>) => ({ id, title: `Thread ${id}`, workspaceId: 'w', status: 'idle', activeTurnId: null, lastTurnStartedAt: null,
  lastTurnCompletedAt: '2026-11-27T11:50:00.000Z', updatedAt: '2026-11-27T11:55:00.000Z', ...extra }) as ThreadDto;

describe('buildActivitySnapshot', () => {
  it('maps thread states like the Web and keys conversations by device and root', () => {
    const snapshot = buildActivitySnapshot('user-1', [{ deviceId: 'dev', name: 'Studio', workspaces: [{ id: 'w', label: 'notes' } as never], waiting: { ask: 1 },
      threads: [
        thread('run', { status: 'running', activeTurnId: 't', lastTurnStartedAt: '2026-11-27T11:58:00.000Z' }),
        thread('ask', {}),
        thread('bad', { status: 'failed' }),
        thread('old', { status: 'failed', lastTurnCompletedAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-20T00:00:00.000Z' }),
        thread('done', {}),
        thread('read', {}),
        thread('child', { status: 'running', activeTurnId: 'c', rootThreadId: 'run', lastTurnStartedAt: '2026-11-27T11:59:00.000Z' }),
        thread('gone', { status: 'running', closedAt: '2026-11-27T11:00:00.000Z' }),
      ] }], (_d, t) => t.id === 'done', now);
    expect(snapshot.accountId).toBe('user-1');
    expect(snapshot.items.map(i => [i.threadId, i.state])).toEqual([['ask', 'needsInput'], ['bad', 'failed'], ['done', 'completed'], ['run', 'running'], ['child', 'running']]);
    const child = snapshot.items.find(i => i.threadId === 'child')!;
    expect(child).toMatchObject({ key: 'dev:child', rootThreadKey: 'dev:run', rootThreadTitle: 'Thread run', deviceName: 'Studio', workspaceLabel: 'notes', since: '2026-11-27T11:59:00.000Z' });
    expect(snapshot.items.find(i => i.threadId === 'run')).not.toHaveProperty('rootThreadKey');
  });
});
