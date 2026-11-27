// Small synchronous preferences (theme, locale, last connection), read before first render.
import Storage from 'expo-sqlite/kv-store';

export const prefs = {
  get(key: string): string | null { try { return Storage.getItemSync(key); } catch { return null; } },
  set(key: string, value: string | null) {
    try { if (value === null) Storage.removeItemSync(key); else Storage.setItemSync(key, value); } catch { /* Preferences are best effort. */ }
  },
  getJson<T>(key: string): T | null { const raw = prefs.get(key); if (!raw) return null; try { return JSON.parse(raw) as T; } catch { return null; } },
  setJson(key: string, value: unknown) { prefs.set(key, value === null ? null : JSON.stringify(value)); },
};
