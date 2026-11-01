import type { HostCommandResult } from '../shared/contract';
import { localizeMessage, t } from '../shared/i18n';

export function commandErrorMessage(result: HostCommandResult, locale: string): string {
  if (result.code === 'needsThread' || result.error === 'needsThread') return t('请在线程中完成此操作。', {}, locale);
  return result.error ? localizeMessage(result.error, locale) : t('操作未完成，请重试或在线程中继续。', {}, locale);
}
