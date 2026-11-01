// Focused QA: command/prose distinction, page language, and recoverable action errors.
import { _electron as electron, expect } from '@playwright/test';
import electronPath from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
const localeSurfaces = process.argv.includes('--locale-surfaces');
const harnessRoot = `${(process.env.POCKYMOE_DESKTOP_EVIDENCE || '.local/desktop-evidence')}/pet/qa1`;
const evidence = localeSurfaces ? `${(process.env.POCKYMOE_DESKTOP_EVIDENCE || '.local/desktop-evidence')}/pet/locale/mock` : harnessRoot;
await mkdir(evidence, { recursive: true });
const app = await electron.launch({ executablePath: electronPath, args: [`${harnessRoot}/harness/main/index.js`], env: { ...process.env, ELECTRON_RENDERER_URL: '' } });
const page = await app.firstWindow(), errors = [], captures = [];
page.on('pageerror', (error) => { errors.push(error.message); console.error(error.stack); });
const smoke = process.argv.includes('--smoke');
const packs = smoke ? ['classic'] : ['classic', 'plum-pocket', 'terminal'];
const widths = smoke ? [900] : [1440, 900];
const action = (value) => page.evaluate((value) => window.rcDesktop.pet.action(value), value);
const failure = (type) => app.evaluate((_, type) => globalThis.petHarness.failCommand(type), type);
const appearance = (value) => app.evaluate((_, value) => globalThis.petHarness.appearance(value), value);
const accent = (pack, mode) => pack === 'terminal' ? mode === 'dark' ? '#4de3a2' : '#0a47c4' : pack === 'plum-pocket' ? mode === 'dark' ? '#f0b54a' : '#e8a93a' : mode === 'dark' ? '#e4b86a' : '#ad782e';
async function sync(accountId, item) {
  await app.evaluate((_, value) => globalThis.petHarness.sync({ version: 1, generatedAt: new Date().toISOString(), accountId: value.accountId, focusedThreadKey: null, items: [value.item] }), { accountId, item });
}
async function fire(item) {
  await app.evaluate((_, item) => globalThis.petHarness.event({ type: 'needsInput', alertId: `${item.deviceId}:${item.request.id}`, item, at: new Date().toISOString() }), item);
}
async function moveTo(x, y) {
  const local = await page.evaluate(() => { const pet = document.querySelector('#character'); return { x: parseFloat(pet.style.left), y: parseFloat(pet.style.top) }; });
  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  const dx = x - bounds.x - local.x, dy = y - bounds.y - local.y;
  await action({ type: 'dragStart', x: 0, y: 0 }); await action({ type: 'dragMove', x: dx, y: dy }); await action({ type: 'dragEnd', x: dx, y: dy });
}
async function shot(name, context) {
  await page.waitForTimeout(100);
  const overflow = await page.evaluate(() => [...document.querySelectorAll('.bubble,.chat,.error-popover,.controls')].filter((element) => { const r = element.getBoundingClientRect(); return r.width && r.height && (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1); }).map((element) => element.className));
  expect(overflow, name).toEqual([]);
  await page.screenshot({ path: `${evidence}/${name}.png`, omitBackground: true, scale: 'css' });
  const buffer = await page.screenshot({ path: `${evidence}/${name}@2x.png`, omitBackground: true });
  captures.push({ name, ...context, image: `data:image/png;base64,${buffer.toString('base64')}` });
}
async function checkOwnedLanguage(locale) {
  const generated = await page.evaluate(() => [...document.querySelectorAll('.bubble-kicker,.bubble-actions button,.chat-status,.error-popover,.error-mark,.controls button,.tray-header,.tray-header button,.group-label,.task button,.more button,.more-label')].map((element) => `${element.textContent} ${element.getAttribute('aria-label') || ''}`).join('\n'));
  if (locale === 'en') expect(generated).not.toMatch(/[\u3400-\u9fff]/);
  else expect(generated).not.toMatch(/Approval needed|Approve|Deny|Open in thread|Complete this action|Not sent/);
}
try {
  await page.waitForFunction(() => document.querySelector('#sprite')?.style.backgroundImage.includes('data:'));
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN'); // The mock OS language stays Chinese.
  for (const pack of packs) for (const mode of ['light', 'dark']) for (const width of widths) for (const locale of ['en', 'zh-CN']) {
    const id = `${pack}-${mode}-${width}-${locale}`, chinese = locale === 'zh-CN', context = { pack, mode, width, locale };
    console.log(`QA1 ${id}`);
    await page.emulateMedia({ colorScheme: mode === 'light' ? 'dark' : 'light', reducedMotion: 'reduce' });
    await app.evaluate((_, width) => globalThis.petHarness.workArea(width), width);
    const theme = { pack, effective: mode, accent: accent(pack, mode), locale };
    await appearance(theme); await expect(page.locator('html')).toHaveAttribute('lang', locale);
    const item = { key: `studio:${id}-approval`, deviceId: 'studio', deviceName: 'Studio Linux', workspaceId: 'w', workspaceLabel: 'pockymoe', threadId: `${id}-approval`, title: chinese ? '补齐消息队列重试与可观测性' : 'Queue retry and observability', state: 'needsInput', since: new Date().toISOString(), unread: true, request: { id: `request-${id}-approval`, kind: 'approval', summary: chinese ? '运行聚焦回归检查？' : 'Run the focused regression checks?' } };
    await sync(id, item); await moveTo(width - 220, 640); await fire(item);
    const bubble = page.locator('.bubble'), header = chinese ? '需要你批准' : 'Approval needed', openLabel = chinese ? '在线程中打开' : 'Open in thread';
    await expect(bubble.locator('.bubble-kicker')).toHaveText(header); await expect(bubble.locator('.request-summary code')).toHaveCount(0); await checkOwnedLanguage(locale);
    // Live changes must follow the page independently of the OS language.
    await appearance({ ...theme, locale: chinese ? 'en' : 'zh-CN' }); await expect(bubble.locator('.bubble-kicker')).toHaveText(chinese ? 'Approval needed' : '需要你批准');
    await appearance(theme); await expect(bubble.locator('.bubble-kicker')).toHaveText(header);
    if (!chinese) { await appearance({ pack, effective: mode, accent: theme.accent }); await expect(bubble.locator('.bubble-kicker')).toHaveText('Approval needed'); await expect(page.locator('html')).toHaveAttribute('lang', 'en'); await appearance(theme); }
    await shot(`${id}-waiting-prose`, context);
    if (localeSurfaces) {
      await action({ type: 'toggleTray' }); await expect(page.locator('.tray-title')).toHaveText(chinese ? '活动' : 'Activity'); await checkOwnedLanguage(locale); await shot(`${id}-tray-controls`, context);
      await page.locator('[data-action="more"]').click(); await expect(page.getByRole('menuitem', { name: chinese ? '隐藏桌宠' : 'Hide pet', exact: true })).toBeVisible(); await checkOwnedLanguage(locale); await shot(`${id}-more`, context); await page.keyboard.press('Escape');
      await action({ type: 'toggleTray' }); await action({ type: 'dismiss' }); continue;
    }
    await failure('resolveRequest'); await bubble.getByRole('button', { name: chinese ? '批准' : 'Approve', exact: true }).click();
    await expect(bubble.locator('.error-mark')).toBeVisible(); await expect(bubble).toHaveAttribute('data-alert-id', `studio:${item.request.id}`); await expect(page.locator('.error-banner')).toHaveCount(0);
    await expect(page.locator('.error-popover')).toHaveCount(0); await checkOwnedLanguage(locale); await shot(`${id}-resolve-error`, context);
    await bubble.locator('.error-mark').click(); await expect(page.locator('.error-popover')).toContainText(chinese ? '请在线程中完成此操作。' : 'Complete this action in the thread.');
    await expect(page.locator('.error-popover').getByRole('button', { name: openLabel })).toBeVisible(); await checkOwnedLanguage(locale); await shot(`${id}-resolve-reason`, context);
    await page.locator('.error-popover').getByRole('button', { name: openLabel }).click(); await expect(bubble).toHaveCount(0);
    const input = { ...item, key: `studio:${id}-input`, threadId: `${id}-input`, title: chinese ? '确认任务恢复路径' : 'Confirm the recovery path', request: { id: `request-${id}-input`, kind: 'input', summary: chinese ? '请补充预期的恢复行为。' : 'Describe the expected recovery behavior.' } };
    await sync(id, input); await fire(input); await action({ type: 'target', key: input.key }); await failure('reply');
    const draft = chinese ? '保留这段未发送的回复' : 'Keep this unsent reply'; await page.locator('#reply-input').fill(draft); await page.locator('#reply-input').press('Enter');
    await expect(page.getByRole('status')).toHaveText(chinese ? '未发送' : 'Not sent'); await expect(page.locator('#reply-input')).toHaveValue(draft); await expect(bubble).toHaveAttribute('data-alert-id', `studio:${input.request.id}`);
    await expect(page.locator('.chat .error-mark')).toBeVisible(); await checkOwnedLanguage(locale); await shot(`${id}-reply-error`, context);
    await page.locator('.chat .error-mark').click(); await expect(page.locator('.error-popover')).toContainText(chinese ? '请在线程中完成此操作。' : 'Complete this action in the thread.');
    await checkOwnedLanguage(locale); await shot(`${id}-reply-reason`, context);
    await page.locator('.error-popover').getByRole('button', { name: openLabel }).click(); await expect(bubble).toHaveCount(0); await action({ type: 'toggleChat' });
    await failure(null);
    const code = { ...item, key: `studio:${id}-code`, threadId: `${id}-code`, request: { id: `request-${id}-code`, kind: 'approval', summary: chinese ? '运行 cargo test -p pockymoe-runtime' : 'Run cargo test -p pockymoe-runtime' } };
    await sync(id, code); await fire(code); await expect(bubble.locator('.request-summary code')).toHaveText('cargo test -p pockymoe-runtime'); await checkOwnedLanguage(locale); await shot(`${id}-waiting-command`, context); await action({ type: 'dismiss' });
    const commands = await app.evaluate(() => globalThis.petHarness.commands());
    expect(commands.some((command) => command.type === 'resolveRequest' && command.threadId === item.threadId && command.requestId === item.request.id)).toBe(true);
    expect(commands.some((command) => command.type === 'reply' && command.threadId === input.threadId && command.text === draft)).toBe(true);
    expect(commands.some((command) => command.type === 'navigate' && command.path.endsWith(`/threads/${item.threadId}`))).toBe(true);
    expect(commands.some((command) => command.type === 'navigate' && command.path.endsWith(`/threads/${input.threadId}`))).toBe(true);
  }
  expect(errors).toEqual([]);
  for (const locale of ['en', 'zh-CN']) for (const mode of ['light', 'dark']) {
    const entries = captures.filter((entry) => entry.locale === locale && entry.mode === mode && entry.width === 900);
    const url = await page.evaluate(async ({ entries, mode }) => {
      const canvas = document.createElement('canvas'); canvas.width = 1440; canvas.height = Math.ceil(entries.length / 6) * 480;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = mode === 'dark' ? '#16181d' : '#ebedf1'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const [index, entry] of entries.entries()) {
        const image = new Image(); image.src = entry.image; await image.decode(); const scale = Math.min(224 / image.width, 440 / image.height), x = index % 6 * 240 + 8, y = Math.floor(index / 6) * 480 + 8;
        ctx.font = '10px system-ui'; ctx.fillStyle = mode === 'dark' ? '#d9dce5' : '#555b68'; ctx.fillText(entry.name, x, y + 12, 224); ctx.drawImage(image, x, y + 24, image.width * scale, image.height * scale);
      }
      return canvas.toDataURL();
    }, { entries, mode });
    await writeFile(`${evidence}/contact-${locale}-${mode}.png`, Buffer.from(url.split(',')[1], 'base64'));
  }
  await writeFile(`${evidence}/qa-results.json`, JSON.stringify({ result: 'passed', captures: captures.map(({ name, pack, mode, width, locale }) => ({ name, pack, mode, width, locale })), errors }, null, 2));
  console.log(localeSurfaces ? `Pet locale surfaces passed: ${captures.length} captures, no mixed app-owned language.` : `Pet QA1 passed: ${captures.length} captures, no mixed app-owned language, failed bubbles and drafts retained.`);
} finally { await app.close(); }
