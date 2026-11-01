import { beforeEach, expect, it } from 'vitest';
import { english, getLocale, localizeMessage, resolveLocale, setLocale, t } from '../src/shared/i18n';
import { AppearanceStore, validateAppearance } from '../src/main/appearance';
import { activitySecondary } from '../src/shared/activityGroups';
import { statusMarkSvg } from '../src/shared/statusMarks';
import { item } from './fixtures';
beforeEach(() => setLocale('en'));
it('resolves supported UI languages and interpolates complete messages', () => {
  expect(resolveLocale('zh-Hans-CN')).toBe('zh-CN'); expect(resolveLocale('en-US')).toBe('en'); expect(resolveLocale('fr-FR')).toBe('en');
  expect(t('暂停至 {time}', { time: '18:00' })).toBe('Snoozed until 18:00');
  setLocale('zh-CN'); expect(t('{count} 个线程', { count: 2 })).toBe('2 个线程'); expect(localizeMessage('Invalid shortcut')).toBe('快捷键无效');
  expect(Object.values(english).every(value => !!value.trim())).toBe(true);
});
it('updates language before appearance listeners and retains a missing optional locale', () => {
  const store = new AppearanceStore(), observed: string[] = [];
  store.onChange(() => observed.push(getLocale()));
  store.sync({ effective: 'light', pack: 'classic', accent: '#a57224', locale: 'zh-CN' });
  expect(observed).toEqual(['zh-CN']);
  store.sync({ effective: 'dark', pack: 'classic', accent: '#a57224' }); expect(getLocale()).toBe('zh-CN');
  expect(() => validateAppearance({ effective: 'light', pack: 'classic', accent: '#fff', locale: '<bad>' })).toThrow();
});
it('localizes shared agent/status labels without altering user content', () => {
  const agent = item({ agentName: 'Planner', rootThreadKey: 'mac:root' });
  expect(activitySecondary(agent)).toBe('Agent Planner · MacBook Pro · remoteCodex');
  expect(statusMarkSvg('waiting')).toContain('aria-label="Waiting for you"');
  setLocale('zh-CN'); expect(activitySecondary(agent)).toBe('智能体 Planner · MacBook Pro · remoteCodex');
  expect(statusMarkSvg('waiting')).toContain('aria-label="等待你"');
});
