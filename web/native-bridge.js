// Shared by WKWebView and Android WebView. Product UI stays owned by the relay.
(() => {
  if (window.__remoteCodexNativeInstalled) return;
  window.__remoteCodexNativeInstalled = true;
  const send = (type, data = {}) => {
    const message = JSON.stringify({ type, ...data });
    if (window.RemoteCodexHost) window.RemoteCodexHost.postMessage(message);
    else window.webkit?.messageHandlers?.remoteCodex?.postMessage(message);
  };
  const viewport = () => {
    if (!document.documentElement || !(window.innerHeight > 0)) return;
    // Some WebViews retain a zero small-viewport height when the first page
    // loads before its native view is measured. Use the actual native viewport.
    document.documentElement.style.setProperty('--remote-codex-native-height', `${window.innerHeight}px`);
    if (document.head && !document.getElementById('remote-codex-native-viewport')) {
      const style = document.createElement('style');
      style.id = 'remote-codex-native-viewport';
      style.textContent = 'html .thread-ui-shell.thread-ui-viewport-constrained { height: var(--remote-codex-native-height); max-height: var(--remote-codex-native-height); }';
      document.head.append(style);
    }
  };
  // Mobile scrolling stays available, but native WebViews should not paint
  // platform scrollbars over the compact product chrome. Horizontal tab rows
  // must also stay single-axis so a vertical scrollbar cannot appear there.
  const hideScrollbars = () => {
    if (!document.head || document.getElementById('remote-codex-mobile-scrollbars')) return;
    const style = document.createElement('style');
    style.id = 'remote-codex-mobile-scrollbars';
    style.textContent = `
      *, *::before, *::after { scrollbar-width: none !important; }
      *::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
      .overflow-x-auto, .overflow-x-scroll { overflow-y: hidden !important; }
    `;
    document.head.append(style);
  };
  const report = () => { viewport(); send('state', {
    path: location.pathname + location.search + location.hash,
    theme: localStorage.getItem('remote-codex-theme-mode') || 'system',
  }); };
  hideScrollbars();
  addEventListener('DOMContentLoaded', hideScrollbars);
  for (const name of ['pushState', 'replaceState']) {
    const original = history[name];
    history[name] = function (...args) {
      const result = original.apply(this, args);
      report();
      return result;
    };
  }
  addEventListener('popstate', report);
  addEventListener('pageshow', report);
  addEventListener('DOMContentLoaded', report);
  addEventListener('resize', viewport);
  const observeTheme = () => {
    if (typeof MutationObserver !== 'undefined' && document.documentElement) {
      new MutationObserver(report).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme-mode', 'data-theme-effective'] });
    }
  };
  if (document.documentElement) observeTheme();
  else addEventListener('DOMContentLoaded', observeTheme);
  // Fetch remains untouched: credentials, E2EE and real Service Workers belong
  // to the website. Cookie changes are observed natively. Check only visible
  // pages once a minute for localStorage theme changes missed by DOM observers.
  addEventListener('hashchange', report);
  addEventListener('storage', report);
  addEventListener('visibilitychange', () => { if (!document.hidden) report(); });
  setInterval(() => { if (!document.hidden) report(); }, 60000);
  const pending = new Map();
  // Keep the original Blob until its URL is revoked. Reading our own object
  // directly avoids a fetch(blob:) that older WebViews reject under connect-src self.
  const blobs = new Map();
  if (window.URL?.createObjectURL) {
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); blobs.set(url, blob); return url; };
    URL.revokeObjectURL = url => { blobs.delete(String(url)); return revoke(url); };
  }
  let nextId = 0;
  window.remoteCodexNative = {
    platform: window.webkit?.messageHandlers?.remoteCodex ? 'ios' : 'android',
    changeRelay: () => send('changeRelay'),
    notificationSettings: () => send('notificationSettings'),
    // Opt in only while the page owns account-wide notification delivery.
    setEventDeliveryActive: active => send('eventDelivery', { active: active === true }),
    resolve: (id, error) => {
      const task = pending.get(id);
      if (!task) return;
      pending.delete(id);
      error ? task.reject(new Error(error)) : task.resolve();
    },
  };
  const share = data => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    send('share', { id, title: data.title || '', text: data.text || '', url: data.url || '' });
  });
  if (!navigator.share) {
    navigator.share = share;
    navigator.canShare = data => !data.files;
  }
  const downloadable = link => link && /^(blob:|data:)/.test(link.href);
  const download = async link => {
    try {
      let blob = blobs.get(link.href);
      if (!blob && link.href.startsWith('data:')) {
        const comma = link.href.indexOf(',');
        const format = link.href.slice(5, comma);
        const encoded = link.href.slice(comma + 1);
        blob = new Blob([format.endsWith(';base64') ? Uint8Array.from(atob(encoded), c => c.charCodeAt(0)) : decodeURIComponent(encoded)], { type: format.split(';')[0] });
      }
      blob ||= await (await fetch(link.href)).blob();
      if (blob.size > 32 * 1024 * 1024) throw new Error('Download exceeds the 32 MB mobile export limit.');
      const reader = new FileReader();
      reader.onload = () => send('download', {
        name: link.download || 'download', mime: blob.type || 'application/octet-stream', data: reader.result,
      });
      reader.readAsDataURL(blob);
    } catch (error) { send('error', { message: error.message }); }
  };
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[download]');
    if (!downloadable(link)) return;
    event.preventDefault();
    return download(link);
  }, true);
  // Recovery-code and other small exports may click a detached anchor, which
  // never bubbles to document. Preserve ordinary anchor clicks unchanged.
  if (window.HTMLAnchorElement) {
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (!this.isConnected && this.hasAttribute('download') && downloadable(this)) { void download(this); return; }
      return click.call(this);
    };
  }
  report();
})();
