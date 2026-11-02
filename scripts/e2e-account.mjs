// Isolated fixture only. Secrets are written to the caller's private file, never stdout.
import { createRequire } from 'node:module';
import { webcrypto as crypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const require = createRequire(process.env.E2E_WEB_PACKAGE);
const { argon2id } = require('hash-wasm');
const [output, username, password] = process.argv.slice(2);
const b64 = value => Buffer.from(value).toString('base64url');
const random = n => crypto.getRandomValues(new Uint8Array(n));
const enc = value => new TextEncoder().encode(value);
const hkdf = async (key, info) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: enc(info) }, await crypto.subtle.importKey('raw', key, 'HKDF', false, ['deriveBits']), 256));
const seal = async (key, value, aad) => {
  const iv = random(12);
  return { iv: b64(iv), ciphertext: b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc(aad) }, await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']), value)) };
};
const userId = crypto.randomUUID();
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = await crypto.subtle.exportKey('spki', pair.publicKey);
const accountKeyId = b64(await crypto.subtle.digest('SHA-256', pub));
const salt = random(16);
const master = await argon2id({ password, salt, memorySize: 65536, iterations: 3, parallelism: 1, hashLength: 32, outputType: 'binary' });
const authKey = b64(await hkdf(master, 'pockymoe-relay-auth-v1'));
const wrap = await hkdf(master, 'pockymoe-vault-wrap-v1');
const recovery = random(32), vdk = random(32);
const vault = { version: 1, userId, accountPublicKey: b64(pub), accountKeyId, revision: 1,
  kdf: { name: 'argon2id', salt: b64(salt), memoryKiB: 65536, iterations: 3, parallelism: 1 },
  slots: { password: await seal(wrap, vdk, `pockymoe-vault-slot-v1\n${userId}\n${accountKeyId}\npassword`), recovery: await seal(recovery, vdk, `pockymoe-vault-slot-v1\n${userId}\n${accountKeyId}\nrecovery`) },
  body: await seal(vdk, enc(JSON.stringify({ version: 1, accountPrivateKey: b64(await crypto.subtle.exportKey('pkcs8', pair.privateKey)), boundDevices: [], updatedAt: Date.now() })), `pockymoe-vault-body-v1\n${userId}\n${accountKeyId}\n1`) };
writeFileSync(output, JSON.stringify({ username, email: `${username}@example.test`, userId, authKey, recoveryAuthKey: b64(random(32)), vault }), { mode: 0o600 });
