/* eslint-disable @typescript-eslint/no-require-imports -- Build tooling uses CommonJS. */
// Resolve the locked builder's own architecture-appropriate, checksummed tool.
const { createRequire } = require('node:module');
const builder = createRequire(require.resolve('electron-builder'));
require(builder.resolve('app-builder-lib/out/toolsets/7zip')).getPath7za().then(path => console.log(path)).catch(() => { process.exitCode = 1; });
