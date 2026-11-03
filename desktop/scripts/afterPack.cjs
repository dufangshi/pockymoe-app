/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads this CommonJS hook. */
// pnpm installs the supported speech packages so one host can build both platforms; ship only this build's.
const { readdirSync, rmSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { Arch } = require('electron-builder');
const { verifyWindowsPackage } = require('./verify-windows-package.cjs');
const { verifyBundledPets } = require('./verify-bundled-pets.cjs');

exports.default = async function afterPack({ appOutDir, arch, electronPlatformName, packager }) {
  const resources = electronPlatformName === 'darwin' ? join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources') : join(appOutDir, 'resources');
  verifyBundledPets(resources);
  const modules = join(resources, 'app.asar.unpacked', 'node_modules');
  if (!existsSync(modules)) throw new Error('The speech addon was not unpacked');
  if (!((electronPlatformName === 'darwin' && Arch[arch] === 'arm64') || (electronPlatformName === 'win32' && Arch[arch] === 'x64'))) throw new Error('Unsupported client platform/architecture');
  const keep = `sherpa-onnx-${electronPlatformName === 'win32' ? 'win' : electronPlatformName}-${Arch[arch]}`;
  if (!existsSync(join(modules, keep))) throw new Error(`Missing ${keep}`);

  for (const name of readdirSync(modules)) if (name.startsWith('sherpa-onnx-') && name !== 'sherpa-onnx-node' && name !== keep) rmSync(join(modules, name), { recursive: true });
  if (electronPlatformName === 'win32') verifyWindowsPackage(appOutDir, Arch[arch]);
};
