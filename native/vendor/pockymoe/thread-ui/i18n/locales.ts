export const SUPPORTED_LOCALES = ['en', 'zh-CN'] as const;
export type Locale = typeof SUPPORTED_LOCALES[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'remote-codex.locale';
export const LOCALE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
] as const;

/** Unsupported languages deliberately fall back to English. Chinese variants use simplified Chinese. */
export function normalizeLocale(value: string | null | undefined, fallback: Locale = DEFAULT_LOCALE): Locale {
  const tag = value?.trim().replaceAll('_', '-').toLowerCase() ?? '';
  if (tag === 'english' || /^en(?:-|$)/.test(tag)) return 'en';
  if (tag === 'chinese' || tag === '中文' || tag === '简体中文' || /^zh(?:-|$)/.test(tag)) return 'zh-CN';
  return fallback;
}

export function detectLocale(stored: string | null | undefined, languages: readonly string[] = []): Locale {
  if (stored?.trim()) return normalizeLocale(stored);
  for (const language of languages) {
    if (/^(en|zh)(?:[-_]|$)/i.test(language.trim())) return normalizeLocale(language);
  }
  return DEFAULT_LOCALE;
}
