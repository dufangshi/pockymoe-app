import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'node:path';
const out = '/tmp/rc-desktop/evidence/pet/v2/harness';
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { outDir: `${out}/main`, rollupOptions: { input: { index: resolve('src/pet/tools/harness.ts') } } } },
  preload: { build: { outDir: `${out}/preload`, rollupOptions: { input: { pet: resolve('src/pet/preload.ts') } } } },
  renderer: { root: 'src', build: { outDir: `${out}/renderer`, rollupOptions: { input: { pet: resolve('src/pet/index.html') } } } },
});
