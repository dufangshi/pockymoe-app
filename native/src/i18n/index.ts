// The shared UI's i18n API (`@pockymoe/thread-ui/i18n`) for native code and for the
// vendored Web modules. Messages are the shared UI's own bundles (vendored), plus the few
// native-only strings in ./native.*.ts. Resolution and plurals match the shared UI.
import { useSyncExternalStore } from 'react';
import { getLocales } from 'expo-localization';
import { en } from '../../vendor/pockymoe/thread-ui/i18n/en';
import { zhCN } from '../../vendor/pockymoe/thread-ui/i18n/zh-CN';
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, detectLocale, normalizeLocale, type Locale } from '../../vendor/pockymoe/thread-ui/i18n/locales';
import { nativeEn } from './native.en';
import { nativeZhCN } from './native.zh-CN';
import { polishEn } from './polish.en';
import { polishZhCN } from './polish.zh-CN';
import { reviewEn } from './review.en';
import { reviewZhCN } from './review.zh-CN';
import { prefs } from '../platform/prefs';

export * from '../../vendor/pockymoe/thread-ui/i18n/locales';
type Message = string | { one: string; other: string };
const bundles = { en: { ...en, ...nativeEn, ...polishEn, ...reviewEn }, 'zh-CN': { ...zhCN, ...nativeZhCN, ...polishZhCN, ...reviewZhCN } } as const;
export type TranslationKey = keyof typeof en | keyof typeof nativeEn | keyof typeof polishEn | keyof typeof reviewEn;
export type TranslationValues = Record<string, string | number | boolean | null | undefined>;

let locale: Locale | undefined;
const listeners = new Set<() => void>();
export function getLocale(): Locale {
  if (!locale) {
    let languages: string[] = [];
    try { languages = getLocales().map(l => l.languageTag); } catch { /* Tests run without the native module. */ }
    locale = detectLocale(prefs.get(LOCALE_STORAGE_KEY), languages);
  }
  return locale;
}
export function setLocale(value: string, persist = true) {
  const next = normalizeLocale(value);
  if (persist) prefs.set(LOCALE_STORAGE_KEY, next);
  if (next === getLocale()) return;
  locale = next;
  listeners.forEach(listener => listener());
}
/** Follow the system language again. */
export function clearLocaleOverride() { prefs.set(LOCALE_STORAGE_KEY, null); locale = undefined; setLocale(getLocale(), false); listeners.forEach(l => l()); }
export function hasLocaleOverride() { return !!prefs.get(LOCALE_STORAGE_KEY); }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function resolveTranslation(target: Locale, key: TranslationKey, values: TranslationValues = {}): string {
  const entry = ((bundles[target] as Record<string, Message>)[key] ?? (bundles.en as Record<string, Message>)[key]);
  if (!entry) throw new Error(`Missing translation key: ${key}`);
  const template = typeof entry === 'string' ? entry : entry[new Intl.PluralRules(target).select(Number(values.count)) === 'one' ? 'one' : 'other'];
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    if (!(name in values)) throw new Error(`Missing interpolation value ${name} for ${key}`);
    return String(values[name] ?? '');
  });
}
/** Product copy only. User and model text, commands, IDs and server errors stay untouched. */
export function translate(key: TranslationKey, values?: TranslationValues): string { return resolveTranslation(getLocale(), key, values); }
export const t = translate;
export function formatDate(value: string | number | Date, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : new Intl.DateTimeFormat(getLocale(), options).format(date);
}
export function formatNumber(value: number, options?: Intl.NumberFormatOptions) { return new Intl.NumberFormat(getLocale(), options).format(value); }
export function useI18n() {
  const current = useSyncExternalStore(subscribe, getLocale, () => DEFAULT_LOCALE);
  return { locale: current, setLocale, t: translate, formatDate, formatNumber };
}
