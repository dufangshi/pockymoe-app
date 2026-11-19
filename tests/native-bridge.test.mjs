import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../web/native-bridge.js', import.meta.url), 'utf8');
function fixture(platform = 'android') {
  const messages = [], handlers = {}, intervals = [];
  const fetch = async () => ({ blob: async () => ({ size: 20, type: 'text/html' }) });
  const serviceWorker = {};
  const ctx = { location: { pathname: '/devices/a/threads/b', search: '', hash: '' },
    localStorage: { getItem: () => 'dark' }, navigator: { serviceWorker }, fetch,
    history: { pushState() {}, replaceState() {} },
    addEventListener: (key, handler) => { handlers[key] = handler; },
    document: { addEventListener: (key, handler) => { handlers[key] = handler; } },
    setInterval(handler, delay) { intervals.push({ handler, delay }); }, FileReader: class { readAsDataURL() { this.result = 'data:text/html;base64,YQ=='; this.onload(); } },
  };
  ctx.window = ctx;
  ctx.URL = { createObjectURL: () => 'blob:owned', revokeObjectURL() {} };
  const host = { postMessage: raw => messages.push(JSON.parse(raw)) };
  if (platform === 'android') ctx.RemoteCodexHost = host;
  else ctx.webkit = { messageHandlers: { remoteCodex: host } };
  vm.runInNewContext(source, ctx);
  return { ctx, messages, handlers, intervals, fetch, serviceWorker };
}
test('native bridge preserves authenticated fetch and real Service Workers on both platforms', () => {
  for (const platform of ['android', 'ios']) {
    const { ctx, messages, fetch, serviceWorker } = fixture(platform);
    assert.equal(ctx.fetch, fetch);
    assert.equal(ctx.navigator.serviceWorker, serviceWorker);
    assert.equal(ctx.remoteCodexNative.platform, platform);
    ctx.location.pathname = '/devices/a/threads/next';
    ctx.history.pushState({}, '', ctx.location.pathname);
    assert.equal(messages.at(-1).path, ctx.location.pathname);
    assert.equal(messages.at(-1).theme, 'dark');
  }
});
test('native share promises complete only after native acknowledgement', async () => {
  const { ctx, messages } = fixture();
  const promise = ctx.navigator.share({ text: 'Example', url: 'https://relay.test/thread' });
  const sent = messages.at(-1);
  assert.equal(sent.type, 'share');
  assert.equal(sent.text, 'Example');
  ctx.remoteCodexNative.resolve(sent.id, null);
  await promise;
});
test('blob HTML exports reach the native document picker', async () => {
  const { handlers, messages } = fixture();
  let cancelled = false;
  await handlers.click({ target: { closest: () => ({ href: 'blob:example', download: 'thread.html' }) }, preventDefault() { cancelled = true; } });
  assert.equal(cancelled, true);
  assert.equal(messages.at(-1).type, 'download');
  assert.equal(messages.at(-1).name, 'thread.html');
  assert.equal(messages.at(-1).data, 'data:text/html;base64,YQ==');
});
test('owned blob downloads work when CSP blocks fetching object URLs', async () => {
  const { ctx, handlers, messages } = fixture();
  ctx.fetch = () => { throw new Error('CSP blocked fetch(blob:)'); };
  const href = ctx.URL.createObjectURL({ size: 20, type: 'text/html' });
  await handlers.click({ target: { closest: () => ({ href, download: 'thread.html' }) }, preventDefault() {} });
  assert.equal(messages.at(-1).type, 'download');
  ctx.URL.revokeObjectURL(href);
});

test('state checks are slow and pause while hidden; resume reports immediately', () => {
  const { ctx, handlers, intervals, messages } = fixture('ios');
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].delay, 60000);
  const initial = messages.length;
  ctx.document.hidden = true;
  intervals[0].handler();
  handlers.visibilitychange();
  assert.equal(messages.length, initial);
  ctx.document.hidden = false;
  handlers.visibilitychange();
  assert.equal(messages.length, initial + 1);
  ctx.location.hash = '#next';
  handlers.hashchange();
  assert.equal(messages.at(-1).path, '/devices/a/threads/b#next');
});
test('page can explicitly transfer notification ownership and release it on disconnect', () => {
  const { ctx, messages } = fixture('ios');
  assert.equal(messages.some(message => message.type === 'eventDelivery'), false);
  ctx.remoteCodexNative.setEventDeliveryActive(true);
  assert.equal(messages.at(-1).type, 'eventDelivery');
  assert.equal(messages.at(-1).active, true);
  ctx.remoteCodexNative.setEventDeliveryActive(false);
  assert.equal(messages.at(-1).active, false);
});
