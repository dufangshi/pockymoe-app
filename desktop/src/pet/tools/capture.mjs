// Run from desktop/: pnpm exec electron-vite build --config src/pet/tools/electron.config.ts
// Then node src/pet/tools/capture.mjs. Uses a mock hub and a fresh temporary userData.
import { _electron as electron, expect } from '@playwright/test';
import electronPath from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
const directory = '/tmp/rc-desktop/evidence/pet'; await mkdir(directory, { recursive: true });
const application = await electron.launch({ executablePath: electronPath, args: [`${directory}/harness/main/index.js`], env: { ...process.env, ELECTRON_RENDERER_URL: '' } });
const page = await application.firstWindow();
const errors = []; page.on('pageerror', (error) => errors.push(error.message));
const now = new Date().toISOString();
const base = { deviceId: 'macbook', deviceName: 'MacBook Pro', workspaceId: 'w', workspaceLabel: 'remoteCodex', since: now, unread: true };
const running = { ...base, key: 'macbook:login', threadId: 'login', title: '修复登录与会话恢复', state: 'running', since: new Date(Date.now() - 192000).toISOString(), turnId: 'turn-login' };
const review = { ...base, deviceId: 'windows', deviceName: 'Windows Studio', workspaceLabel: 'desktop-app', key: 'windows:desktop', threadId: 'desktop', title: '打磨桌面端交互细节', state: 'running', turnId: 'turn-desktop' };
const sync = async (items) => application.evaluate((_, items) => globalThis.petHarness.sync({ version: 1, accountId: 'pet-fixture', generatedAt: new Date().toISOString(), focusedThreadKey: null, items }), items);
const fire = async (type, item, alertId) => application.evaluate((_, event) => globalThis.petHarness.event(event), { type, item, alertId, at: new Date().toISOString() });
const action = async (value) => page.evaluate((value) => window.rcDesktop.pet.action(value), value);
const shot = async (name) => { await page.waitForTimeout(400); const overflow = await page.evaluate(() => [...document.querySelectorAll('.controls,.stack,.tray,.chat,.bubble,.more')].filter((element) => { const r = element.getBoundingClientRect(); return r.width && r.height && (r.top < -1 || r.bottom > innerHeight + 1 || r.left < -1 || r.right > innerWidth + 1); }).map((element) => element.className)); expect(overflow, name + ' overflow').toEqual([]); await page.screenshot({ path: `${directory}/${name}.png`, omitBackground: true }); };
try {
  await page.waitForSelector('#sprite'); await page.waitForFunction(() => document.querySelector('#sprite').style.backgroundImage.includes('data:'));
  for (const theme of ['light', 'dark']) {
    await application.evaluate((_, theme) => globalThis.petHarness.theme(theme), theme);
    await page.emulateMedia({ colorScheme: theme });
    expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(theme === 'dark');
    const run = { ...running, key: `macbook:login-${theme}`, threadId: `login-${theme}` };
    await sync([run, review]); if (!await page.locator('.tray').count()) await action({ type: 'toggleTray' }); await shot(`${theme}-running`);
    const attention = { ...run, state: 'needsInput', request: { id: `req-${theme}`, kind: 'approval', summary: '运行 cargo test -p runtime acp' } };
    await sync([attention, review]); await fire('needsInput', attention, `macbook:req-${theme}`); await shot(`${theme}-needs-input`);
    await application.evaluate((_, id) => globalThis.petHarness.acknowledge(id), `macbook:req-${theme}`); await expect(page.locator('.bubble')).toHaveCount(0);
    await page.getByRole('button', { name: '批准', exact: true }).click();
    const completed = { ...run, state: 'completed', durationMs: 192000, resultSummary: '登录恢复已修复，针对性回归全部通过。', request: null };
    const done2 = { ...review, state: 'completed', resultSummary: '桌面端交互打磨完成。', durationMs: 94000 };
    await sync([completed, done2]);
    // Different ids/keys each theme keep the production 30-second dedup behavior intact.
    for (let i = 0; i < 3; i++) await fire('completed', { ...completed, key: `${theme}:${i}`, threadId: `finished-${i}` }, `${theme}:done-${i}`);
    await shot(`${theme}-completed-burst`);
    await action({ type: 'target', key: completed.key }); await page.getByRole('textbox', { name: '回复', exact: true }).fill('再检查一下 Windows 的恢复路径');
    await expect(page.locator('#reply-input')).toHaveValue('再检查一下 Windows 的恢复路径'); await shot(`${theme}-chat`); await page.getByRole('textbox', { name: '回复', exact: true }).press('Enter'); await expect(page.getByRole('status')).toHaveText('已发送');
    await action({ type: 'toggleChat' });
    // Move the logical sprite anchor through the actual IPC, using work-area geometry.
    const work = await application.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
    const moveTo = async (x, y) => {
      const local = await page.evaluate(() => { const pet = document.querySelector('#character'), root = document.querySelector('#app'); return { x: parseFloat(pet.style.left), y: parseFloat(pet.style.top), width: pet.offsetWidth, height: pet.offsetHeight, edge: root.dataset.dockEdge, amount: Number(root.dataset.dockAmount) }; });
      const bounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
      const cropX = local.edge === 'left' ? -local.width * .45 * local.amount : local.edge === 'right' ? local.width * .45 * local.amount : 0;
      const cropY = local.edge === 'top' ? -local.height * .45 * local.amount : local.edge === 'bottom' ? local.height * .45 * local.amount : 0;
      const dx = x - (bounds.x + local.x - cropX), dy = y - (bounds.y + local.y - cropY);
      await action({ type: 'dragStart', x: 0, y: 0 }); await action({ type: 'dragMove', x: dx, y: dy }); await action({ type: 'dragEnd', x: dx, y: dy }); await page.waitForTimeout(330);
    };
    const spriteWidth = await page.locator('#character').evaluate((element) => element.offsetWidth);
    await moveTo(work.x + work.width - spriteWidth, work.y + work.height / 2);
    expect(await page.locator('#app').getAttribute('data-dock-edge')).toBe('right');
    await shot(`${theme}-docked`); await action({ type: 'click' }); await shot(`${theme}-peek`);
    await application.evaluate(() => globalThis.petHarness.settings({ petMini: true })); await shot(`${theme}-mini`);
    await application.evaluate(() => globalThis.petHarness.settings({ petMini: false }));
    await moveTo(work.x + work.width / 2, work.y + work.height / 2);
    await application.evaluate(() => globalThis.petHarness.settings({ snoozeUntil: new Date(Date.now() + 60000).toISOString() })); await shot(`${theme}-sleeping`);
    await application.evaluate(() => globalThis.petHarness.settings({ snoozeUntil: null }));
    if (await page.locator('.tray').count()) await action({ type: 'toggleTray' });
    await action({ type: 'dismiss' });
    await moveTo(work.x + work.width / 2, work.y + work.height / 2);
    await page.locator('[data-action="more"]').click(); await shot(`${theme}-more`);
    await page.keyboard.press('Escape');

  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await sync([running]); await action({ type: 'review', value: false });
  await page.waitForTimeout(250);
  expect(await page.locator('#sprite').evaluate((element) => element.style.backgroundPosition.split(' ')[0])).toMatch(/^0/);
  await page.mouse.move(2, 2); await expect.poll(() => application.evaluate(() => globalThis.petHarness.ignored())).toBe(true);
  const petRect = await page.locator('#character').boundingBox(); await page.mouse.move(petRect.x + petRect.width / 2, petRect.y + petRect.height * .6); await expect.poll(() => application.evaluate(() => globalThis.petHarness.ignored())).toBe(false);
  await action({ type: 'target', key: running.key }); await sync([]); await application.evaluate(() => globalThis.petHarness.failReply(true));
  await page.locator('#reply-input').fill('保留这段未发送的回复'); await page.locator('#reply-input').press('Enter');
  await expect(page.getByRole('status')).toHaveText('模拟发送失败，请重试'); await expect(page.locator('#reply-input')).toHaveValue('保留这段未发送的回复');
  await shot('dark-reply-error');
  const commands = await application.evaluate(() => globalThis.petHarness.commands());
  expect(commands.filter((command) => command.type === 'resolveRequest')).toHaveLength(2);
  expect(commands.filter((command) => command.type === 'reply')).toHaveLength(3);
  expect(errors).toEqual([]);
  await writeFile(`${directory}/capture-results.json`, JSON.stringify({ screenshots: 19, errors, commands, result: 'passed' }, null, 2));
  console.log('Pet Electron scenarios passed; 19 light/dark screenshots captured.');
} finally { await application.close(); }
