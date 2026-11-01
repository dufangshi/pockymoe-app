import { expect, it } from 'vitest';
import { activitySecondary, conversationKey, conversationTitle, groupActivities } from '../src/shared/activityGroups';
import { validateSnapshot } from '../src/main/activity';
import { item, snapshot } from './fixtures';
const agent = (name: string) => item({ key: `mac:${name}`, threadId: name, agentName: name, rootThreadKey: 'mac:root', rootThreadTitle: '根对话', title: `智能体自己的任务 ${name}` });
it('groups agents under their root while preserving their action keys and stable ordering', () => {
  const a = agent('A'), b = agent('B'), root = item({ key: 'mac:root', threadId: 'root', title: '当前根标题' });
  const groups = groupActivities([a, item(), root, b]);
  expect(groups.map(g => g.key)).toEqual(['mac:root', 'mac:thread-1']);
  expect(groups[0].title).toBe('当前根标题'); expect(groups[0].items.map(i => i.key)).toEqual(['mac:root', 'mac:A', 'mac:B']);
  expect(groupActivities([a, b])[0]).toMatchObject({ key: 'mac:root', title: '根对话' });
  expect(conversationKey(a)).toBe('mac:root'); expect(activitySecondary(a)).toBe('智能体 A · MacBook Pro · remoteCodex');
  expect(conversationTitle(a, [root])).toBe('当前根标题');
});
it('retains validated lineage metadata, rejects malformed roots and safely labels absent titles', () => {
  const a = agent('A'); expect(validateSnapshot(snapshot([a])).items[0]).toMatchObject({ rootThreadKey: 'mac:root', rootThreadTitle: '根对话', key: 'mac:A' });
  expect(conversationTitle({ ...a, rootThreadTitle: null })).toBe('对话 root');
  expect(validateSnapshot(snapshot([{ ...a, rootThreadKey: 'other-device:root' }])).items[0].rootThreadKey).toBe('other-device:root');
  for (const patch of [{ rootThreadKey: 'no-separator' }, { rootThreadKey: 'mac:' }, { rootThreadTitle: 'x'.repeat(513) }]) expect(() => validateSnapshot(snapshot([{ ...a, ...patch }]))).toThrow();
});
