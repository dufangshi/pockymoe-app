import { describe, expect, it } from 'vitest';
import { commandErrorMessage } from './errors';
describe('pet command failure wording', () => {
  it('localizes needsThread codes without exposing an internal code as prose', () => {
    expect(commandErrorMessage({ ok: false, code: 'needsThread', error: 'Use the full thread' }, 'zh-CN')).toBe('请在线程中完成此操作。');
    expect(commandErrorMessage({ ok: false, code: 'needsThread' }, 'en-US')).toBe('Complete this action in the thread.');
    expect(commandErrorMessage({ ok: false, error: 'needsThread' }, 'en')).toBe('Complete this action in the thread.');
  });
  it('re-localizes app-owned failures after the page language changes', () => {
    expect(commandErrorMessage({ ok: false, error: 'This request is no longer awaiting approval.' }, 'zh-CN')).toBe('此请求已不再等待批准。');
    expect(commandErrorMessage({ ok: false, error: '此请求已不再等待批准。' }, 'en')).toBe('This request is no longer awaiting approval.');
  });
  it('retains a supplied reason and localizes missing-reason fallbacks', () => {
    expect(commandErrorMessage({ ok: false, error: 'Request expired' }, 'en')).toBe('Request expired');
    expect(commandErrorMessage({ ok: false }, 'zh-CN')).toContain('在线程中');
    expect(commandErrorMessage({ ok: false }, 'en')).toContain('continue in the thread');
  });
});
