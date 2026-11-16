export const PET_FPS = 30;
export const PET_FRAME_MS = 1000 / PET_FPS;

/** A single cancellable timer, never a per-vsync callback that discards frames. */
export class PetFrameScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private last = -Infinity;
  private running = false;
  constructor(private readonly draw: (now: number) => void, private readonly now = () => performance.now()) {}
  setRunning(value: boolean): void {
    this.running = value;
    if (value) this.invalidate();
    else { clearTimeout(this.timer); this.timer = undefined; }
  }
  invalidate(): void {
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.last = this.now();
      this.draw(this.last);
      if (this.running) this.invalidate();
    }, Math.max(0, Math.ceil(PET_FRAME_MS - (this.now() - this.last))));
  }
  get pending(): boolean { return this.timer !== undefined; }
}

export function petAnimationRuns(visible: boolean, surface: 'sprite' | 'glass', tucked: boolean, reduced: boolean, video: boolean): boolean {
  return visible && surface === 'sprite' && !tucked && !reduced && !video;
}
