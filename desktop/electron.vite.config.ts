import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const petHtml = resolve('src/pet/index.html');
const petPreload = resolve('src/pet/preload.ts');
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), voiceWorker: resolve('src/main/voice/worker.ts') } } } },
  preload: { build: { rollupOptions: { input: { relay: resolve('src/preload/relay.ts'), local: resolve('src/preload/local.ts'), ...(existsSync(petPreload) ? { pet: petPreload } : {}) } } } },
  renderer: {
    root: 'src',
    build: { rollupOptions: { input: { local: resolve('src/local/index.html'), ...(existsSync(petHtml) ? { pet: petHtml } : {}) } } }
  }
});
