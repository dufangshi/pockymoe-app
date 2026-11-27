import { translate, type TranslationKey } from '../../i18n';
import { failureMessage } from '../graph-chat/turnPrompts';

// Turn errors the Supervisor writes itself, in English; shown in the reader's
// language. Errors from a harness are shown as they came.
const KNOWN: Record<string, TranslationKey> = {
  'Backend completion was not confirmed before the Supervisor connection ended. Reconnect to verify before continuing.': 'chat.errorCompletionUnconfirmed',
};

export function turnErrorText(error: string) {
  const key = KNOWN[error.trim()];
  return key ? translate(key) : error;
}

/** Common harness failures, recognised by their error kind or wording. */
const KINDS: Array<{ key: TranslationKey; kind: RegExp; text: RegExp }> = [
  { key: 'chat.errorRateLimit', kind: /rate_limit|quota|usage_limit/i, text: /rate limit|spend limit|usage limit|quota|hit your .*limit|too many requests|\b429\b/i },
  { key: 'chat.errorModelNotFound', kind: /model_not_found/i, text: /model.*(not found|does not exist|not available)|unknown model|issue with the selected model/i },
  { key: 'chat.errorAuth', kind: /auth|permission|unauthori[sz]ed/i, text: /unauthori[sz]ed|invalid api key|authentication|\b401\b|\b403\b/i },
  { key: 'chat.errorServer', kind: /server_error|overloaded|timeout/i, text: /api error: 5\d\d|internal server error|overloaded|bad gateway|gateway timeout|\b52\d\b/i },
  { key: 'chat.errorConnectionLost', kind: /$^/, text: /connection lost|connection ended|reader failed|transport limit|broken pipe|connection reset|disconnected/i },
];

/**
 * A turn's error as one readable sentence in the reader's language, with the
 * raw error kept as small print (ui-principles §11: past failures show the
 * reason, the original error rides along in small type).
 */
export function describeTurnError(error: string): { message: string; detail: string | null } {
  const raw = error.trim();
  const known = KNOWN[raw];
  if (known) return { message: translate(known), detail: null };
  const kind = /"errorKind"\s*:\s*"([^"]+)"/.exec(raw)?.[1] ?? '';
  const readable = failureMessage(raw);
  const match = KINDS.find(entry => (kind && entry.kind.test(kind)) || entry.text.test(readable));
  if (match) return { message: translate(match.key), detail: raw };
  return { message: translate('chat.errorTurnUnfinished', { reason: readable }), detail: readable === raw ? null : raw };
}
