import { describe, expect, it } from 'vitest';
import type { ActivityItem } from '../shared/contract';
import { panelConversations, petConversations, petMetadata, replyTarget, rootTarget } from './conversations';
const root: ActivityItem = { key: 'mac:root', threadId: 'root', deviceId: 'mac', deviceName: 'Mac', workspaceId: 'w', workspaceLabel: 'Pockymoe', title: 'app', state: 'idle', since: new Date(0).toISOString(), unread: false };
const child = (id: number, state: ActivityItem['state'] = 'running'): ActivityItem => ({ ...root, key: `mac:child-${id}`, threadId: `child-${id}`, rootThreadKey: root.key, rootThreadTitle: root.title, agentName: `relay-${id}`, state, unread: true,
  request: state === 'needsInput' ? { id: `request-${id}`, kind: 'approval', summary: `cargo test -p check-${id}` } : null });
describe('one pet row per conversation', () => {
  it('collapses a root plus five children and keeps a duplicate-title root on another device distinct', () => {
    const twin = { ...root, key: 'linux:root', deviceId: 'linux', deviceName: 'Linux' };
    const groups = petConversations([root, ...Array.from({ length: 5 }, (_, i) => child(i, i === 2 ? 'needsInput' : 'running')), twin]);
    expect(groups.map(group => group.key)).toEqual(['mac:root', 'linux:root']); expect(new Set(groups.map(group => group.key)).size).toBe(groups.length);
    expect(groups.map(group => group.title)).toEqual(['app', 'app']); expect(groups[0].children).toHaveLength(5); expect(groups[0].statusItem.key).toBe('mac:child-2');
  });
  it('uses the highest-priority mark and ignores an already-read completion when a child runs', () => {
    const groups = petConversations([{ ...root, state: 'completed' }, child(0)]); expect(groups[0].statusItem.state).toBe('running');
    expect(petConversations([root, child(0, 'failed'), child(1, 'completed'), child(2, 'needsInput')])[0].statusItem.state).toBe('needsInput');
  });
  it('keeps all pending requests separate and replies to the root until a specific request is selected', () => {
    const a = child(0, 'needsInput'), b = child(1, 'needsInput'), [group] = petConversations([root, a, b]);
    expect(group.requests.map(item => item.request?.id)).toEqual(['request-0', 'request-1']);
    expect(replyTarget(group, null).threadId).toBe('root'); expect(replyTarget(group, b.key).threadId).toBe(b.threadId); expect(replyTarget(group, 'missing').threadId).toBe('root');
  });
  it('synthesizes the actual root route when the root itself has no activity', () => {
    const a = child(0, 'needsInput'), [group] = petConversations([a]);
    expect(group.root).toMatchObject({ key: root.key, threadId: root.threadId, title: root.title, request: null });
    expect(rootTarget(a).key).toBe(root.key); expect(replyTarget(group, null).key).toBe(root.key); expect(group.statusItem.key).toBe(a.key);
  });
  it('deduplicates repeated item keys and recent entries without merging equal titles across devices', () => {
    expect(petConversations([root, child(0), child(0), root])[0].children).toHaveLength(1);
    expect(panelConversations([], [root, root, { ...root, key: 'linux:root', deviceId: 'linux' }])).toHaveLength(2);
  });
  it('keeps repeated metadata out of visible wording and never adds a role prefix', () => {
    expect(petMetadata(child(0))).toBe('Mac · Pockymoe');
    expect(petMetadata(child(0))).not.toMatch(/智能体|Agent/); expect(petConversations([root, child(0)])[0].children[0].agentName).toBe('relay-0');
  });
});
