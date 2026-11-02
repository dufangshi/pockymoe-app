import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('quit cannot reopen a main window through a late activation event', async () => {
  const server = createServer((_request, response) => response.end('<!doctype html><title>Isolated quit fixture</title>'));
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture port missing');
  const profile = mkdtempSync(join(tmpdir(), 'pockymoe-quit-'));
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key]!;
  Object.assign(env, { POCKYMOE_DESKTOP_E2E: '1', POCKYMOE_DESKTOP_USER_DATA: profile, POCKYMOE_DESKTOP_WEB_ORIGIN: `http://127.0.0.1:${address.port}`, POCKYMOE_DESKTOP_RELAY_ORIGIN: `http://127.0.0.1:${address.port}` });
  const app = await electron.launch({ ...(process.env.POCKYMOE_PACKAGED_EXECUTABLE ? { executablePath: process.env.POCKYMOE_PACKAGED_EXECUTABLE, args: [] } : { args: [resolve('.')] }), env });
  const proof = join(profile, 'quit-proof.json');
  try {
    await expect.poll(() => app.evaluate(() => '__pockymoeDesktopTest' in globalThis)).toBe(true);
    await app.evaluate(({ app }, proof) => {
      const { writeFileSync } = process.getBuiltinModule('fs');
      const manager = globalThis.__pockymoeDesktopTest.windows;
      let reopening = 0;
      const createMain = manager.createMain.bind(manager);
      manager.createMain = (...args: Parameters<typeof manager.createMain>) => { reopening++; return createMain(...args); };
      for (const window of manager.relay) window.hide();
      app.once('before-quit', () => app.emit('activate', {}, false));
      app.once('will-quit', () => writeFileSync(proof, JSON.stringify({ quitting: manager.quitting, reopening })));
    }, proof);
    await app.close();
    expect(JSON.parse(readFileSync(proof, 'utf8'))).toEqual({ quitting: true, reopening: 0 });
  } finally {
    await new Promise<void>(done => server.close(() => done())); rmSync(profile, { recursive: true, force: true });
  }
});
