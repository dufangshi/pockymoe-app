#!/usr/bin/env node
// Private release key stays on the signing Mac. Validation keys exist in memory
// for one invocation and never read the production private key.
const { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify, createHash } = require('node:crypto');
const { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const { homedir } = require('node:os');
const root = join(__dirname, '..');
const privatePath = join(homedir(), 'dev/remoteCodex/.local/mobile-release/client-update-ed25519.pem');
const publicPath = join(root, 'desktop/build/update-public-key.pem');
const platforms = [['darwin-arm64', 'mac-arm64.dmg'], ['win32-x64', 'win-x64.exe']];
function canonical(value) { return JSON.stringify({ version: value.version, platform: value.platform, fileName: value.fileName, sha256: value.sha256, size: value.size }); }
function versionCheck(version) { if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Expected stable numeric version'); }
function publicPem(key) { return createPublicKey(key).export({ type: 'spki', format: 'pem' }); }
function productionKey() {
  if ((statSync(privatePath).mode & 0o077) !== 0) throw new Error('Release private key permissions must be 0600');
  return createPrivateKey(readFileSync(privatePath));
}
function publishGate() {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (git('status', '--porcelain') || git('branch', '--show-current') !== 'main') throw new Error('Production metadata signing requires clean main');
  git('fetch', 'origin', 'main');
  if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) throw new Error('Production metadata signing requires main matching origin/main');
}
function signMetadata(version, folder, destination, key) {
  versionCheck(version);
  const entries = platforms.map(([platform, suffix]) => {
    const fileName = `Pockymoe-${version}-${suffix}`, bytes = readFileSync(join(folder, fileName));
    const value = { version, platform, fileName, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
    return { ...value, signature: sign(null, Buffer.from(canonical(value)), key).toString('base64') };
  });
  writeFileSync(destination, `<!-- pockymoe-updates-v1\n${JSON.stringify(entries)}\n-->\n`, { flag: 'wx', mode: 0o644 });
}
function verifyMetadata(version, folder, notes, keyFile) {
  versionCheck(version);
  const text = readFileSync(notes, 'utf8');
  const matches = [...text.matchAll(/<!-- pockymoe-updates-v1\n([^]*?)\n-->/g)];
  if (matches.length !== 1) throw new Error('Expected one update metadata comment');
  const entries = JSON.parse(matches[0][1]), key = createPublicKey(readFileSync(keyFile));
  if (!Array.isArray(entries) || entries.length !== platforms.length) throw new Error('Expected both desktop metadata entries');
  for (const [platform, suffix] of platforms) {
    const candidates = entries.filter(entry => entry?.platform === platform);
    if (candidates.length !== 1) throw new Error('Expected exactly one entry per platform');
    const entry = candidates[0], fileName = `Pockymoe-${version}-${suffix}`, bytes = readFileSync(join(folder, fileName));
    if (entry.version !== version || entry.fileName !== fileName || entry.size !== bytes.length || entry.sha256 !== createHash('sha256').update(bytes).digest('hex') || typeof entry.signature !== 'string' || !verify(null, Buffer.from(canonical(entry)), key, Buffer.from(entry.signature, 'base64'))) throw new Error('Update metadata verification failed');
  }
}
function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'init' && !args.length) {
    // Explicit initial provisioning is separate from every release-build path.
    if (!existsSync(privatePath)) {
      mkdirSync(join(privatePath, '..'), { recursive: true, mode: 0o700 });
      const { privateKey } = generateKeyPairSync('ed25519');
      writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
    }
    const publicKey = publicPem(productionKey());
    if (existsSync(publicPath) && !readFileSync(publicPath).equals(Buffer.from(publicKey))) throw new Error('Public key mismatch; explicit reviewed rotation required');
    writeFileSync(publicPath, publicKey);
    console.log('Release verification public key ready; private key retained locally');
  } else if (mode === 'sign-validation' && args.length === 4) {
    const [version, folder, destination, publicDestination] = args;
    const { privateKey } = generateKeyPairSync('ed25519');
    writeFileSync(publicDestination, publicPem(privateKey), { flag: 'wx', mode: 0o644 });
    signMetadata(version, folder, destination, privateKey);
    console.log('Validation metadata signed with a fresh throwaway key; production key was not read');
  } else if (mode === 'sign' && args.length === 4 && args[3] === '--publish') {
    const [version, folder, destination] = args;
    publishGate(); // Must precede production private-key access.
    const key = productionKey();
    if (!Buffer.from(publicPem(key)).equals(Buffer.from(createPublicKey(readFileSync(publicPath)).export({ type: 'spki', format: 'pem' })))) throw new Error('Signing key does not match compiled public key');
    signMetadata(version, folder, destination, key);
    console.log('Production release-body metadata signed for explicit publication');
  } else if (mode === 'verify' && args.length === 4) {
    verifyMetadata(...args);
    console.log('Release-body metadata matches both desktop artifacts and the supplied public key');
  } else throw new Error('Usage: update-signatures.cjs init | sign-validation VERSION FOLDER NOTES PUBLIC_KEY | sign VERSION FOLDER NOTES --publish | verify VERSION FOLDER NOTES PUBLIC_KEY');
}
try { main(); }
catch { process.stderr.write('Update metadata command failed; no key or subprocess details were printed\n'); process.exitCode = 1; }
