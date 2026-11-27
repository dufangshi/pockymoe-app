// Development builds only: deep links that set appearance, for the screenshot matrix
// (`<scheme>://dev/appearance?preset=terminal&mode=dark&locale=zh-CN`).
import * as Linking from 'expo-linking';
import { setModePref, setPreset, type ModePref, type PresetId } from '../design/theme';
import { setLocale } from '../i18n';

export function installDevLinks() {
  if (!__DEV__) return () => undefined;
  const handle = (url: string | null) => {
    if (!url) return;
    const parsed = Linking.parse(url);
    if ([parsed.hostname, parsed.path].filter(Boolean).join('/') !== 'dev/appearance') return;
    const q = parsed.queryParams ?? {};
    if (typeof q.preset === 'string') setPreset(q.preset as PresetId);
    if (typeof q.mode === 'string') setModePref(q.mode as ModePref);
    if (typeof q.locale === 'string') setLocale(q.locale);
  };
  void Linking.getInitialURL().then(handle);
  const sub = Linking.addEventListener('url', e => handle(e.url));
  return () => sub.remove();
}
