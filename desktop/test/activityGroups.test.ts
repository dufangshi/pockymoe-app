import { setLocale } from '../src/shared/i18n';
import { beforeEach, expect, it } from 'vitest';
import { activitySecondary, alertTitle, spokenActivityTitle, conversationKey, conversationTitle, groupActivities } from '../src/shared/activityGroups';
import { validateSnapshot } from '../src/main/activity';
import { item, snapshot } from './fixtures';
beforeEach(() => setLocale('zh-CN'));
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

it('names agent alerts and speech in both languages, preserves root titles and whole agent names', () => {
  const a = { ...agent('terminal'), rootThreadTitle: 'app' }, b = { ...agent('tests'), rootThreadTitle: 'app' };
  for (const locale of ['zh-CN', 'en']) {
    setLocale(locale);
    expect(alertTitle([a])).toBe('app.terminal');
    expect(alertTitle([{ ...a, agentName: null }])).toBe(locale === 'en' ? 'app.agent' : 'app.智能体');
    expect(alertTitle([a, b])).toBe(locale === 'en' ? 'app · 2 child threads' : 'app · 2 个子线程');
    expect(alertTitle([a, a])).toBe('app.terminal');
    expect(alertTitle([item({ title: 'app' })])).toBe('app');
    expect(spokenActivityTitle(a)).toBe(locale === 'en' ? "app's agent thread terminal" : 'app 的子线程 terminal');
    expect(alertTitle([{ ...a, rootThreadTitle: 'a'.repeat(80) }], [], true)).toBe('a'.repeat(16) + '…' + 'a'.repeat(15) + '.terminal');
  }
});
