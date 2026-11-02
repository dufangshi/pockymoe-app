#!/usr/bin/env node
// Local release private key never leaves the signing Mac. No secret values logged.
const { generateKeyPairSync, createPrivateKey, createPublicKey, sign, createHash } = require('node:crypto');
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { homedir } = require('node:os');
const privatePath = join(homedir(), 'dev/remoteCodex/.local/mobile-release/client-update-ed25519.pem');
const publicPath = join(__dirname, '../desktop/build/update-public-key.pem');
function canonical(value) { return JSON.stringify({ version: value.version, platform: value.platform, fileName: value.fileName, sha256: value.sha256, size: value.size }); }
if (process.argv[2] === 'init') {
  if (!existsSync(privatePath)) {
    mkdirSync(join(privatePath, '..'), { recursive: true, mode: 0o700 });
    const { privateKey } = generateKeyPairSync('ed25519');
    writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  }
  const publicKey = createPublicKey(createPrivateKey(readFileSync(privatePath))).export({ type: 'spki', format: 'pem' });
  if (existsSync(publicPath) && !readFileSync(publicPath).equals(Buffer.from(publicKey))) throw new Error('Public key mismatch; explicit reviewed rotation required');
  writeFileSync(publicPath, publicKey);
  console.log('Release verification public key ready; private key retained locally');
} else if (process.argv[2] === 'sign') {
  const [version, folder, destination] = process.argv.slice(3);
  const key = createPrivateKey(readFileSync(privatePath));
  if (!createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString().includes(readFileSync(publicPath, 'utf8').trim())) throw new Error('Signing key does not match compiled public key');
  const entries = [['darwin-arm64', 'mac-arm64.dmg'], ['win32-x64', 'win-x64.exe']].map(([platform, suffix]) => {
    const fileName = `Pockymoe-${version}-${suffix}`, bytes = readFileSync(join(folder, fileName));
    const value = { version, platform, fileName, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
    return { ...value, signature: sign(null, Buffer.from(canonical(value)), key).toString('base64') };
  });
  writeFileSync(destination, `<!-- pockymoe-updates-v1\n${JSON.stringify(entries)}\n-->\n`, { flag: 'wx' });
  console.log('Signed release-body metadata written (no extra release asset)');
} else throw new Error('Usage: update-signatures.cjs init | sign VERSION FOLDER DESTINATION');
