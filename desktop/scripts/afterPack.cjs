/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads this CommonJS hook. */
// pnpm installs every architecture of the speech addon so one host can build both; ship only this build's.
const { readdirSync, rmSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { Arch } = require('electron-builder');
const { verifyWindowsPackage } = require('./verify-windows-package.cjs');

exports.default = async function afterPack({ appOutDir, arch, electronPlatformName, packager }) {
  const resources = electronPlatformName === 'darwin' ? join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources') : join(appOutDir, 'resources');
  const modules = join(resources, 'app.asar.unpacked', 'node_modules');
  if (!existsSync(modules)) throw new Error('The speech addon was not unpacked');
  const keep = `sherpa-onnx-${electronPlatformName === 'win32' ? 'win' : electronPlatformName}-${Arch[arch]}`;
  if (!existsSync(join(modules, keep))) throw new Error(`Missing ${keep}`);

  for (const name of readdirSync(modules)) if (name.startsWith('sherpa-onnx-') && name !== 'sherpa-onnx-node' && name !== keep) rmSync(join(modules, name), { recursive: true });
  if (electronPlatformName === 'win32') verifyWindowsPackage(appOutDir, Arch[arch]);
};
