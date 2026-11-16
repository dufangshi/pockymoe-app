export interface PointerSample { x: number; y: number; far: boolean; settling: boolean }
export const POINTER_ACTIVE_MS = 100;
export const POINTER_QUIET_MS = 500;

/** Far, still pointers need two probes a second. Native pointer entry/exit wakes
 * the probe immediately; movement, nearby pointers and UI deadlines stay at 10Hz. */
export class PetPointerPoll {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private last: { x: number; y: number } | null = null;
  private movedAt = 0;
  constructor(private readonly read: () => PointerSample | null, private readonly now = Date.now) {}
  setRunning(value: boolean): void {
    if (value === this.running) return;
    this.running = value;
    clearTimeout(this.timer); this.timer = undefined;
    if (value) { this.last = null; this.schedule(POINTER_ACTIVE_MS); }
  }
  wake(): void {
    if (!this.running) return;
    clearTimeout(this.timer); this.timer = undefined;
    this.movedAt = this.now(); this.tick();
  }
  private schedule(delay: number): void {
    this.timer = setTimeout(() => this.tick(), delay); this.timer.unref();
  }
  private tick(): void {
    this.timer = undefined;
    if (!this.running) return;
    const sample = this.read();
    if (!sample) { this.setRunning(false); return; }
    const now = this.now();
    if (!this.last || sample.x !== this.last.x || sample.y !== this.last.y) this.movedAt = now;
    this.last = { x: sample.x, y: sample.y };
    const quiet = sample.far && !sample.settling && now - this.movedAt >= 1000;
    if (this.running) this.schedule(quiet ? POINTER_QUIET_MS : POINTER_ACTIVE_MS);
  }
}
