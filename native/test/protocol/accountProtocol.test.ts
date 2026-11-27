// The Web's account-key interoperability vectors, run against the vendored Web code with
// the native replacements (mini IndexedDB, secure key vault, Argon2id bridge) in place.
import { beforeEach, expect, it, vi } from 'vitest';
import vectors from '@pockymoe/web/fixtures/accountKeyVectors.json';
import * as c from '@pockymoe/web/accountCrypto';
import * as vault from '@pockymoe/web/accountVaultState';
import { accountStore } from '@pockymoe/web/accountStore';
import type { BrowserCertificate, BrowserIdentity, DeviceCertificate, Revocation } from '@pockymoe/web/accountVault';
import { idb } from '../setup';

const a = vectors.account;
const v = vectors.vault.vault as vault.Vault;
beforeEach(() => { vault.closeUnlockWindow(); vi.useRealTimers(); });

it('matches all derivation, recovery and safety code vectors', async () => {
  const d = vectors.derivation;
  expect(c.encode64(await c.hkdf(c.decode64(d.master), 'pockymoe-relay-auth-v1'))).toBe(d.authKey);
  expect(c.encode64(await c.hkdf(c.decode64(d.master), 'pockymoe-vault-wrap-v1'))).toBe(d.wrapKey);
  expect(c.encode64(c.parseRecovery(d.recoveryCodeDisplay))).toBe(d.recoveryCodeBytes);
  expect(c.recoveryDisplay(c.parseRecovery(d.recoveryCode))).toBe(d.recoveryCodeDisplay);
  const keys = await c.recoveryKeys(d.recoveryCode);
  expect(c.encode64(keys.recoveryKey)).toBe(d.recoveryKey); expect(keys.recoveryAuthKey).toBe(d.recoveryAuthKey);
  expect(await vault.safetyCode(vectors.safetyCode.accountKeyId)).toBe(vectors.safetyCode.display);
});
it('verifies browser/device certificates and both revocation vectors', async () => {
  const b = vectors.browserCertificate.certificate as BrowserCertificate, d = vectors.deviceCertificate.certificate as DeviceCertificate;
  expect(c.inputs.browser(b)).toBe(vectors.browserCertificate.signingInput);
  expect(await c.verifyBrowserCertificate(b, a)).toBe(true);
  expect(await vault.verifyDeviceCertificate(d, a, d.deviceId, d.identityKey)).toBe(true);
  for (const entry of Object.values(vectors.revocations)) expect(await c.verifyRevocation(entry as Revocation, a)).toBe(true);
});
it('opens fixed password and recovery slots and validates the account private key', async () => {
  for (const [slot, key] of [['password', vectors.derivation.wrapKey], ['recovery', vectors.derivation.recoveryKey]] as const) {
    const result = await vault.decryptVault(v, c.decode64(key), slot, a.userId);
    expect(c.encode64(result.vdk)).toBe(vectors.vault.vdk);
    expect(result.key.extractable).toBe(false);
  }
});
it('matches enrollment MAC and request signatures', async () => {
  const d = vectors.deviceCertificate.certificate;
  expect(await c.enrollmentMac(vectors.enrollment.enrollSecret, d.deviceId, d.identityKey, a.accountKeyId)).toBe(vectors.enrollment.mac);
  const r = vectors.requestSignature;
  expect(await c.requestSigningInput(r.aad, c.decode64(r.sealed))).toBe(r.signingInput);
  const signature = await c.signRequest(await c.importPrivate(vectors.browserCertificate.browserPrivateKeyPkcs8), r.aad, c.decode64(r.sealed));
  expect(await c.verify(vectors.browserCertificate.certificate.publicKey, signature, r.signingInput)).toBe(true);
});
it('rejects every negative interoperability vector', async () => {
  const n = vectors.negative, d = vectors.deviceCertificate.certificate;
  for (const cert of [n.browserCertSignedByOtherAccount, n.browserCertWrongBrowserId, n.browserCertTamperedCreatedAt])
    expect(await c.verifyBrowserCertificate(cert as BrowserCertificate, a)).toBe(false);
  for (const cert of [n.deviceCertWrongDevice, n.deviceCertWrongIdentity])
    expect(await vault.verifyDeviceCertificate(cert as DeviceCertificate, a, d.deviceId, d.identityKey)).toBe(false);
  expect(await c.verifyRevocation(n.revocationWrongKind as Revocation, a)).toBe(false);
  await expect(c.open(c.decode64(vectors.vault.vdk), v.body, n.vaultBodyWrongRevisionAad)).rejects.toThrow();
});
it('creates a vault through the Argon2id bridge and opens it with the same password', async () => {
  const created = await vault.createVault('native-user', 'correct horse battery staple');
  const data = await vault.decryptVault(created.vault, (await c.passwordKeys('correct horse battery staple', created.vault.kdf)).wrapKey, 'password', 'native-user');
  expect(data.body.boundDevices).toEqual([]);
  await expect(vault.decryptVault(created.vault, (await c.passwordKeys('wrong horse battery staple', created.vault.kdf)).wrapKey, 'password', 'native-user')).rejects.toMatchObject({ code: 'accountUnlockFailed' });
  expect(c.encode64(await c.deriveMaster('café-password', v.kdf))).toBe(c.encode64(await c.deriveMaster('café-password', v.kdf)));
});
it('refuses rollback and an account key replacement', async () => {
  const decrypted = await vault.decryptVault(v, c.decode64(vectors.derivation.wrapKey), 'password', a.userId);
  await vault.installUnlockedVault(v, decrypted);
  await expect(vault.checkVault({ ...v, revision: v.revision - 1 }, a.userId)).rejects.toMatchObject({ code: 'accountVaultRollback' });
  await expect(vault.checkVault({ ...v, ...vectors.otherAccount }, a.userId)).rejects.toMatchObject({ code: 'accountKeyChanged' });
});
it('keeps a non-extractable browser key across a restart, in the secure store only', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const identity = { userId: 'u', accountKeyId: 'k', accountPublicKey: 'p', browserId: 'b', certificate: { version: 1 }, privateKey: pair.privateKey } as unknown as BrowserIdentity;
  await accountStore('browser:u', identity);
  const rows = [...idb.dbs.get('pockymoe-account-v2')!.stores.get('account')!.rows.values()].join('\n');
  expect(rows).not.toMatch(/MIG/); // no PKCS#8 material in the database rows
  expect(idb.secrets.size).toBe(1);
  idb.reload();
  const loaded = await accountStore<BrowserIdentity>('browser:u');
  expect(loaded!.privateKey.extractable).toBe(false);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, loaded!.privateKey, new TextEncoder().encode('x'));
  expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, signature, new TextEncoder().encode('x'))).toBe(true);
  await accountStore('browser:u', null);
  expect(idb.secrets.size).toBe(0);
});
