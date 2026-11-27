import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { resolveTarget, webLib } = require('./resolver.cjs');

const root = __dirname;
const testOverrides: Record<string, string> = {
  [path.join(root, 'src/platform/native/argon2.ts')]: path.join(root, 'test/node/argon2.ts'),
  [path.join(root, 'src/platform/web/browserLabel.ts')]: path.join(root, 'test/node/stubs.ts'),
  // reached from the vendored overlay by a relative path
};
const bare: Record<string, string> = {
  'expo-localization': path.join(root, 'test/node/stubs.ts'),
  'expo-sqlite/kv-store': path.join(root, 'test/node/stubs.ts'),
  'react-native': path.join(root, 'test/node/reactNative.ts'),
  'expo-file-system': path.join(root, 'test/node/fileSystem.ts'),
};

export default defineConfig({
  plugins: [{
    name: 'pockymoe-resolver',
    enforce: 'pre',
    resolveId(source, importer) {
      if (bare[source]) return bare[source];
      // The Node stand-ins import the real packages they replace.
      if (importer?.includes(`${path.sep}test${path.sep}node${path.sep}`)) return null;
      const target = resolveTarget(source, importer);
      if (target) return testOverrides[target] ?? target;
      if (importer && source.startsWith('.')) {
        for (const ext of ['', '.ts', '.tsx']) {
          const candidate = path.resolve(path.dirname(importer), source) + ext;
          if (testOverrides[candidate]) return testOverrides[candidate];
        }
      }
      return null;
    },
  }],
  test: { environment: 'node', include: ['test/**/*.test.ts', 'src/**/*.test.ts'], exclude: ['test/lab/**', 'node_modules/**'], setupFiles: ['test/setup.ts'], testTimeout: 30000 },
  define: { __WEB_LIB__: JSON.stringify(webLib) },
});
