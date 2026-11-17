import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../app/src/main/assets/pockymoe-host.js', import.meta.url), 'utf8');
function fixture(answer = () => null) {
  const messages = [];
  const ctx = { Uint8Array, btoa: value => Buffer.from(value, 'binary').toString('base64'),
    document: { querySelector: () => ({ content: 'width=device-width' }) },
    PockymoeAndroid: { postMessage(raw) {
      const message = JSON.parse(raw);
      messages.push(message);
      queueMicrotask(() => ctx.PockymoeAndroid.onmessage({ data: JSON.stringify({
        id: message.id, ...answer(message),
      }) }));
    } },
  };
  ctx.window = ctx;
  ctx.top = ctx;
  vm.runInNewContext(source, ctx);
  return { host: ctx.pockymoeHost, messages };
}

test('64 MiB export uses bounded, acknowledged chunks and returns picker cancellation', async () => {
  let count = 0;
  const { host, messages } = fixture(message => {
    if (message.method === 'files.saveChunk') {
      const bytes = Buffer.from(message.args[0], 'base64');
      assert.ok(bytes.length <= 48 * 1024);
      assert.ok(bytes.every(byte => byte === 123));
      count += bytes.length;
    }
    return { data: message.method === 'files.saveFinish' ? { saved: false } : null };
  });
  const bytes = new Uint8Array(64 * 1024 * 1024).fill(123);
  const result = host.files.saveAs('export.bin', bytes.buffer);
  assert.equal(messages.length, 1, 'wait for start acknowledgement before encoding');
  assert.equal((await result).saved, false);
  assert.equal(count, bytes.length);
  assert.equal(messages.at(-1).method, 'files.saveFinish');
});

test('oversize and concurrent saves never send another payload', async () => {
  const { host, messages } = fixture();
  await assert.rejects(host.files.saveAs('huge', new ArrayBuffer(64 * 1024 * 1024 + 1)), /64 MiB/);
  assert.equal(messages.length, 0);
  const pending = host.files.saveAs('one', new ArrayBuffer(1));
  await assert.rejects(host.files.saveAs('two', new ArrayBuffer(1)), /already/);
  await pending;
});

test('failed chunk aborts the temporary export and allows retry', async () => {
  const { host, messages } = fixture(message => message.method === 'files.saveChunk' ? { error: 'disk full' } : { data: { saved: true } });
  await assert.rejects(host.files.saveAs('one', new ArrayBuffer(1)), /disk full/);
  assert.equal(messages.at(-1).method, 'files.saveAbort');
  assert.equal((await host.files.saveAs('empty', new ArrayBuffer(0))).saved, true);
});
