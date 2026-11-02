/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads this CommonJS hook. */
const { readdirSync, readFileSync, lstatSync } = require('node:fs');
const { join } = require('node:path');
const { deepStrictEqual, strictEqual } = require('node:assert');

function verifyBundledPets(resources) {
  const pets = join(resources, 'pets');
  deepStrictEqual(readdirSync(pets).sort(), ['moe'], 'Packaged built-in pets must be exactly moe');
  strictEqual(lstatSync(join(pets, 'moe')).isDirectory(), true);
  strictEqual(JSON.parse(readFileSync(join(pets, 'moe/pet.json'), 'utf8')).id, 'moe');
  console.log('Packaged resources/pets: moe');
}
exports.verifyBundledPets = verifyBundledPets;
if (require.main === module) verifyBundledPets(process.argv[2]);
