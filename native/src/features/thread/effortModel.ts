// Reasoning levels in their order and colours (the shared UI's composerUtils), pure.
import type { ModelOptionDto } from '@pockymoe/shared';

export const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const EFFORT_COLORS = ['#3d8bff', '#2f7cf6', '#0fb5c8', '#16b364', '#f5b000', '#ff7a1a', '#f43f7a', '#9b5cff'];

/** An unknown level takes its place on the same scale by position. */
export function effortColor(effort: string | null | undefined, index = 0, count = 1) {
  const known = EFFORT_ORDER.indexOf(effort ?? '');
  return EFFORT_COLORS[known >= 0 ? known : Math.round((index / Math.max(1, count - 1)) * (EFFORT_COLORS.length - 1))]!;
}

/** Known levels in their semantic order; opaque ACP values keep the catalog's order. */
export function orderedEfforts(efforts: ModelOptionDto['supportedReasoningEfforts']) {
  const options = [...efforts];
  if (options.every(e => EFFORT_ORDER.includes(e.reasoningEffort))) options.sort((a, b) => EFFORT_ORDER.indexOf(a.reasoningEffort) - EFFORT_ORDER.indexOf(b.reasoningEffort));
  return options;
}

/** Plum Pocket's level colours (the Web's composer-model-picker.css overrides). */
const PLUM_EFFORT: Record<string, string> = { none: '#6f86e0', minimal: '#6f86e0', low: '#8a5fe0', medium: '#f0a414', high: '#f2702a', xhigh: '#e83e65', max: '#c43aa8', ultra: '#c43aa8' };
export function plumEffortColor(effort: string | null | undefined, index = 0, count = 1) {
  return PLUM_EFFORT[effort ?? ''] ?? effortColor(effort, index, count);
}

/** The slider's geometry (the Web's EffortSlider): the track is inset by half a thumb on each
 *  side, so level i of n sits at inset + i/(n-1) of the rest. */
export function effortStopX(index: number, count: number, width: number, thumb: number) {
  const inset = thumb / 2;
  return count < 2 ? inset : inset + (index / (count - 1)) * Math.max(0, width - thumb);
}

/** The level nearest a touch at x. */
export function effortIndexAt(x: number, count: number, width: number, thumb: number) {
  if (count < 2) return 0;
  const span = Math.max(1, width - thumb);
  return Math.max(0, Math.min(count - 1, Math.round(((x - thumb / 2) / span) * (count - 1))));
}
