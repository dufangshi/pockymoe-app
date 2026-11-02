/* eslint-disable @typescript-eslint/no-require-imports -- Build tooling uses CommonJS. */
// Use electron-builder's locked dependency, without a network install at scan time.
const { createRequire } = require('node:module');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join, dirname } = require('node:path');
const builder = createRequire(require.resolve('electron-builder'));
const dependencies = createRequire(builder.resolve('app-builder-lib'));
const asar = dependencies('@electron/asar');
if (process.argv.length !== 4) throw new Error('Usage: node scripts/extract-asar.cjs archive destination');
const [archive, destination] = process.argv.slice(2);
// afterPack removes native packages for other platforms. Their unpacked header
// entries remain in the archive; scan real app.asar.unpacked separately in CI.
let count = 0;
for (const listed of asar.listPackage(archive)) {
  const name = listed.replace(/^[/\\]+/, "");
  const entry = asar.statFile(archive, name);
  if (entry.files || entry.unpacked) continue;
  const path = join(destination, name.replace(/^[/\\]+/, ''));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, asar.extractFile(archive, name));
  count++;
}
console.log(`Extracted ${count} packed files`);
