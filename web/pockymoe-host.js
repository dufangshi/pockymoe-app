(() => {
  'use strict';
  if (window !== window.top || location.origin !== __POCKYMOE_ORIGIN__) return;
  const listeners = new Set();
  const pending = new Map();
  let sequence = 0;
  let signedOut = false;
  const post = message => {
    if (window.webkit?.messageHandlers?.remoteCodex) window.webkit.messageHandlers.remoteCodex.postMessage(message);
    else window.RemoteCodexHost.postMessage(JSON.stringify(message));
  };
  const send = (method, args = []) => post({ method, args });
  const request = (method, ...args) => new Promise((resolve, reject) => {
    const id = String(++sequence);
    pending.set(id, { resolve, reject });
    post({ method, args, id });
  });
  Object.defineProperty(window, '__pockymoeReply', { value: (id, value, error) => {
    const callback = pending.get(id);
    if (!callback) return;
    pending.delete(id);
    error ? callback.reject(new Error(error)) : callback.resolve(value);
  }});
  Object.defineProperty(window, '__pockymoeCommand', { value: command => {
    for (const listener of listeners) listener(command);
  }});
  Object.defineProperty(window, 'pockymoeHost', { value: Object.freeze({
    capabilities: () => request('capabilities'),
    activity: { sync: snapshot => { if (!signedOut) send('activity.sync', [snapshot]); } },
    onCommand: listener => { listeners.add(listener); send('ready'); return () => listeners.delete(listener); },
    commandResult: (id, result) => send('commandResult', [id, result]),
    window: {
      openThread: path => send('window.openThread', [path]),
      setTitle: title => send('window.setTitle', [title]),
      openPreferences: () => {},
    },
    shell: { openExternal: url => send('shell.openExternal', [url]) },
    files: { saveAs: (name, data) => request('files.saveAs', name, Array.from(new Uint8Array(data))) },
    settings: { get: () => request('settings.get'), set: patch => request('settings.set', patch) },
    badge: { set: (count, style) => send('badge.set', [count, style]) },
    appearance: { sync: appearance => send('appearance.sync', [appearance]) },
    pet: { setVisible: () => {}, isVisible: async () => false },
    push: { register: () => request('push.register') },
    haptics: { play: kind => send('haptics.play', [kind]) },
    auth: { openExternal: url => request('auth.openExternal', url) },
  }) });
  window.addEventListener('pockymoe-account-logout', () => { signedOut = true; send('session.clear'); });
  window.addEventListener('pockymoe-account-changed', () => { signedOut = false; });
  // The SPA root must contain painted UI; DOMContentLoaded alone is an empty bundle host.
  const firstFrame = () => {
    const painted = () => {
      const root = document.getElementById('root');
      if (root && !root.firstElementChild) return false;
      requestAnimationFrame(() => requestAnimationFrame(() => send('firstFrame')));
      return true;
    };
    if (painted()) return;
    const observer = new MutationObserver(() => { if (painted()) observer.disconnect(); });
    observer.observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', firstFrame, { once: true });
  else firstFrame();
})();
