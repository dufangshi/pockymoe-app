import type { PetClip } from './packs';
type Slot = { clip: PetClip; video: HTMLVideoElement; ready: Promise<void>; disposed: boolean; callback: number | null };
/** Two native decoders, no frame atlas, Blob copies, or decoded-frame cache. */
export class VideoClipPlayer {
  private active: Slot | null = null;
  private next: Slot | null = null;
  private token = 0;
  private start = 0;
  private frame = -1;
  private completed = false;
  private changed = true;
  private wanted: PetClip | null = null;
  private switching: Promise<void> | null = null;
  constructor(private url: (path: string) => string, private draw: (video: HTMLVideoElement) => void, private finish: () => void, private failed: () => void) {}
  private make(clip: PetClip): Slot {
    const video = document.createElement('video'); video.crossOrigin = 'anonymous'; video.muted = true; video.preload = 'auto'; video.playsInline = true; video.hidden = true; video.className = 'pet-video'; document.body.append(video);
    const slot: Slot = { clip, video, ready: Promise.resolve(), disposed: false, callback: null };
    slot.ready = new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error('pet video decode failed'));
      video.src = this.url(clip.path); video.load();
    });
    // A cancelled/preloaded decoder may fail without any caller awaiting it.
    void slot.ready.catch(() => undefined);
    return slot;
  }
  private release(slot: Slot | null): void {
    if (!slot || slot.disposed) return;
    slot.disposed = true;
    if (slot.callback !== null) { slot.video.cancelVideoFrameCallback(slot.callback); slot.callback = null; }
    slot.video.pause(); slot.video.removeAttribute('src'); slot.video.load(); slot.video.onloadeddata = null; slot.video.onerror = null; slot.video.remove();
  }
  preload(clip: PetClip | null): void {
    if (!clip) { this.release(this.next); this.next = null; return; }
    if (clip.path === this.next?.clip.path) return;
    this.release(this.next); this.next = this.make(clip);
  }
  play(clip: PetClip, fps: number, still: boolean): Promise<void> {
    if (this.wanted === clip) return this.switching ?? Promise.resolve();
    this.wanted = clip; this.switching = this.activate(clip, fps, still); return this.switching;
  }
  private async activate(clip: PetClip, fps: number, still: boolean): Promise<void> {
    const token = ++this.token;
    const slot = this.next?.clip.path === clip.path ? this.next : null;
    // Release the obsolete preload before opening a replacement: never three decoders.
    if (!slot) { this.release(this.next); this.next = this.make(clip); }
    const incoming = slot ?? this.next!;
    try {
      await incoming.ready;
      if (token !== this.token || incoming.disposed) return;
      this.release(this.active); this.active = incoming; this.next = null; this.start = performance.now(); this.frame = 0; this.completed = false; this.changed = true;
      this.draw(incoming.video); this.videoFrames(incoming);
      incoming.video.playbackRate = 1;
      if (!still) await incoming.video.play();
      incoming.video.dataset.fps = String(fps);
    } catch { if (token === this.token) { this.dispose(); this.failed(); } }
  }
  private videoFrames(slot: Slot): void {
    slot.callback = slot.video.requestVideoFrameCallback(() => { slot.callback = null; if (this.active !== slot || slot.disposed) return; this.changed = true; this.videoFrames(slot); });
  }
  tick(now: number, fps: number, still: boolean): void {
    const a = this.active; if (!a) return;
    if (!still && !this.completed && now - this.start >= a.clip.frames / fps * 1000 - 1) {
      this.completed = true; this.wanted = null; this.finish(); return;
    }
    if (still) {
      a.video.pause();
      if (a.video.currentTime !== 0) { a.video.currentTime = 0; this.changed = true; }
    } else if (a.video.paused && !a.video.ended && !this.completed) {
      this.start = now - a.video.currentTime * 1000;
      void a.video.play().catch(() => this.failed());
    }
    if (a.video.readyState < 2) return;
    const frame = Math.floor(a.video.currentTime * fps + .001);
    if (this.changed || frame !== this.frame) { this.changed = false; this.frame = frame; this.draw(a.video); }
  }
  /** State changes preserve the current image, hurry toward the shared rest endpoint,
   * then hand off. An intro/outro always reaches its last pose. */
  leave(): boolean {
    // A finished one-shot is holding its last frame: there is nothing left to hurry, so the
    // caller must start the next clip itself.
    if (!this.active || this.completed) return false;
    const v = this.active.video;
    v.playbackRate = 3;
    this.start = performance.now() - (this.active.clip.frames / Number(v.dataset.fps || 24) * 1000 - Math.min(600, Math.max(0, v.duration - v.currentTime) / 3 * 1000));
    return true;
  }
  invalidate(): void { this.changed = true; }
  get path(): string | null { return this.active?.clip.path ?? null; }
  get role(): PetClip['role'] { return this.active?.clip.role; }
  get playing(): boolean { return !!this.active; }
  dispose(): void { this.token++; this.release(this.active); this.release(this.next); this.active = this.next = null; this.wanted = null; this.switching = null; }
}
