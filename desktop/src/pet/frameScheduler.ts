export const PET_FPS = 30;
export const PET_FRAME_MS = 1000 / PET_FPS;

/** A single cancellable timer, never a per-vsync callback that discards frames. */
export class PetFrameScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private last = -Infinity;
  private running = false;
  constructor(private readonly draw: (now: number) => number | void, private readonly now = () => performance.now()) {}
  setRunning(value: boolean): void {
    this.running = value;
    if (value) this.invalidate();
    else { clearTimeout(this.timer); this.timer = undefined; }
  }
  invalidate(): void {
    clearTimeout(this.timer); this.timer = undefined;
    this.schedule(0);
  }
  private schedule(delay: number): void {
    if (this.timer !== undefined || !Number.isFinite(delay)) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.last = this.now();
      const delay = this.draw(this.last);
      if (this.running) this.schedule(delay ?? PET_FRAME_MS);
    }, Math.max(0, Math.ceil(Math.max(PET_FRAME_MS, delay) - (this.now() - this.last))));
  }
  get pending(): boolean { return this.timer !== undefined; }
}

export function petAnimationRuns(visible: boolean, surface: 'sprite' | 'glass', tucked: boolean, reduced: boolean, video: boolean, ambientPaused = false, reacting = false): boolean {
  return visible && surface === 'sprite' && !tucked && !reduced && !video && (!ambientPaused || reacting);
}
