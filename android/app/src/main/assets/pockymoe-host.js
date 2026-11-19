(() => {
  if (window !== window.top || window.pockymoeHost) return;
  // The shell owns its viewport: publish safe-area insets and let only the
  // visual viewport respond to the IME, including pages built for a browser.
  const viewport = () => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return false;
    const value = meta.content.split(',').map(s => s.trim()).filter(s => !/^viewport-fit=|^interactive-widget=/i.test(s));
    meta.content = [...value, 'viewport-fit=cover', 'interactive-widget=resizes-visual'].join(', ');
    return true;
  };
  if (!viewport()) {
    const observer = new MutationObserver(() => { if (viewport()) observer.disconnect(); });
    observer.observe(document, {childList: true, subtree: true});
  }
  const pending = new Map(), listeners = new Set();
  let serial = 0, saving = false;
  const maxSaveBytes = 64 * 1024 * 1024, chunkBytes = 48 * 1024;
  const call = (method, ...args) => new Promise((resolve, reject) => {
    const id = String(++serial);
    pending.set(id, {resolve, reject});
    PockymoeAndroid.postMessage(JSON.stringify({id, method, args}));
  });
  PockymoeAndroid.onmessage = event => {
    const value = JSON.parse(event.data);
    if (value.command) { listeners.forEach(fn => fn(value.command)); return; }
    const p = pending.get(value.id);
    if (p) { pending.delete(value.id); value.error ? p.reject(new Error(value.error)) : p.resolve(value.data); }
  };
  window.pockymoeHost = Object.freeze({
    capabilities: () => call('capabilities'),
    activity: {sync: snapshot => { void call('activity.sync', snapshot); }},
    onCommand: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    commandResult: (id, result) => { void call('commandResult', id, result); },
    window: {openThread: path => { void call('window.openThread', path); }, setTitle: title => { void call('window.setTitle', title); }, openPreferences: () => {}},
    shell: {openExternal: url => { void call('shell.openExternal', url); }},
    auth: {openExternal: url => call('auth.openExternal', url)},
    files: {saveAs: async (name, data) => {
      const bytes = new Uint8Array(data);
      if (bytes.byteLength > maxSaveBytes) throw new Error('File exceeds 64 MiB');
      if (saving) throw new Error('A save is already in progress');
      saving = true;
      let started = false;
      try {
        await call('files.saveStart', name, bytes.byteLength);
        started = true;
        // Await every acknowledgement: only one bounded chunk crosses the bridge.
        for (let i = 0; i < bytes.length; i += chunkBytes) {
          const chunk = bytes.subarray(i, i + chunkBytes);
          let binary = '';
          for (let j = 0; j < chunk.length; j += 8192)
            binary += String.fromCharCode(...chunk.subarray(j, j + 8192));
          await call('files.saveChunk', btoa(binary));
        }
        return await call('files.saveFinish');
      } catch (error) {
        if (started) await call('files.saveAbort').catch(() => {});
        throw error;
      } finally { saving = false; }
    }},
    settings: {get: () => call('settings.get'), set: patch => call('settings.set', patch)},
    pet: {setVisible: () => {}, isVisible: () => Promise.resolve(false)},
    push: {register: () => Promise.resolve(null)},
    badge: {set: (count, style) => { void call('badge.set', count, style); }},
    appearance: {sync: appearance => { void call('appearance.sync', appearance); }},
    haptics: {play: kind => { void call('haptics.play', kind); }}
  });
})();
