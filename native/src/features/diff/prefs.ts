// Diff preferences, remembered on this device like the Web remembers them per browser
// (`pockymoe.git.diff`): layout, whitespace, default folding, wrapping and the colours.
import { prefs } from '../../platform/prefs';
import { createStore } from '../../state/store';

export interface DiffPrefs {
  /** Side by side where the viewer is wide enough (≥ 720 dp), else unified. */
  split: boolean;
  /** Ask the Supervisor to ignore whitespace (`ignoreWhitespace=1`). */
  whitespace: boolean;
  /** Files start folded. */
  collapsed: boolean;
  /** Wrap long lines; null follows the width (wrap on phones, scroll sideways on wide windows). */
  wrap: boolean | null;
  /** Blue and orange instead of green and red. */
  colorblind: boolean;
}
const KEY = 'pockymoe.git.diff';
const read = (): DiffPrefs => {
  const saved = prefs.getJson<Partial<DiffPrefs>>(KEY) ?? {};
  return { split: !!saved.split, whitespace: !!saved.whitespace, collapsed: !!saved.collapsed, wrap: typeof saved.wrap === 'boolean' ? saved.wrap : null, colorblind: !!saved.colorblind };
};
export const diffPrefs = createStore<DiffPrefs>(read());
export function setDiffPref<K extends keyof DiffPrefs>(key: K, value: DiffPrefs[K]) {
  diffPrefs.set({ [key]: value } as Partial<DiffPrefs>);
  prefs.setJson(KEY, diffPrefs.get());
}
/** The split layout needs room for two code columns. */
export const SPLIT_MIN = 720;
