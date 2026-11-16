/* eslint-disable @typescript-eslint/no-require-imports -- Build tooling uses CommonJS. */
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { flipReleaseInspectorFuse, verifyReleaseFuses } = require('./release-fuses.cjs');

// Electron's documented V1 wire: sentinel, version byte, length, ASCII states.
// Include an unknown future fuse so the test also guards preservation on upgrades.
const fixture = states => Buffer.concat([Buffer.from('prefix:dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'), Buffer.from([1, states.length]), Buffer.from(states), Buffer.from(':suffix')]);
test('release changes only inspector and preserves RunAsNode and every other byte', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'pockymoe-fuses-test-'));
  try {
    const binary = join(folder, 'Electron.exe');
    writeFileSync(binary, fixture('1011001011'));
    await assert.rejects(verifyReleaseFuses(binary), /inspector|Inspect/);
    await flipReleaseInspectorFuse(binary);
    assert.deepEqual(readFileSync(binary), fixture('1010001011'));
    await verifyReleaseFuses(binary);
    await flipReleaseInspectorFuse(binary); // Idempotent when packaging an already-fused input.
    assert.deepEqual(readFileSync(binary), fixture('1010001011'));
    for (const invalid of ['0010001011', '101r001011', '101']) {
      writeFileSync(binary, fixture(invalid));
      await assert.rejects(verifyReleaseFuses(binary), /RunAsNode/);
    }
    writeFileSync(binary, Buffer.from('not an Electron binary'));
    await assert.rejects(verifyReleaseFuses(binary), /sentinel/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
