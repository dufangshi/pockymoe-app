import type { ActivityItem, PetMood } from '../shared/contract';

export type SpriteState = PetMood | 'running-left' | 'running-right';
// Apache-2.0: https://github.com/openai/skills/blob/main/skills/.curated/hatch-pet/references/animation-rows.md
// v1: 8 × 9 cells of 192 × 208. Final frame durations differ from the preceding frames.
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
  if (items.some((item) => item.state === 'failed' && item.unread)) return 'failed';
  if (options.reviewing) return 'review';
  if (options.completion) return options.completion;
  if (items.some((item) => item.state === 'running')) return 'running';
  return 'idle';
}

export function frameAt(state: SpriteState, elapsed: number, reducedMotion = false): number {
  if (reducedMotion) return 0;
  const durations: readonly number[] = ANIMATIONS[state].durations;
  let remainder = Math.max(0, elapsed) % durations.reduce((a, b) => a + b, 0);
  for (let i = 0; i < durations.length; i++) {
    if (remainder < durations[i]) return i;
    remainder -= durations[i];
  }
  return 0;
}
