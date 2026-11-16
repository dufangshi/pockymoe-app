import type { PetClip } from './packs';
import { PetFrameScheduler } from './frameScheduler';
type Slot = { clip: PetClip; video: HTMLVideoElement; ready: Promise<void>; disposed: boolean; callback: number | null; frame: number; drawn: number };
/** Two native decoders. New video frames wake a capped presentation timer; no animation tick. */
export class VideoClipPlayer {
  private active: Slot | null = null;
  private next: Slot | null = null;
  private token = 0;
  private completed = false;
  private fps = 24;
  private forceRedraw = false;
  private leaveTimer: ReturnType<typeof setTimeout> | undefined;
  private still = false;
  private suspended = false;
  private held = false;
  private wanted: PetClip | null = null;
  private switching: Promise<void> | null = null;
  private presentation = new PetFrameScheduler(() => {
    const slot = this.active;
    if (slot && !this.suspended && slot.video.readyState >= 2 && (slot.frame !== slot.drawn || this.forceRedraw)) {
      slot.drawn = slot.frame; this.forceRedraw = false; this.draw(slot.video);
    }
  });
  constructor(private url: (path: string) => string, private draw: (video: HTMLVideoElement) => void, private finish: () => void, private failed: () => void) {}
  private make(clip: PetClip): Slot {
    const video = document.createElement('video'); video.crossOrigin = 'anonymous'; video.muted = true; video.preload = 'auto'; video.playsInline = true; video.hidden = true; video.className = 'pet-video'; document.body.append(video);
    const slot: Slot = { clip, video, ready: Promise.resolve(), disposed: false, callback: null, frame: 0, drawn: -1 };
    slot.ready = new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error('pet video decode failed'));
      video.src = this.url(clip.path); video.load();
    });
    video.onended = () => this.complete(slot);
    void slot.ready.catch(() => undefined);
    return slot;
  }
  private release(slot: Slot | null): void {
    if (!slot || slot.disposed) return;
    slot.disposed = true;
    if (slot.callback !== null) slot.video.cancelVideoFrameCallback(slot.callback);
    slot.callback = null;
    slot.video.pause(); slot.video.onended = null; slot.video.onseeked = null; slot.video.removeAttribute('src'); slot.video.load(); slot.video.onloadeddata = null; slot.video.onerror = null; slot.video.remove();
  }
  preload(clip: PetClip | null): void {
    if (!clip) { this.release(this.next); this.next = null; return; }
    if (clip.path === this.next?.clip.path) return;
    this.release(this.next); this.next = this.make(clip);
  }
  play(clip: PetClip, fps: number, still: boolean): Promise<void> {
    this.fps = fps;
    const changed = this.still !== still;
    this.still = still;
    if (this.wanted === clip) { if (changed) this.syncPlayback(); return this.switching ?? Promise.resolve(); }
    this.wanted = clip; this.switching = this.activate(clip); return this.switching;
  }
  private async activate(clip: PetClip): Promise<void> {
    const token = ++this.token;
    const slot = this.next?.clip.path === clip.path ? this.next : null;
    if (!slot) { this.release(this.next); this.next = this.make(clip); }
    const incoming = slot ?? this.next!;
    try {
      await incoming.ready;
      if (token !== this.token || incoming.disposed) return;
      clearTimeout(this.leaveTimer);
      this.release(this.active); this.active = incoming; this.next = null; this.completed = false;
      incoming.video.playbackRate = 1;
      this.syncPlayback(); this.invalidate();
    } catch { if (token === this.token) { this.dispose(); this.failed(); } }
  }
  private videoFrames(slot: Slot): void {
    if (slot.callback !== null || this.still || this.suspended || this.held || this.completed) return;
    slot.callback = slot.video.requestVideoFrameCallback((_now, metadata) => {
      slot.callback = null;
      if (this.active !== slot || slot.disposed || this.suspended) return;
      slot.frame = Math.round(metadata.mediaTime * this.fps);
      this.invalidate(); this.videoFrames(slot);
    });
  }
  private syncPlayback(): void {
    const a = this.active; if (!a) return;
    if (this.still || this.suspended || this.held) {
      a.video.pause();
      if (a.callback !== null) a.video.cancelVideoFrameCallback(a.callback);
      a.callback = null;
      if (this.still && a.video.currentTime !== 0) { a.video.currentTime = 0; a.video.onseeked = () => { a.frame = 0; this.invalidate(true); }; }
    } else if (!this.completed) {
      this.videoFrames(a);
      void a.video.play().catch(() => this.failed());
    }
  }
  setSuspended(value: boolean): void {
    if (value === this.suspended) return;
    this.suspended = value;
    if (value) this.presentation.setRunning(false);
    this.syncPlayback();
    if (!value) this.invalidate();
  }
  /** Stop decode at the presented frame; a newly loaded pose may present once. */
  setHeld(value: boolean): void {
    if (value === this.held) return;
    this.held = value;
    if (value) this.presentation.setRunning(false);
    this.syncPlayback();
    if (!value) this.invalidate();
  }
  private complete(slot: Slot): void {
    if (this.active !== slot || this.completed || this.still || this.suspended || this.held) return;
    clearTimeout(this.leaveTimer);
    this.completed = true; this.wanted = null; this.finish();
  }
  /** Preserve the image and hurry to the shared rest endpoint before handing off. */
  leave(): boolean {
    if (!this.active || this.completed) return false;
    this.active.video.playbackRate = 3;
    clearTimeout(this.leaveTimer);
    const slot = this.active;
    // Preserve the existing <=600ms interruption handoff without a periodic tick.
    const remaining = Math.max(0, slot.clip.frames / this.fps - slot.video.currentTime) / 3 * 1000;
    this.leaveTimer = setTimeout(() => this.complete(slot), Math.min(600, remaining));
    return true;
  }
  invalidate(force = false): void { this.forceRedraw ||= force; if (this.active && !this.suspended) this.presentation.invalidate(); }
  get path(): string | null { return this.active?.clip.path ?? null; }
  get role(): PetClip['role'] { return this.active?.clip.role; }
  get playing(): boolean { return !!this.active; }
  dispose(): void { this.token++; clearTimeout(this.leaveTimer); this.presentation.setRunning(false); this.release(this.active); this.release(this.next); this.active = this.next = null; this.wanted = null; this.switching = null; }
}
