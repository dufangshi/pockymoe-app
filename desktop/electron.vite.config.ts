import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const petHtml = resolve('src/pet/index.html');
const petPreload = resolve('src/pet/preload.ts');
const updateTest = process.env.POCKYMOE_UPDATER_TEST_BUILD === '1';
const updateDefines = {
  __UPDATER_TEST_BUILD__: JSON.stringify(updateTest),
  __UPDATER_FEED__: JSON.stringify(updateTest ? process.env.POCKYMOE_UPDATER_TEST_FEED : 'https://api.github.com/repos/dufangshi/pockymoe-app/releases/latest'),
  __UPDATER_PUBLIC_KEY__: JSON.stringify(readFileSync(updateTest ? process.env.POCKYMOE_UPDATER_TEST_PUBLIC_KEY! : resolve('build/update-public-key.pem'), 'utf8')),
  __UPDATER_MAC_CERT__: JSON.stringify(JSON.parse(readFileSync('build/release-signing.json', 'utf8')).certificateSha1)
};
if (updateTest && (!process.env.POCKYMOE_UPDATER_TEST_FEED || !process.env.POCKYMOE_UPDATER_TEST_PUBLIC_KEY)) throw new Error('Test updater build requires fixture feed and key');
export default defineConfig({
  main: { define: updateDefines, plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), voiceWorker: resolve('src/main/voice/worker.ts'), updateHelper: resolve('src/main/updateHelper.ts') } } } },
  preload: { build: { rollupOptions: { input: { relay: resolve('src/preload/relay.ts'), local: resolve('src/preload/local.ts'), ...(existsSync(petPreload) ? { pet: petPreload } : {}) } } } },
  renderer: {
    root: 'src',
    build: { rollupOptions: { input: { local: resolve('src/local/index.html'), ...(existsSync(petHtml) ? { pet: petHtml } : {}) } } }
  }
});
