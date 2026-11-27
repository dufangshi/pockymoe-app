import { translate, type TranslationKey } from '../../i18n';

/** A reasoning level in the reader's language (ui-principles §13), as the shared UI's
 *  formatReasoningEffortLabel; a level this build does not know keeps the harness's word. */
export function effortLabel(effort: string | null | undefined) {
  if (!effort) return translate('native.effortDefault');
  if (['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort)) return translate(`chat.effortLevel.${effort}` as TranslationKey);
  return effort;
}
