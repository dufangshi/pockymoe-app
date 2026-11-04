(() => {
  // The Web auth page normally sits below Safari chrome. This full-screen host
  // opts into viewport-fit=cover, so its auth surface must consume the CSS safe
  // area itself. The full-screen settings sheet needs the same treatment;
  // thread navigation and the map already consume their own insets. Keep all product controls Web-owned.
  const style = document.createElement('style');
  style.textContent = `
    :root[data-ios-keyboard] .auth-shell { height: var(--ios-visual-height); min-height: var(--ios-visual-height); padding-bottom: 0; }
    :root[data-ios-keyboard] .auth-shell > div { align-items: center; padding-bottom: 16px; }
    @media (max-width: 639px) {
      .thread-graph-settings-dialog.thread-graph-dialog {
        box-sizing: border-box;
        padding-top: env(safe-area-inset-top) !important;
        padding-right: env(safe-area-inset-right) !important;
        padding-bottom: env(safe-area-inset-bottom) !important;
        padding-left: env(safe-area-inset-left) !important;
      }
      .thread-graph-settings-dialog [data-slot="dialog-close"] {
        margin: 0 !important;
        top: calc(env(safe-area-inset-top) + 8px) !important;
        right: calc(env(safe-area-inset-right) + 8px) !important;
      }
    }
    .auth-shell { box-sizing: border-box; height: 100dvh; overflow-y: auto; padding-top: env(safe-area-inset-top); padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right); padding-bottom: env(safe-area-inset-bottom); }`;
  document.head.append(style);
  const update = () => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    document.documentElement.style.setProperty('--ios-visual-height', `${viewport.height}px`);
    document.documentElement.toggleAttribute('data-ios-keyboard', window.innerHeight - viewport.height > 100);
  };
  window.visualViewport?.addEventListener('resize', update);
  window.visualViewport?.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  update();
})();
