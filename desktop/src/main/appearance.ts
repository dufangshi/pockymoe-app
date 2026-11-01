import type { Appearance } from '../shared/contract';
export function validateAppearance(value: unknown): Appearance {
  if (!value || typeof value !== 'object') throw new Error('Invalid appearance');
  const a = value as Appearance;
  if (!['light', 'dark'].includes(a.effective) || typeof a.pack !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(a.pack) ||
      typeof a.accent !== 'string' || !a.accent.trim() || a.accent.length > 200 || /[;{}<>"\\]/.test(a.accent) || /url\s*\(|var\s*\(/i.test(a.accent) ||
      (a.fontScale !== undefined && (!Number.isFinite(a.fontScale) || a.fontScale < .5 || a.fontScale > 2))) throw new Error('Invalid appearance');
  return { effective: a.effective, pack: a.pack, accent: a.accent.trim(), ...(a.fontScale === undefined ? {} : { fontScale: a.fontScale }) };
}
export class AppearanceStore {
  private current: Appearance | null = null;
  private listeners = new Set<(appearance: Appearance) => void>();
  get = (): Appearance | null => this.current && { ...this.current };
  sync(value: unknown): void {
    const next = validateAppearance(value);
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    this.current = next; for (const listener of this.listeners) listener({ ...next });
  }
  onChange = (listener: (appearance: Appearance) => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
}
