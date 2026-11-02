import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../web/pockymoe-host.js', import.meta.url), 'utf8').replace('__POCKYMOE_ORIGIN__', JSON.stringify('https://example.test'));
function context(origin = 'https://example.test', topFrame = true, webkit = true) {
  const messages = [];
  const events = new Map();
  const window = { webkit: { messageHandlers: { remoteCodex: { postMessage: value => messages.push(value) } } } };
  if (!webkit) {
    delete window.webkit;
    window.RemoteCodexHost = { postMessage: value => messages.push(JSON.parse(value)) };
  }
  window.addEventListener = (name, callback) => events.set(name, callback);
  window.top = topFrame ? window : {};
  const env = { window, location: { origin }, document: { readyState: 'complete', getElementById: () => null }, requestAnimationFrame: f => f(), Uint8Array };
  vm.runInNewContext(source, env);
  return { window, messages, events };
}
test('only configured origin top frame gets the bridge', () => {
  assert.equal(context('https://evil.test').window.pockymoeHost, undefined);
  assert.equal(context('https://example.test', false).window.pockymoeHost, undefined);
});
test('promises, binary save and native command replies preserve the contract', async () => {
  const { window, messages } = context();
  const host = window.pockymoeHost;
  const promise = host.capabilities();
  const request = messages.at(-1);
  window.__pockymoeReply(request.id, { surface: 'mobile', platform: 'ios' });
  assert.equal((await promise).platform, 'ios');
  let command;
  const unsubscribe = host.onCommand(value => { command = value; });
  window.__pockymoeCommand({ id: 'b', type: 'back' });
  assert.equal(command.type, 'back');
  host.commandResult('b', { ok: true, data: { handled: true } });
  assert.equal(messages.at(-1).args[1].data.handled, true);
  unsubscribe(); command = null;
  window.__pockymoeCommand({ id: 'c', type: 'back' });
  assert.equal(command, null);
  const saved = host.files.saveAs('test.txt', new Uint8Array([1, 2]).buffer);
  assert.deepEqual(Array.from(messages.at(-1).args[1]), [1, 2]);
  window.__pockymoeReply(messages.at(-1).id, { saved: false });
  assert.equal((await saved).saved, false);
  host.window.openPreferences(); host.pet.setVisible(true);
  assert.equal(await host.pet.isVisible(), false);
});

test('shared injection supports Android string transport without the legacy bridge', () => {
  const { window, messages } = context('https://example.test', true, false);
  window.pockymoeHost.activity.sync({ accountId: 'fixture', items: [] });
  assert.equal(messages.at(-1).method, 'activity.sync');
  assert.equal(messages.at(-1).args[0].accountId, 'fixture');
});

test('sign-out clears native metadata at the logout event', () => {
  const { window, messages, events } = context();
  events.get('pockymoe-account-logout')();
  assert.equal(messages.at(-1).method, 'session.clear');
  const count = messages.length;
  window.pockymoeHost.activity.sync({ accountId: 'stale', items: [] });
  assert.equal(messages.length, count);
  events.get('pockymoe-account-changed')();
  window.pockymoeHost.activity.sync({ accountId: 'signed-in', items: [] });
  assert.equal(messages.at(-1).method, 'activity.sync');
});
