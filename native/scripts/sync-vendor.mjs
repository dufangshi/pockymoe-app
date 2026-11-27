#!/usr/bin/env node
// Copies Pockymoe protocol code into vendor/pockymoe/ verbatim and records where it came from.
//   node scripts/sync-vendor.mjs <runtime checkout> [<thread-ui checkout>]   copy and pin
//   node scripts/sync-vendor.mjs --check                                      verify hashes
// Vendored files are never edited; browser-only modules are swapped at resolution
// (resolver.cjs), so a sync is a plain copy.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = join(root, 'vendor/pockymoe');
const manifestPath = join(vendor, 'SOURCE.json');

/** Runtime repo files, relative to its root. */
const RUNTIME = [
  'packages/shared/src/index.ts',
  'packages/shared/src/agent-providers.ts',
  'packages/shared/src/automation.ts',
  'packages/shared/src/deviceMetrics.ts',
  'packages/shared/src/harnessResources.ts',
  'packages/shared/src/storage.ts',
  ...[
    'accountAuth', 'accountCrypto', 'accountStore', 'accountTransport', 'accountVault', 'accountVaultState',
    'pendingEnrollmentStore', 'relayOrigin', 'relayTransportCrypto', 'sessionActor', 'sharePending',
    'sharedDeviceTrust', 'sharingTrustStore', 'unlockCause', 'webBase', 'tourSandbox/tourDevice',
    'ownerUnlockRecovery', 'gitApi',
    'gitI18n',
  ].map(name => `apps/supervisor-web/src/lib/${name}.ts`),
  // Git diff parsing and pull request review: pure logic, types and copy.
  ...['patch', 'pr/api', 'pr/text', 'pr/review/reviewApi', 'pr/review/listModel', 'pr/review/reviewText']
    .map(name => `apps/supervisor-web/src/components/git/${name}.ts`),
  'apps/supervisor-web/src/lib/fixtures/accountKeyVectors.json',
  'crates/relay/test-fixtures/account-key-v2.json',
  // Theme pack agent art, same files as the Web packs: Plum Pocket's avatars and composer
  // mascots, Terminal's square tags.
  ...packAgents('plum-pocket', '.webp'),
  // Plum Pocket's pocket friends above the sign-in card and in empty states (pages.css).
  'themes/plum-pocket/assets/pocket-friends.webp',
  ...packAgents('terminal', '.svg'),
];
function packAgents(pack, ext) {
  const runtime = process.argv[2] && resolve(process.argv[2]);
  const dir = runtime && join(runtime, `themes/${pack}/assets/agents`);
  return dir && existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith(ext)).map(f => `themes/${pack}/assets/agents/${f}`) : [];
}
/** Shared UI files, relative to packages/thread-ui/src. Pure data and pure logic only. */
const THREAD_UI = [
  'i18n/locales.ts',
  ...readdirIfExists('i18n').filter(f => /\.(en|zh-CN)\.ts$|^(en|zh-CN)\.ts$/.test(f)).map(f => `i18n/${f}`),
  ...['durationFormatting', 'timelineItems', 'activity', 'answerSections', 'turnErrors'].map(n => `components/timeline/${n}.ts`),
  'components/graph-chat/turnPrompts.ts',
  'components/composer/promptQuotes.ts',
  'components/composer/contextInspectionModel.ts',
  // The composer model picker's ordering, search, facts and handoff summary (pure).
  'components/composer/modelPicker/modelPickerLogic.ts',
  'components/themeAgent.ts',
  // Attachment tiles: file family, badge and the short name (pure).
  'components/attachments/attachmentFiles.ts',
];
function readdirIfExists(sub) {
  const ui = process.argv[3] ?? defaultThreadUi(process.argv[2]);
  const dir = ui && join(ui, 'packages/thread-ui/src', sub);
  return dir && existsSync(dir) ? readdirSync(dir) : [];
}
function defaultThreadUi(runtime) {
  return runtime ? join(runtime, 'pockymoe-thread-ui') : undefined;
}
const sha256 = data => createHash('sha256').update(data).digest('hex');
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

function check() {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const bad = [];
  for (const source of manifest.sources) for (const [file, hash] of Object.entries(source.files)) {
    const path = join(vendor, source.prefix, file);
    if (!existsSync(path)) bad.push(`missing ${relative(root, path)}`);
    else if (sha256(readFileSync(path)) !== hash) bad.push(`edited ${relative(root, path)}`);
  }
  for (const [file, hash] of Object.entries(manifest.overlays ?? {})) {
    const path = join(vendor, file), source = join(root, 'vendor-overlay', file);
    if (!existsSync(path) || sha256(readFileSync(path)) !== hash || sha256(readFileSync(source)) !== hash) bad.push(`overlay out of date ${file}`);
  }
  if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
  console.log(`vendor ok: ${manifest.sources.map(s => `${s.repository}@${s.commit.slice(0, 8)}`).join(', ')}`);
}

