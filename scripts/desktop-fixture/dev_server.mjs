// Use the product Vite config, with a loopback listener and test-only files ignored.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [webRoot, port] = process.argv.slice(2);
const root = join(webRoot, 'apps/supervisor-web');
const require = createRequire(join(root, 'package.json'));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const server = await createServer({
  root,
  configFile: join(root, 'vite.config.ts'),
  server: {
    host: '127.0.0.1', port: Number(port), strictPort: true,
    // Vite serves the development worker under /src/; the product worker needs
    // root scope to encrypt device requests on every SPA route.
    headers: { 'Service-Worker-Allowed': '/' },
    // A peer adding browser tests must not reload an account form mid-entry.
    watch: { ignored: ['**/*.pw.ts', '**/*.test.ts', '**/*.test.tsx'] },
  },
});
await server.listen();
server.printUrls();
