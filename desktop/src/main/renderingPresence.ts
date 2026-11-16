import type { EventEmitter } from 'node:events';

export const RENDER_IDLE_SECONDS = 120;
export interface RenderingPower extends EventEmitter {
  getSystemIdleTime(): number;
  getSystemIdleState(threshold: number): string;
}

/** Power events stop rendering, never the activity/notification owner. Electron
 * has no global input event: idle recovery outside our windows is checked at
 * most once a second, while input in our windows resumes synchronously. */
export class RenderingPresence {
  private reasons = new Set<string>();
  private listeners = new Set<(rendering: boolean) => void>();
  private cleanup: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private rendering = true;
  constructor(private readonly power: RenderingPower) {
    for (const [reason, stop, resume] of [
      ['suspend', 'suspend', 'resume'], ['lock', 'lock-screen', 'unlock-screen'],
      ['session', 'user-did-resign-active', 'user-did-become-active'],
    ]) {
      const pause = () => this.setReason(reason!, true);
      const wake = () => { this.reasons.delete(reason!); this.probe(); };
      power.on(stop!, pause); power.on(resume!, wake);
      this.cleanup.push(() => { power.removeListener(stop!, pause); power.removeListener(resume!, wake); });
    }
    if (power.getSystemIdleState(RENDER_IDLE_SECONDS) === 'locked') this.reasons.add('lock');
    this.probe();
  }
  get = (): boolean => this.rendering;
  subscribe = (listener: (rendering: boolean) => void): (() => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };
  private publish(): void {
    const next = !this.reasons.size;
    if (next === this.rendering) return;
    this.rendering = next;
    this.listeners.forEach(listener => listener(next));
  }
  private setReason(reason: string, paused: boolean): void {
    if (this.disposed) return;
    if (paused) this.reasons.add(reason); else this.reasons.delete(reason);
    this.probe();
  }
  displayAwake = (awake: boolean): void => this.setReason('display', !awake);
  input = (): void => {
    if (this.disposed) return;
    this.reasons.delete('idle');
    this.publish();
    clearTimeout(this.timer);
    if (!this.reasons.size) this.schedule(RENDER_IDLE_SECONDS * 1000);
  };
  private schedule(ms: number): void {
    this.timer = setTimeout(() => this.probe(), ms); this.timer.unref();
  }
  private probe(): void {
    clearTimeout(this.timer); this.timer = undefined;
    if (this.disposed) return;
    // Lock, display sleep and suspend have real wake events; no polling there.
    if ([...this.reasons].some(reason => reason !== 'idle')) { this.publish(); return; }
    const idle = this.power.getSystemIdleTime();
    if (idle >= RENDER_IDLE_SECONDS) this.reasons.add('idle'); else this.reasons.delete('idle');
    this.publish();
    this.schedule(Math.max(1000, (RENDER_IDLE_SECONDS - idle) * 1000));
  }
  dispose(): void {
    this.disposed = true; clearTimeout(this.timer);
    this.cleanup.forEach(stop => stop()); this.cleanup = []; this.listeners.clear();
  }
}
