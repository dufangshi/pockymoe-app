import type { HostCommandResult } from '../shared/contract';
import { resolveLocale } from '../shared/i18n';

export function commandErrorMessage(result: HostCommandResult, locale: string): string {
  const chinese = resolveLocale(locale) === 'zh-CN';
  if (result.code === 'needsThread' || result.error === 'needsThread') return chinese ? '请在线程中完成此操作。' : 'Complete this action in the thread.';
  const known = [
    ['This request is no longer awaiting approval.', '此请求已不再等待批准。'],
    ['Please enter a reply (maximum 16000 characters).', '请输入回复（最多16000个字符）。'],
    ['The main window is unavailable. Try again.', '主窗口暂时无法连接，请稍后重试。'],
    ['This thread is no longer active.', '线程已不在活动列表中。'],
    ['Could not save the pet position.', '无法保存桌宠位置。'],
    ['No valid Codex v1 pet pack is installed.', '没有可用的 Codex v1 宠物包。'],
  ].find((pair) => pair.includes(result.error ?? ''));
  if (known) return known[chinese ? 1 : 0];
  return result.error || (chinese ? '操作未完成，请重试或在线程中继续。' : 'The action could not be completed. Try again or continue in the thread.');
}
