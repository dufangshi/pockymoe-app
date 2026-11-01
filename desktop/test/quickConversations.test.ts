import { expect, it } from 'vitest';
import { quickConversations } from '../src/quick/conversations';
import { item } from './fixtures';

it('projects one row across mixed states and searches without dropping conversation members', () => {
  const root = item({ key: 'mac:root', threadId: 'root', title: 'Root conversation' });
  const child = (id: string) => item({ key: `mac:${id}`, threadId: id, rootThreadKey: root.key, rootThreadTitle: 'Old root title', agentName: id });
  const waiting = { ...child('reviewer'), state: 'needsInput' as const, request: { id: 'request', kind: 'approval' as const, summary: 'Run tests?' } };
  const rows = [root, child('planner'), waiting, item({ key: 'pc:other', deviceId: 'pc', threadId: 'other' })];
  const projected = quickConversations(rows);
  expect(projected).toHaveLength(2); expect(projected[0]).toMatchObject({ key: root.key, title: root.title, target: waiting, agentCount: 2 });
  expect(quickConversations(rows, 'planner')).toEqual([projected[0]]);
  expect(quickConversations(rows, 'no match')).toEqual([]);
});
it('uses the root on equal priority, handles absent roots, and never counts the root as a child', () => {
  const root = item({ key: 'mac:root', threadId: 'root', title: 'Root' });
  const child = item({ rootThreadKey: root.key, rootThreadTitle: root.title });
  expect(quickConversations([child, root])[0]).toMatchObject({ target: root, agentCount: 1 });
  expect(quickConversations([child])[0]).toMatchObject({ title: root.title, target: child, agentCount: 1 });
  expect(quickConversations([root])[0].agentCount).toBe(0);
});
