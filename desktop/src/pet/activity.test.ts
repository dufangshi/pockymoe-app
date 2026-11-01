import { describe, expect, it } from 'vitest';
import type { ActivityEvent, ActivityItem } from '../shared/contract';
import { BubbleQueue, bubbleConversationCount } from './bubbles';
const child = (id: string, root = 'd:root'): ActivityItem => ({ key: `d:${id}`, threadId: id, deviceId: 'd', deviceName: 'Mac', workspaceId: 'w', workspaceLabel: 'Project', title: `Agent task ${id}`, agentName: id, rootThreadKey: root, rootThreadTitle: 'Conversation', state: 'needsInput', since: new Date(0).toISOString(), unread: true, request: { id: `request-${id}`, kind: 'approval', summary: 'Run tests' } });
const alert = (item: ActivityItem, type: ActivityEvent['type'] = 'needsInput'): ActivityEvent => ({ item, type, alertId: `d:${item.request?.id ?? item.turnId}`, at: new Date(0).toISOString() });
describe('conversation bubbles retain actual thread/request identities', () => {
  it('groups sibling agent requests into one conversation without suppressing either alert', () => {
    const queue = new BubbleQueue(), a = alert(child('a')), b = alert(child('b'));
    expect(queue.push(a, 0)).toBe(true); expect(queue.push(b, 20)).toBe(true);
    expect(queue.pending).toHaveLength(1); expect(queue.current?.events).toEqual([a, b]); expect(bubbleConversationCount(queue.current!)).toBe(1);
    expect(queue.push(a, 30)).toBe(false);
  });
  it('acknowledges or resolves only the actual agent and preserves its sibling request', () => {
    const queue = new BubbleQueue(), a = alert(child('a')), b = alert(child('b')), c = alert(child('c'));
    queue.push(a, 0); queue.push(b, 10); queue.push(c, 20);
    queue.acknowledge(a.alertId, 30); expect(queue.current?.events.map((event) => event.alertId)).toEqual([b.alertId, c.alertId]);
    queue.resolve(b.item.key, 40); expect(queue.current?.events).toEqual([c]); queue.resolve(c.item.key, 50); expect(queue.current).toBeNull();
  });
  it('keeps a newer request on the same actual thread when the prior alert is acknowledged', () => {
    const queue = new BubbleQueue(), first = alert(child('a')), next = { ...first, alertId: 'd:next-request', item: { ...first.item, request: { ...first.item.request!, id: 'next-request' } } };
    queue.push(first, 0); queue.push(next, 30000); queue.acknowledge(first.alertId, 30001); expect(queue.current?.events).toEqual([next]);
  });
  it('preserves a previously published bubble snapshot while sibling alerts are removed', () => {
    const queue = new BubbleQueue(), a = alert(child('a')), b = alert(child('b'));
    queue.push(a, 0); queue.push(b, 10); const published = queue.current!;
    queue.acknowledge(a.alertId, 20); queue.resolve(b.item.key, 30);
    expect(queue.current).toBeNull(); expect(published.events).toEqual([a, b]);
  });
  it('counts completed conversations rather than the number of agent completion events', () => {
    const queue = new BubbleQueue();
    const a = alert({ ...child('a'), state: 'completed', request: null, turnId: 'turn-a' }, 'completed');
    const b = alert({ ...child('b'), state: 'completed', request: null, turnId: 'turn-b' }, 'completed');
    const c = alert({ ...child('c', 'd:other-root'), state: 'completed', request: null, turnId: 'turn-c' }, 'completed');
    queue.push(a, 0); queue.push(b, 10); expect(bubbleConversationCount(queue.current!)).toBe(1);
    queue.push(c, 20); expect(queue.current?.events).toHaveLength(3); expect(bubbleConversationCount(queue.current!)).toBe(2);
    queue.acknowledge(a.alertId, 30); expect(bubbleConversationCount(queue.current!)).toBe(2); queue.acknowledge(b.alertId, 40); expect(queue.current?.events).toEqual([c]);
  });
  it('keeps different conversations separate and preserves the per-actual-thread rate limit', () => {
    const queue = new BubbleQueue(), a = alert(child('a')), b = alert(child('b', 'd:other'));
    queue.push(a, 0); queue.push(b, 10); expect(queue.pending).toHaveLength(2);
    const nextRequest = { ...a, alertId: 'd:another-request' }; expect(queue.push(nextRequest, 29999)).toBe(false);
    expect(queue.push({ ...nextRequest, alertId: 'd:after-window' }, 30000)).toBe(true); expect(queue.pending).toHaveLength(2);
  });
});
