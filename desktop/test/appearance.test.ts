import { expect, it } from 'vitest';
import { AppearanceStore, validateAppearance } from '../src/main/appearance';
import { activityStatus, statusMarkSvg, statusMarkStyles } from '../src/shared/statusMarks';
import { elapsed } from '../src/quick/view';
it('validates and broadcasts cloned appearances without duplicate notifications', () => {
  const store = new AppearanceStore(), seen: string[] = [];
  store.onChange(a => seen.push(a.pack));
  store.sync({ effective: 'dark', pack: 'plum-pocket', accent: 'oklch(.8 .15 70)', fontScale: 1.2 });
  store.sync(store.get()); expect(seen).toEqual(['plum-pocket']);
  store.get()!.pack = 'modified'; expect(store.get()!.pack).toBe('plum-pocket');
  for (const value of [{ effective: 'other', pack: 'classic', accent: '#fff' }, { effective: 'light', pack: 'x', accent: 'url(https://bad)' }, { effective: 'dark', pack: 'classic', accent: '#fff', fontScale: 10 }]) expect(() => validateAppearance(value)).toThrow();
});
it('uses static upstream shapes and accessible labels in every motion preference', () => {
  expect(statusMarkSvg('running')).toContain('stroke-dasharray="23 10"'); expect(statusMarkSvg('running').match(/<circle/g)).toHaveLength(1);
  expect(statusMarkSvg('waiting')).toContain('data-status="waiting"'); expect(statusMarkSvg('interrupted')).toContain('<rect'); expect(statusMarkSvg('failed')).toContain('m8 2 6 6-6 6-6-6Z');
  expect(statusMarkSvg('idle', '<unsafe>')).toContain('&lt;unsafe&gt;'); expect(statusMarkStyles).not.toMatch(/animation|keyframes|transition/); expect(statusMarkSvg('agents-running').match(/<circle/g)).toHaveLength(2);
  expect(activityStatus({ state: 'interrupted', unread: true })).toBe('interrupted'); expect(activityStatus({ state: 'completed', unread: true })).toBe('unread');
});
it('renders elapsed running time as a duration, never a clock reading', () => {
  expect(elapsed('2026-11-01T00:00:00Z', Date.parse('2026-11-01T00:00:45Z'))).toBe('45s');
  expect(elapsed('2026-11-01T00:00:00Z', Date.parse('2026-11-01T00:12:21Z'))).toBe('12m');
  expect(elapsed('2026-11-01T00:00:00Z', Date.parse('2026-11-01T03:05:21Z'))).toBe('3h 5m');
  expect(elapsed('2026-11-02T00:00:00Z', Date.parse('2026-11-01T00:00:00Z'))).toBe('0s');
});