function copy(repoRoot, prefix, base, files, repository) {
  const out = join(vendor, prefix);
  rmSync(out, { recursive: true, force: true });
  const hashes = {};
  for (const file of files) {
    const from = join(repoRoot, base, file);
    if (!existsSync(from) || !statSync(from).isFile()) throw new Error(`missing ${from}`);
    const to = join(out, file);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
    hashes[file] = sha256(readFileSync(to));
  }
  const dirty = git(repoRoot, 'status', '--porcelain', '--', ...files.map(f => join(base, f)));
  if (dirty) throw new Error(`${repoRoot} has uncommitted changes in vendored files:\n${dirty}`);
  return { repository, prefix, base, commit: git(repoRoot, 'rev-parse', 'HEAD'), files: hashes };
}

// Terminal's agent tags are SVG squares with a monogram. Android's SVG decoder drops XML
// entities in <text> (`&gt;_` drew as `_`), so the marks are drawn natively from these files'
// own colours and text, written to a generated module the check compares.
const marksPath = join(root, 'src/design/terminalMarks.generated.ts');
function terminalMarks() {
  const dir = join(vendor, 'runtime/themes/terminal/assets/agents');
  const decode = v => v.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const marks = {};
  for (const file of existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.svg')).sort() : []) {
    const svg = readFileSync(join(dir, file), 'utf8');
    const attr = (tag, name) => svg.match(new RegExp(`<${tag}\\b[^>]*?\\s${name}="([^"]*)"`))?.[1];
    const frame = svg.match(/<rect\b[^>]*stroke="([^"]*)"[^>]*stroke-opacity="([^"]*)"/);
    marks[file.slice(0, -4)] = {
      fill: attr('rect', 'fill'), stroke: frame?.[1], strokeOpacity: Number(frame?.[2] ?? 1),
      text: decode(svg.match(/<text\b[^>]*>([^<]*)<\/text>/)?.[1] ?? ''), color: attr('text', 'fill'), fontSize: Number(attr('text', 'font-size') ?? 15),
    };
  }
  return `// Generated by scripts/sync-vendor.mjs from vendor/pockymoe/runtime/themes/terminal/assets/agents
// (32 × 32 SVG tags). Do not edit.
export interface TerminalMark { fill: string; stroke: string; strokeOpacity: number; text: string; color: string; fontSize: number }
export const TERMINAL_MARKS: Record<string, TerminalMark> = ${JSON.stringify(marks, null, 2)};
`;
}

if (process.argv[2] === '--check') {
  check();
  if (!existsSync(marksPath) || readFileSync(marksPath, 'utf8') !== terminalMarks()) { console.error('src/design/terminalMarks.generated.ts is stale: run vendor:sync'); process.exit(1); }
} else {
  const runtime = process.argv[2] && resolve(process.argv[2]);
  const threadUi = resolve(process.argv[3] ?? defaultThreadUi(runtime) ?? '');
  if (!runtime || !existsSync(join(runtime, 'packages/shared'))) {
    console.error('usage: sync-vendor.mjs <runtime checkout> [<thread-ui checkout>] | --check');
    process.exit(2);
  }
  const sources = [
    copy(runtime, 'runtime', '', RUNTIME, 'dufangshi/pockymoe'),
    copy(threadUi, 'thread-ui', 'packages/thread-ui/src', THREAD_UI, 'dufangshi/pockymoe-thread-ui-rust'),
  ];
  // Overlays add native stand-ins for upstream modules that are not vendored
  // (browser-only). They never replace a vendored file.
  const overlays = {};
  const overlayRoot = join(root, 'vendor-overlay');
  const walk = dir => readdirSync(dir).flatMap(name => statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]);
  for (const file of existsSync(overlayRoot) ? walk(overlayRoot) : []) {
    const rel = relative(overlayRoot, file), to = join(vendor, rel);
    if (existsSync(to)) throw new Error(`overlay would replace vendored ${rel}`);
    mkdirSync(dirname(to), { recursive: true }); cpSync(file, to);
    overlays[rel] = sha256(readFileSync(to));
  }
  writeFileSync(manifestPath, JSON.stringify({ note: 'Generated by scripts/sync-vendor.mjs. Do not edit vendored files; overlays come from vendor-overlay/.', sources, overlays }, null, 2) + '\n');
  writeFileSync(marksPath, terminalMarks());
  check();
}
