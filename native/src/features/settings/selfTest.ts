// On-device protocol check: the Web's interop vectors through the vendored code on the
// native crypto, the RFC 9106 Argon2id vector, and timings. Settings → About runs it.
import vectors from '@pockymoe/web/fixtures/accountKeyVectors.json';
import * as c from '@pockymoe/web/accountCrypto';
import { decryptVault, type Vault } from '@pockymoe/web/accountVaultState';
import type { BrowserCertificate, DeviceCertificate } from '@pockymoe/web/accountVault';
import { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from '@hpke/core';
import { argon2idNative } from '../../platform/native/argon2';

const hex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
export async function runSelfTest(): Promise<string[]> {
  const out: string[] = [];
  const time = async <T,>(label: string, run: () => Promise<T>, check: (v: T) => boolean) => {
    const start = performance.now();
    try { const v = await run(); out.push(`${check(v) ? 'ok' : 'FAIL'} ${label} ${Math.round(performance.now() - start)} ms`); }
    catch (e) { out.push(`FAIL ${label}: ${String((e as Error)?.message ?? e)}`); }
  };
  const d = vectors.derivation, a = vectors.account;
  await time('hkdf', async () => c.encode64(await c.hkdf(c.decode64(d.master), 'pockymoe-vault-wrap-v1')), v => v === d.wrapKey);
  await time('vault', async () => c.encode64((await decryptVault(vectors.vault.vault as Vault, c.decode64(d.wrapKey), 'password', a.userId)).vdk), v => v === vectors.vault.vdk);
  await time('certs', async () => await c.verifyBrowserCertificate(vectors.browserCertificate.certificate as BrowserCertificate, a)
    && (vectors.deviceCertificate.certificate as DeviceCertificate).deviceId.length > 0, v => v);
  await time('hmac', async () => c.enrollmentMac(vectors.enrollment.enrollSecret, vectors.deviceCertificate.certificate.deviceId, vectors.deviceCertificate.certificate.identityKey, a.accountKeyId), v => v === vectors.enrollment.mac);
  await time('hpke', async () => {
    const suite = new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });
    const pair = await suite.kem.generateKeyPair();
    const sender = await suite.createSenderContext({ recipientPublicKey: pair.publicKey, info: new TextEncoder().encode('remote-codex/relay/v1') });
    const sealed = await sender.seal(new TextEncoder().encode('ping').buffer as ArrayBuffer);
    const recipient = await suite.createRecipientContext({ recipientKey: pair.privateKey, enc: sender.enc, info: new TextEncoder().encode('remote-codex/relay/v1') });
    return new TextDecoder().decode(await recipient.open(sealed));
  }, v => v === 'ping');
  // RFC 9106 §5.3 Argon2id test vector.
  await time('argon2id rfc9106', async () => hex(await argon2idNative({ password: new Uint8Array(32).fill(1), salt: new Uint8Array(16).fill(2), secret: new Uint8Array(8).fill(3),
    associatedData: new Uint8Array(12).fill(4), memoryKiB: 32, iterations: 3, parallelism: 4, length: 32 })), v => v === '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659');
  await time('argon2id 64MiB×3', async () => (await c.deriveMaster('correct horse battery staple', vectors.vault.vault.kdf as c.Kdf)).length, v => v === 32);
  return out;
}
