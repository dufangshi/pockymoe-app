// Module replacements shared by Metro (metro.config.js), vitest (vitest.config.ts) and
// TypeScript (tsconfig paths). Vendored files stay verbatim; the browser-only modules
// they import resolve to native replacements here.
const path = require('node:path');

const root = __dirname;
const webLib = path.join(root, 'vendor/pockymoe/runtime/apps/supervisor-web/src/lib');

/** Bare specifiers, wherever they are imported from. */
const aliases = {
  '@pockymoe/shared': 'vendor/pockymoe/runtime/packages/shared/src/index.ts',
  '@pockymoe/thread-ui/i18n': 'src/i18n/index.ts',
  'hash-wasm': 'src/platform/web/hashWasm.ts',
};
/** Relative imports made by vendored Web lib files. */
const webLibRedirects = {};
/** `@pockymoe/web/<name>` reaches a vendored Web lib module from app code. */
const webPrefix = '@pockymoe/web/';
/** `@pockymoe/web-git/<name>` reaches vendored Web Git and pull request modules. */
const webGit = path.join(root, 'vendor/pockymoe/runtime/apps/supervisor-web/src/components/git');
const webGitPrefix = '@pockymoe/web-git/';

function resolveTarget(moduleName, origin) {
  if (aliases[moduleName]) return path.join(root, aliases[moduleName]);
  if (moduleName.startsWith(webGitPrefix)) return path.join(webGit, moduleName.slice(webGitPrefix.length) + '.ts');
  if (moduleName.startsWith(webPrefix)) return path.join(webLib, moduleName.slice(webPrefix.length) + (moduleName.endsWith('.json') ? '' : '.ts'));
  if (origin && origin.startsWith(webLib + path.sep) && webLibRedirects[moduleName]) return path.join(root, webLibRedirects[moduleName]);
  return null;
}

module.exports = { root, webLib, webGit, aliases, webLibRedirects, webPrefix, webGitPrefix, resolveTarget };
