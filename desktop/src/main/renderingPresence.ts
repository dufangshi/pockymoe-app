import type { EventEmitter } from 'node:events';

export const SYSTEM_IDLE_SECONDS = 120;
export interface RenderingPower extends EventEmitter {
  getSystemIdleTime(): number;
  getSystemIdleState(threshold: number): string;
}

/** Hard power events stop rendering; idle only holds pet ambience. Electron
 * has no global input event: idle recovery outside our windows is checked at
 * most once a second, while input in our windows resumes synchronously. */
export class RenderingPresence {
  private reasons = new Set<string>();
  private listeners = new Set<(rendering: boolean) => void>();
  private cleanup: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private rendering = true;
  private idle = false;
  private idleListeners = new Set<(idle: boolean) => void>();
  constructor(private readonly power: RenderingPower) {
    for (const [reason, stop, resume] of [
      ['suspend', 'suspend', 'resume'], ['lock', 'lock-screen', 'unlock-screen'],
      ['session', 'user-did-resign-active', 'user-did-become-active'],
    ]) {
      const pause = () => this.setReason(reason!, true);
      const wake = () => { this.reasons.delete(reason!); this.refresh(); };
      power.on(stop!, pause); power.on(resume!, wake);
      this.cleanup.push(() => { power.removeListener(stop!, pause); power.removeListener(resume!, wake); });
    }
    if (power.getSystemIdleState(SYSTEM_IDLE_SECONDS) === 'locked') this.reasons.add('lock');
    this.refresh();
  }
  get = (): boolean => this.rendering;
  subscribe = (listener: (rendering: boolean) => void): (() => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };
  isIdle = (): boolean => this.idle;
  subscribeIdle = (listener: (idle: boolean) => void): (() => void) => {
    this.idleListeners.add(listener); return () => { this.idleListeners.delete(listener); };
  };
  private setIdle(next: boolean): void {
    if (next === this.idle) return;
    this.idle = next; this.idleListeners.forEach(listener => listener(next));
  }
  private publish(): void {
    const next = !this.reasons.size;
    if (next === this.rendering) return;
    this.rendering = next;
    this.listeners.forEach(listener => listener(next));
  }
  private setReason(reason: string, paused: boolean): void {
    if (this.disposed) return;
    if (paused) this.reasons.add(reason); else this.reasons.delete(reason);
    this.refresh();
  }
  input = (): void => {
    if (this.disposed || this.reasons.size) return;
    // Active input need not replace the same two-minute deadline per mousemove.
    if (!this.idle && this.timer !== undefined) return;
    // Native window activation can synthesize input callbacks. The OS idle
    // clock confirms actual input before an idle pet resumes.
    if (this.idle && this.power.getSystemIdleTime() >= SYSTEM_IDLE_SECONDS) return;
    this.setIdle(false);
    clearTimeout(this.timer);
    this.schedule(SYSTEM_IDLE_SECONDS * 1000);
  };
  private schedule(ms: number): void {
    this.timer = setTimeout(() => this.refresh(), ms); this.timer.unref();
  }
  refresh(): void {
    clearTimeout(this.timer); this.timer = undefined;
    if (this.disposed) return;
    // Hard power states have real wake events. Idle only pauses pet ambience;
    // a person watching a streaming transcript still needs RAF and follow-scroll.
    if (this.reasons.size) { this.publish(); return; }
    const idle = this.power.getSystemIdleTime();
    this.setIdle(idle >= SYSTEM_IDLE_SECONDS);
    this.publish();
    this.schedule(Math.max(1000, (SYSTEM_IDLE_SECONDS - idle) * 1000));
  }
  dispose(): void {
    this.disposed = true; clearTimeout(this.timer);
    this.cleanup.forEach(stop => stop()); this.cleanup = []; this.listeners.clear(); this.idleListeners.clear();
  }
}
