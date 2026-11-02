/* eslint-disable @typescript-eslint/no-require-imports -- Also callable directly by Node on the build host. */
const { readFileSync, readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');
const files = ['sherpa-onnx.node', 'onnxruntime.dll', 'onnxruntime_providers_shared.dll', 'sherpa-onnx-c-api.dll', 'sherpa-onnx-cxx-api.dll'];
function verifyWindowsPackage(directory, arch) {
  const machine = { x64: 0x8664, arm64: 0xaa64 }[arch];
  if (!machine) throw new Error(`Unsupported architecture ${arch}`);
  const modules = join(directory, 'resources', 'app.asar.unpacked', 'node_modules');
  const addon = `sherpa-onnx-win-${arch}`;
  const unexpected = readdirSync(modules).filter(name => name.startsWith('sherpa-onnx-') && ![addon, 'sherpa-onnx-node'].includes(name));
  if (unexpected.length) throw new Error(`Unexpected native packages: ${unexpected.join(', ')}`);
  for (const file of files) {
    const path = join(modules, addon, file), bytes = readFileSync(path);
    const pe = bytes.readUInt32LE(0x3c);
    if (bytes.toString('ascii', 0, 2) !== 'MZ' || bytes.toString('ascii', pe, pe + 4) !== 'PE\0\0' || bytes.readUInt16LE(pe + 4) !== machine) throw new Error(`Wrong PE architecture: ${path}`);
    console.log(`${arch}: ${file}: ${statSync(path).size} bytes, PE machine 0x${machine.toString(16)}, unpacked`);
  }
}
module.exports = { verifyWindowsPackage };
if (require.main === module) verifyWindowsPackage(process.argv[2], process.argv[3]);
