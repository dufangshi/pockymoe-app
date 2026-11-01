import type { ActivityItem, PetMood } from '../shared/contract';

export type SpriteState = PetMood | 'running-left' | 'running-right';
// Apache-2.0: https://github.com/openai/skills/blob/main/skills/.curated/hatch-pet/references/animation-rows.md
// v1: 8 × 9 cells of 192 × 208. Final frame durations differ from the preceding frames.
// v2 preserves these nine animation rows, adds pointer-look slots at rows 9–10,
// and reserves idle column 6 as the neutral look (never part of the idle loop).
// Public hatch-pet currently describes v1; the v2 layout is also documented at
// https://github.com/ouyang070125-cmyk/codex-dragon-pet/tree/v1.0.0 (README + scripts/build_pet.py).
export const ANIMATIONS = {
  idle: { row: 0, durations: [280, 110, 110, 140, 140, 320] },
  'running-right': { row: 1, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  'running-left': { row: 2, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  waving: { row: 3, durations: [140, 140, 140, 280] },
  jumping: { row: 4, durations: [140, 140, 140, 140, 280] },
  failed: { row: 5, durations: [140, 140, 140, 140, 140, 140, 140, 240] },
  waiting: { row: 6, durations: [150, 150, 150, 150, 150, 260] },
  running: { row: 7, durations: [120, 120, 120, 120, 120, 220] },
  review: { row: 8, durations: [150, 150, 150, 150, 150, 280] },
  sleeping: { row: 0, durations: [6000] },
} as const;

export function moodFor(items: ActivityItem[], options: {
  snoozed?: boolean; completion?: 'waving' | 'jumping' | null; reviewing?: boolean;
} = {}): PetMood {
  // Snooze is an explicit global override: do not animate an attention pose during quiet hours.
  if (options.snoozed) return 'sleeping';
  if (items.some((item) => item.state === 'needsInput')) return 'waiting';
  if (items.some((item) => item.state === 'running')) return 'running';
  return 'idle';
}

export function frameAt(state: SpriteState, elapsed: number, reducedMotion = false, frameScale = 1, once = false): number {
  if (reducedMotion) return 0;
  const durations: readonly number[] = ANIMATIONS[state].durations;
  const total = durations.reduce((a, b) => a + b, 0);
  let remainder = once ? Math.min(total - 1, Math.max(0, elapsed / frameScale)) : Math.max(0, elapsed / frameScale) % total;
  for (let i = 0; i < durations.length; i++) {
    if (remainder < durations[i]) return i;
    remainder -= durations[i];
  }
  return 0;
}
