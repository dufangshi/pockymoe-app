/** Runs at preload time in the page world, before libraries can capture RAF.
 * Only rendering is suspended: timers, sockets, activity and host IPC stay live. */
export function installRenderingGate(): void {
  const page = window as Window & { __pockymoeSetRendering?: (visible: boolean) => void };
  const request = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
  const frames = new Map<number, { callback: FrameRequestCallback; native?: number }>();
  let visible = true, sequence = 0;
  const schedule = (id: number): void => {
    const entry = frames.get(id);
    if (!entry || !visible) return;
    entry.native = request(now => { frames.delete(id); entry.callback(now); });
  };
  window.requestAnimationFrame = callback => {
    const id = ++sequence;
    frames.set(id, { callback }); schedule(id); return id;
  };
  window.cancelAnimationFrame = id => {
    const entry = frames.get(id);
    if (entry?.native !== undefined) cancel(entry.native);
    frames.delete(id);
  };
  const paused = new Set<Animation>();
  let style: HTMLStyleElement | undefined;
  page.__pockymoeSetRendering = next => {
    if (next === visible) return;
    visible = next;
    if (!next) {
      style = document.createElement('style');
      style.textContent = '*, *::before, *::after { animation-play-state: paused !important; transition-property: none !important; }';
      (document.head ?? document.documentElement).append(style);
      for (const entry of frames.values()) { if (entry.native !== undefined) cancel(entry.native); entry.native = undefined; }
      // CSS is handled by the stylesheet; also suspend script-created Web Animations.
      for (const animation of document.getAnimations()) {
        if (animation.playState === 'running') { paused.add(animation); animation.pause(); }
      }
    } else {
      style?.remove(); style = undefined;
      for (const animation of paused) if (animation.playState === 'paused') animation.play();
      paused.clear();
      for (const id of frames.keys()) schedule(id);
    }
  };
}

export function setPageRendering(visible: boolean): void {
  (window as Window & { __pockymoeSetRendering?: (visible: boolean) => void }).__pockymoeSetRendering?.(visible);
}
