// Disposable account fixture using the same vault-v1 format as the Web client.
// Secrets stay in a mode-0600 file; this program never writes them to stdout.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [webPackage, output] = process.argv.slice(2);
const { argon2id } = createRequire(resolve(webPackage))('hash-wasm');
const password = process.env.E2E_FIXTURE_PASSWORD;
if (!password || [...password].length < 12) throw new Error('Fixture password must have at least 12 characters');
const bytes = value => new Uint8Array(value);
const random = count => crypto.getRandomValues(new Uint8Array(count));
const encode = value => Buffer.from(value).toString('base64url');
const utf8 = value => new TextEncoder().encode(value);
const hkdf = async (input, info) => {
  const key = await crypto.subtle.importKey('raw', input, 'HKDF', false, ['deriveBits']);
  return bytes(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: utf8(info) }, key, 256));
};
const seal = async (keyBytes, clear, aad) => {
  const iv = random(12);
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  return { iv: encode(iv), ciphertext: encode(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(aad) }, key, clear)) };
};
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicKey = await crypto.subtle.exportKey('spki', pair.publicKey);
const accountKeyId = encode(await crypto.subtle.digest('SHA-256', publicKey));
const userId = randomUUID();
const salt = random(16);
const kdf = { name: 'argon2id', memoryKiB: 65536, iterations: 3, parallelism: 1, salt: encode(salt) };
const master = await argon2id({ password: password.normalize('NFC'), salt, memorySize: kdf.memoryKiB, iterations: 3, parallelism: 1, hashLength: 32, outputType: 'binary' });
const authKey = encode(await hkdf(master, 'pockymoe-relay-auth-v1'));
const wrapKey = await hkdf(master, 'pockymoe-vault-wrap-v1');
master.fill(0);
const recovery = random(20);
const recoveryAuthKey = encode(await hkdf(recovery, 'pockymoe-relay-recovery-v1'));
const recoveryKey = await hkdf(recovery, 'pockymoe-vault-recovery-v1');
recovery.fill(0);
const vdk = random(32);
const slotAad = slot => `pockymoe-vault-slot-v1\n${userId}\n${accountKeyId}\n${slot}`;
const body = { version: 1, accountPrivateKey: encode(await crypto.subtle.exportKey('pkcs8', pair.privateKey)), boundDevices: [], updatedAt: Date.now() };
const vault = { version: 1, userId, accountKeyId, accountPublicKey: encode(publicKey), revision: 1, kdf,
  slots: { password: await seal(wrapKey, vdk, slotAad('password')), recovery: await seal(recoveryKey, vdk, slotAad('recovery')) },
  body: await seal(vdk, utf8(JSON.stringify(body)), `pockymoe-vault-body-v1\n${userId}\n${accountKeyId}\n1`) };
body.accountPrivateKey = ''; vdk.fill(0); wrapKey.fill(0); recoveryKey.fill(0);
await writeFile(output, JSON.stringify({ userId, email: 'mobile@example.com', username: process.env.E2E_FIXTURE_USERNAME, vault, authKey, recoveryAuthKey }), { mode: 0o600 });
