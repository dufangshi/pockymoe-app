// Real Chromium + real cross-origin account/transport paths. Never record secrets.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
const [command, stateFile] = process.argv.slice(2);
const state = JSON.parse(await readFile(stateFile, 'utf8'));
const require = createRequire(join(state.webRoot, 'package.json'));
const { chromium, expect } = require('@playwright/test');
const evidence = `${(process.env.POCKYMOE_DESKTOP_EVIDENCE || '.local/desktop-evidence')}/fixture` + (state.webMode === 'dev' ? '/dev' : '');
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
await context.grantPermissions(['local-network-access'], { origin: state.webOrigin });
await context.addInitScript(() => {
  localStorage.setItem('remote-codex.locale', 'en');
  localStorage.setItem('remote-codex-theme-mode', 'light');
});
const page = await context.newPage();
let stage = 'open static web';
const safeRequests = [];
page.on('response', response => {
  const url = new URL(response.url());
  if (url.origin === state.relayOrigin && url.pathname.startsWith('/relay/devices/'))
    safeRequests.push({ path: url.pathname, status: response.status(), encrypted: response.headers()['x-rcd-encrypted'] === '1' });
});
async function privateJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}
try {
  await page.goto(state.webOrigin + '/relay-portal?returnTo=%2Frelay-account');
  if (command === 'bootstrap') {
    stage = 'register account';
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    stage = 'fill registration';
    await page.getByLabel('Email', { exact: true }).fill('desktop@example.test');
    await page.getByLabel('Username', { exact: true }).fill(state.testAccount.username);
    await page.getByLabel('Password', { exact: true }).fill(state.testAccount.password);
    await page.getByLabel('Confirm password', { exact: true }).fill(state.testAccount.password);
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/relay/auth/register' && r.request().method() === 'POST');
    stage = 'submit registration';
    await page.locator('form button[type="submit"]').click();
    const registered = await response;
    if (!registered.ok()) throw new Error('Registration rejected');
    const auth = await registered.json();
    stage = 'confirm recovery code';
    const group = page.getByRole('group', { name: 'Save your recovery code', exact: true });
    await expect(group).toBeVisible();
    const suffix = await group.evaluate(element => [...element.querySelectorAll('span')].map(span => span.textContent?.trim()).join('-').slice(-4));
    await page.getByLabel('Type the last 4 characters to confirm', { exact: true }).fill(suffix);
    await page.getByRole('button', { name: /I.ve saved it/ }).click();
    await expect(page.getByRole('heading', { name: 'Security', exact: true })).toBeVisible();
    await privateJson(join(state.dataDir, 'account.json'), { token: auth.token, accountId: auth.session?.user?.id ?? auth.user?.id ?? auth.account?.id });
    console.log('Disposable account registered through the separate static web origin.');
  } else if (command === 'verify') {
    stage = 'sign in';
    await page.getByLabel('Email or username', { exact: true }).fill(state.testAccount.username);
    await page.getByLabel('Password', { exact: true }).fill(state.testAccount.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Security', exact: true })).toBeVisible();
    stage = 'open thread map';
    const device = state.devices[0];
    const tid = device.scenarios.events;
    await page.goto(`${state.webOrigin}/devices/${device.id}/threads/${tid}`);
    const openMap = async () => {
      const map = page.locator('.thread-map-canvas');
      if (!await map.isVisible()) await page.getByRole('button', { name: 'Thread map', exact: true }).first().click();
      await expect(map).toBeVisible();
    };
    await openMap();
    for (const device of state.devices) {
      await expect(page.locator('.thread-map-section[data-kind="device"]').filter({ hasText: device.name })).toBeVisible();
    }
    await expect.poll(() => page.locator('.thread-map-tile[data-heat]:not([data-heat="0"])').count(), { timeout: 15000 }).toBeGreaterThan(0);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const layout = await page.locator('.thread-map-section[data-kind="device"]').evaluateAll(elements => elements.map(element => {
      const r = element.getBoundingClientRect(), style = getComputedStyle(element);
      const head = element.querySelector('.thread-map-section-head');
      return { label: element.getAttribute('aria-label'), x: r.x, y: r.y, width: r.width, height: r.height,
        opacity: style.opacity, transform: style.transform, head: head?.textContent, headOpacity: head ? getComputedStyle(head).opacity : null };
    }));
    await privateJson(join(evidence, 'map-layout.json'), layout);
    await page.screenshot({ path: join(evidence, 'static-map-classic-light-1440.png') });
    // Close the map with its normal dialog close action and observe controls in
    // the selected conversation. No HTTP/WS requests are mocked or intercepted.
    await page.keyboard.press('Escape');
    stage = 'live events';
    const run = async (action, text) => {
      const type = { 'start-turn': 'start', complete: 'complete', fail: 'fail', 'request-approval': 'approval', 'request-input': 'input' }[action];
      const response = await fetch(`${state.relayOrigin}/relay/devices/${device.id}/api/e2e/events`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${state.accountToken}` },
        body: JSON.stringify({ type, threadId: tid, ...(text ? { text } : {}) }),
      });
      if (!response.ok) throw new Error('Fixture event rejected');
    };
    const observations = [];
    await run('start-turn');
    await expect(page.getByRole('button', { name: /Stop/i }).first()).toBeVisible();
    observations.push('start: visible stop control');
    const completed = `Desktop fixture result ${Date.now()}`;
    await run('complete', completed);
    await expect(page.getByText(completed, { exact: true })).toBeVisible();
    observations.push('complete: visible assistant result');
    await run('fail');
    await expect(page.locator(`a[href$="/threads/${tid}"] [data-status="failed"]`).first()).toBeVisible();
    observations.push('fail: visible failure status mark');
    await run('request-approval');
    await expect(page.getByText('Run the focused regression checks?', { exact: false }).first()).toBeVisible();
    observations.push('approval: visible pending request');
    await run('request-input');
    await expect(page.getByText('Which rollout environment', { exact: false }).first()).toBeVisible();
    observations.push('input: visible pending question');
    await run('complete');
    stage = 'verify encrypted cross-origin traffic';
    if (!safeRequests.some(r => r.encrypted && r.status === 200)) throw new Error('No encrypted device response observed');
    const report = { webOrigin: state.webOrigin, relayOrigin: state.relayOrigin, project: 'desktop-chromium',
      realSignIn: true, devicesOnMap: state.devices.map(d => d.name), eventsObservedInPage: observations,
      encryptedDeviceResponses: safeRequests.filter(r => r.encrypted && r.status === 200).length };
    await privateJson(join(evidence, 'browser-verification.json'), report);
    console.log(JSON.stringify(report, null, 2));
  } else throw new Error('Unknown browser command');
} catch {
  // Playwright diagnostics may contain form values, URLs or recovery codes.
  // Retain only the stage and a screenshot with every sensitive field masked.
  await privateJson(join(evidence, 'browser-failure.json'), { command, stage });
  await page.screenshot({ path: join(evidence, 'browser-failure.png'), mask: [page.locator('input'), page.locator('pre'), page.locator('code'), page.getByRole('group', { name: 'Save your recovery code' })] }).catch(() => {});
  console.error(`Browser ${command} failed at: ${stage}. Safe evidence: ${evidence}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
