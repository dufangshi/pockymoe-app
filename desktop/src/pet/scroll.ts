export interface ScrollGeometry { maximum: number; offset: number; thumbSize: number; thumbOffset: number; overflowing: boolean; atStart: boolean; atEnd: boolean }
export function scrollGeometry(viewport: number, content: number, offset: number, track: number): ScrollGeometry {
  const maximum = Math.max(0, content - viewport);
  const bounded = Math.min(maximum, Math.max(0, offset));
  const overflowing = maximum > 1;
  const thumbSize = overflowing ? Math.min(track, Math.max(24, track * viewport / Math.max(1, content))) : track;
  return { maximum, offset: bounded, thumbSize, thumbOffset: maximum ? bounded / maximum * Math.max(0, track - thumbSize) : 0,
    overflowing, atStart: bounded <= 1, atEnd: maximum - bounded <= 1 };
}
