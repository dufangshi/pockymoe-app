// Focused Electron validation. Uses only a mock ActivityHub and isolated userData.
// From desktop/: pnpm exec electron-vite build --config src/pet/tools/electron.config.ts
// node src/pet/tools/capture.mjs [--smoke] [--polish]
import { _electron as electron, expect } from '@playwright/test';
import electronPath from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
const rootEvidence = '/tmp/rc-desktop/evidence/pet/v3';
const smoke = process.argv.includes('--smoke');
const polish = process.argv.includes('--polish');
const directory = smoke ? `${rootEvidence}/smoke` : rootEvidence;
await mkdir(directory, { recursive: true });
const application = await electron.launch({ executablePath: electronPath, args: [`${rootEvidence}/harness/main/index.js`], env: { ...process.env, ELECTRON_RENDERER_URL: '' } });
const page = await application.firstWindow(), errors = [], captures = [];
page.on('pageerror', (error) => errors.push(error.message));
const packs = smoke ? ['classic'] : ['classic', 'plum-pocket', 'terminal'];
const widths = smoke ? [900] : [1440, 900];
const now = new Date().toISOString();
const base = { deviceId: 'macbook', deviceName: 'MacBook Pro', workspaceId: 'w', workspaceLabel: 'pockymoe', since: now, unread: true };
const definitions = [
  ['needsInput', '验证运行时更新与跨设备线程恢复和通知一致性', '运行 cargo test -p pockymoe-runtime', 'approval'],
  ['needsInput', '等待补充桌面端反馈', '请确认提醒方式：仅显示桌宠，或同时发送系统通知。', 'input'],
  ['failed', '检查 relay 连接恢复', '连接暂时中断，请打开线程查看'],
  ['interrupted', '整理 Windows 启动行为', '已中断，工作记录已保留'],
  ['running', '对齐原生窗口与主题', ''],
  ['running', '验证跨设备活动同步', ''],
  ['completed', '修复登录与会话恢复', '登录恢复已修复，针对性回归全部通过。'],
  ['completed', '打磨桌面端交互细节', '卡片、气泡与快速回复已对齐。'],
];
const sync = (items) => application.evaluate((_, items) => globalThis.petHarness.sync({ version: 1, accountId: 'pet-fixture-v3', generatedAt: new Date().toISOString(), focusedThreadKey: null, items }), items);
const action = (value) => page.evaluate((value) => window.rcDesktop.pet.action(value), value);
const setSettings = (patch) => application.evaluate((_, patch) => globalThis.petHarness.settings(patch), patch);
const accent = (pack, mode) => pack === 'terminal' ? mode === 'dark' ? '#4de3a2' : '#0a47c4' : pack === 'plum-pocket' ? mode === 'dark' ? '#f0b54a' : '#e8a93a' : mode === 'dark' ? '#e4b86a' : '#ad782e';
async function moveTo(x, y) {
  const local = await page.evaluate(() => { const pet = document.querySelector('#character'), root = document.querySelector('#app'); return { x: parseFloat(pet.style.left), y: parseFloat(pet.style.top), width: pet.offsetWidth, height: pet.offsetHeight, edge: root.dataset.dockEdge, amount: Number(root.dataset.dockAmount) }; });
  const bounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  const cropX = local.edge === 'left' ? -local.width * .45 * local.amount : local.edge === 'right' ? local.width * .45 * local.amount : 0;
  const cropY = local.edge === 'top' ? -local.height * .45 * local.amount : local.edge === 'bottom' ? local.height * .45 * local.amount : 0;
  const dx = x - (bounds.x + local.x - cropX), dy = y - (bounds.y + local.y - cropY);
  await action({ type: 'dragStart', x: 0, y: 0 }); await action({ type: 'dragMove', x: dx, y: dy }); await action({ type: 'dragEnd', x: dx, y: dy });
  const edge = await page.locator('#app').getAttribute('data-dock-edge');
  await expect(page.locator('#app')).toHaveAttribute('data-dock-amount', edge ? '1' : '0');
}
async function ensureTray(value) { if (!!await page.locator('.tray').count() !== value) await action({ type: 'toggleTray' }); }
async function shot(name, context) {
  await page.waitForTimeout(100);
  const overflow = await page.evaluate(() => [...document.querySelectorAll('.controls,.tray,.chat,.bubble,.more')].filter((element) => { const r = element.getBoundingClientRect(); return r.width && r.height && (r.top < -1 || r.bottom > innerHeight + 1 || r.left < -1 || r.right > innerWidth + 1); }).map((element) => element.className));
  expect(overflow, `${name}: overlay bounds`).toEqual([]);
  const raw = await page.screenshot({ path: `${directory}/${name}.png`, omitBackground: true, scale: 'css' });
  const native = await page.screenshot({ path: `${directory}/${name}@2x.png`, omitBackground: true });
  const bounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  captures.push({ name, ...context, bounds, raw, native });
}
try {
  await page.waitForFunction(() => document.querySelector('#sprite')?.style.backgroundImage.includes('data:'));
  for (const pack of packs) for (const mode of ['light', 'dark']) for (const width of widths) {
    const id = `${pack}-${mode}-${width}`, context = { pack, mode, width };
    console.log(`Capture ${id}`);
    await page.emulateMedia({ colorScheme: mode === 'light' ? 'dark' : 'light', reducedMotion: 'no-preference' });
    await application.evaluate((_, width) => globalThis.petHarness.workArea(width), width);
    await application.evaluate((_, value) => globalThis.petHarness.appearance(value), { effective: mode, pack, accent: accent(pack, mode) });
    expect(await application.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea.width)).toBe(width);
    await expect(page.locator('html')).toHaveAttribute('data-theme-effective', mode);
    await expect(page.locator('html')).toHaveAttribute('data-theme-preset', pack);
    await setSettings({ petMini: false, snoozeUntil: null });
    await action({ type: 'dismiss' });
    const items = definitions.map(([state, title, summary, kind], index) => ({ ...base, key: `${index % 2 ? 'studio' : 'macbook'}:${id}-${index}`, threadId: `${id}-${index}`, title, state, since: new Date(Date.now() - (index + 1) * 32000).toISOString(), turnId: `turn-${id}-${index}`, ...(index % 2 ? { deviceId: 'studio', deviceName: 'Windows Studio', workspaceLabel: 'desktop-app' } : {}), ...(kind ? { request: { id: `req-${id}-${index}`, kind, summary } } : { resultSummary: summary }) }));
    await sync(items); await moveTo(width - 220, 660); await ensureTray(true);
    await page.evaluate(() => { document.querySelector('.task-list').scrollTop = 0; });
    await expect(page.locator('.task')).toHaveCount(8);
    await expect(page.locator('.scroll-track')).toBeVisible();
    await expect(page.locator('.scroll-frame')).toHaveAttribute('data-overflow-bottom', 'true');
    await expect(page.locator('.tray [data-status="waiting"]')).toHaveCount(2);
    await expect(page.locator('.tray [data-status="interrupted"]')).toHaveCount(1);
    await expect(page.locator('.tray [data-status="running"] .status-mark-orbit')).toHaveCount(2);
    await shot(`${id}-tray-top`, context);
    if (polish) {
      await capturePolish(id, items, context); continue;
    }
    await page.locator('.task-list').evaluate((element) => { element.scrollTop = Math.round((element.scrollHeight - element.clientHeight) / 2); });
    await expect(page.locator('.scroll-frame')).toHaveAttribute('data-overflow-top', 'true');
    await shot(`${id}-tray-scroll`, context);
    const scrollBefore = await page.locator('.task-list').evaluate((element) => element.scrollTop), thumb = await page.locator('.scroll-thumb').boundingBox(), track = await page.locator('.scroll-track').boundingBox();
    await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2); await page.mouse.down();
    const selectedAccent = accent(pack, mode), rgb = `rgb(${parseInt(selectedAccent.slice(1, 3), 16)}, ${parseInt(selectedAccent.slice(3, 5), 16)}, ${parseInt(selectedAccent.slice(5, 7), 16)})`;
    await expect(page.locator('.scroll-thumb')).toHaveCSS('background-color', rgb);
    await page.mouse.move(thumb.x + thumb.width / 2, track.y + track.height - 8, { steps: 4 }); await page.mouse.up();
    await expect.poll(() => page.locator('.task-list').evaluate((element) => element.scrollTop)).toBeGreaterThan(scrollBefore);
    await page.locator('.scroll-track').focus(); await page.keyboard.press('End');
    await expect(page.locator('.scroll-frame')).toHaveAttribute('data-overflow-bottom', 'false');
    const lastActions = page.locator('.task').last().locator('.actions'); await expect(lastActions).toBeInViewport();
    await page.evaluate(() => document.activeElement?.blur()); await shot(`${id}-tray-bottom`, context);
    await page.locator('.scroll-track').focus(); await page.keyboard.press('Home');
    await page.locator('.task').first().getByRole('button', { name: '在地图中显示' }).click();
    await ensureTray(false);
    await application.evaluate((_, event) => globalThis.petHarness.event(event), { type: 'needsInput', item: items[0], alertId: `macbook:req-${id}-0`, at: now });
    await expect(page.locator('.bubble [data-status="waiting"]')).toBeVisible();
    await expect(page.locator('.bubble').getByRole('button', { name: '批准', exact: true })).toBeVisible();
    await expect(page.locator('.bubble').getByRole('button', { name: '拒绝', exact: true })).toBeVisible();
    await shot(`${id}-waiting`, context);
    await page.locator('.bubble').getByRole('button', { name: '在地图中显示' }).click();
    await page.locator('.bubble').getByRole('button', { name: '批准', exact: true }).click();
    await application.evaluate((_, id) => globalThis.petHarness.acknowledge(id), `macbook:req-${id}-0`);
    await expect(page.locator('.bubble')).toHaveCount(0);
    await action({ type: 'target', key: items[0].key });
    await expect(page.locator('.chat-target [data-status="waiting"]')).toBeVisible();
    await page.locator('#reply-input').fill('继续检查这项任务'); await shot(`${id}-chat`, context);
    await page.locator('#reply-input').press('Enter'); await expect(page.getByRole('status')).toHaveText('已发送');
    await action({ type: 'toggleChat' });
    await sync([]); await ensureTray(false); await moveTo(width - 220, 550);
    await setSettings({ snoozeUntil: new Date(Date.now() + 60000).toISOString() });
    await expect(page.locator('.sleep-motes path')).toHaveCount(3);
    await expect(page.locator('#character')).toHaveCSS('filter', 'none'); await expect(page.locator('#character')).toHaveCSS('opacity', '1');
    await expect(page.locator('#sprite')).toHaveCSS('background-size', /128px$/);
    await shot(`${id}-sleeping`, context);
    await setSettings({ snoozeUntil: null }); await sync(items); await ensureTray(false);
    await moveTo(0, 500); await expect(page.locator('#app')).toHaveAttribute('data-dock-edge', 'left'); await shot(`${id}-dock-left`, context);
    const petWidth = await page.locator('#character').evaluate((element) => element.offsetWidth);
    await moveTo(width - petWidth, 500); await expect(page.locator('#app')).toHaveAttribute('data-dock-edge', 'right'); await shot(`${id}-dock-right`, context);
    await moveTo(width - 220, 660); await setSettings({ petMini: true }); await expect(page.locator('#character')).toHaveCount(0); await shot(`${id}-mini`, context);
    await setSettings({ petMini: false }); await ensureTray(false);
    await page.locator('[data-action="more"]').click(); await expect(page.getByRole('menuitem').first()).toBeFocused(); await page.keyboard.press('ArrowDown'); await expect(page.getByRole('menuitem').nth(1)).toBeFocused(); await shot(`${id}-more`, context); await page.keyboard.press('Escape'); await expect(page.getByRole('menu')).toHaveCount(0); await expect(page.locator('#pet-more-trigger')).toBeFocused();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setSettings({ snoozeUntil: new Date(Date.now() + 60000).toISOString() });
    await expect(page.locator('.sleep-motes path').first()).toHaveCSS('animation-name', 'none');
    await setSettings({ snoozeUntil: null });
  }
  const commands = await application.evaluate(() => globalThis.petHarness.commands());
  const combinations = packs.length * 2 * widths.length;
  expect(commands.filter((command) => command.type === 'revealInMap')).toHaveLength(combinations * 2);
  expect(commands.filter((command) => command.type === 'resolveRequest')).toHaveLength(combinations);
  expect(commands.filter((command) => command.type === 'reply')).toHaveLength(polish ? 0 : combinations);
  expect(errors).toEqual([]);
  // Context frames show the correctly sized native overlay in each simulated work area.
  // These are labelled composites, not captures of a real account or an OS desktop.
  for (const entry of captures) {
    const frame = new PNG({ width: entry.width, height: 838 }), source = PNG.sync.read(entry.raw);
    const colour = entry.mode === 'dark' ? [22, 24, 29] : [235, 237, 241];
    expect(entry.bounds.x).toBeGreaterThanOrEqual(0); expect(entry.bounds.x + entry.bounds.width).toBeLessThanOrEqual(entry.width);
    expect(entry.bounds.y).toBeGreaterThanOrEqual(38); expect(entry.bounds.y + entry.bounds.height).toBeLessThanOrEqual(838);
    for (let i = 0; i < frame.data.length; i += 4) { for (let c = 0; c < 3; c++) frame.data[i + c] = colour[c]; frame.data[i + 3] = 255; }
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
      const a = (y * source.width + x) * 4, b = ((entry.bounds.y + y) * entry.width + entry.bounds.x + x) * 4, alpha = source.data[a + 3] / 255;
      for (let c = 0; c < 3; c++) frame.data[b + c] = source.data[a + c] * alpha + colour[c] * (1 - alpha);
    }
    await writeFile(`${directory}/${entry.name}-work-area.png`, PNG.sync.write(frame));
  }
  for (const pack of packs) for (const mode of ['light', 'dark']) for (const width of widths) {
    const entries = captures.filter((entry) => entry.pack === pack && entry.mode === mode && entry.width === width);
    const dataUrl = await page.evaluate(async ({ entries, mode }) => {
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 1120;
      const context = canvas.getContext('2d'); context.fillStyle = mode === 'dark' ? '#16181d' : '#ebedf1'; context.fillRect(0, 0, 1200, 1120);
      for (const [index, entry] of entries.entries()) {
        const image = new Image(); image.src = entry.image; await image.decode();
        const x = index % 5 * 240 + 8, y = Math.floor(index / 5) * 560 + 8, scale = Math.min(224 / image.width, 520 / image.height);
        context.font = '11px system-ui'; context.fillStyle = mode === 'dark' ? '#d9dce5' : '#555b68'; context.fillText(entry.name, x, y + 12, 224);
        context.drawImage(image, x, y + 24, image.width * scale, image.height * scale);
      }
      return canvas.toDataURL('image/png');
    }, { mode, entries: entries.map((entry) => ({ name: entry.name.replace(`${pack}-${mode}-${width}-`, ''), image: `data:image/png;base64,${entry.raw.toString('base64')}` })) });
    await writeFile(`${directory}/contact-${pack}-${mode}-${width}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
  }
  for (const mode of ['light', 'dark']) {
    const entries = captures.filter((capture) => capture.mode === mode), tileWidth = 240, tileHeight = 560, columns = 6, rows = Math.ceil(entries.length / columns);
    const sheet = new PNG({ width: columns * tileWidth, height: rows * tileHeight });
    const color = mode === 'dark' ? [22, 24, 29] : [235, 237, 241];
    for (let i = 0; i < sheet.data.length; i += 4) { for (let c = 0; c < 3; c++) sheet.data[i + c] = color[c]; sheet.data[i + 3] = 255; }
    for (const [n, entry] of entries.entries()) {
      const source = PNG.sync.read(entry.raw), scale = Math.min((tileWidth - 16) / source.width, (tileHeight - 16) / source.height);
      for (let y = 0; y < Math.floor(source.height * scale); y++) for (let x = 0; x < Math.floor(source.width * scale); x++) {
        const a = (Math.floor(y / scale) * source.width + Math.floor(x / scale)) * 4, b = ((Math.floor(n / columns) * tileHeight + 8 + y) * sheet.width + n % columns * tileWidth + 8 + x) * 4, alpha = source.data[a + 3] / 255;
        for (let c = 0; c < 3; c++) sheet.data[b + c] = source.data[a + c] * alpha + color[c] * (1 - alpha);
      }
    }
    await writeFile(`${directory}/${mode}-contact.png`, PNG.sync.write(sheet));
    await writeFile(`${directory}/${mode}-contact-index.json`, JSON.stringify(entries.map(({ name }) => name), null, 2));
  }
  await writeFile(`${directory}/capture-results.json`, JSON.stringify({ result: 'passed', screenshots: captures.length, combinations, errors, commands, captures: captures.map(({ name, pack, mode, width, bounds }) => ({ name, pack, mode, width, bounds })) }, null, 2));
  console.log(`Pet v3 passed: ${captures.length} captures across ${combinations} appearance/work-area combinations.`);
} finally { await application.close(); }

async function capturePolish(id, items, context) {
  const expectedAccent = accent(context.pack, context.mode), rgb = `rgb(${parseInt(expectedAccent.slice(1, 3), 16)}, ${parseInt(expectedAccent.slice(3, 5), 16)}, ${parseInt(expectedAccent.slice(5, 7), 16)})`;
  const first = page.locator('.task.waiting').first();
  await expect(first.locator('.request-kicker')).toHaveText('需要你批准');
  await expect(page.locator('.task.waiting').nth(1).locator('.request-kicker')).toHaveText('需要你回答');
  await expect(first.locator('.request-summary code')).toHaveText('cargo test -p pockymoe-runtime');
  await expect(first.getByRole('button', { name: '批准', exact: true })).toHaveCSS('background-color', rgb);
  const map = first.getByRole('button', { name: '在地图中显示' });
  await expect(map).toHaveAttribute('title', '在地图中显示'); await expect(map.locator('svg')).toHaveAttribute('data-icon', 'thread-map'); await expect(map.locator('svg rect')).toHaveCount(4);
  await expect(map).toHaveCSS('width', '28px'); await expect(map).toHaveCSS('height', '28px'); await expect(map.locator('svg')).toHaveCSS('width', '16px');
  await map.click(); await ensureTray(false);
  const fire = (index) => application.evaluate((_, event) => globalThis.petHarness.event(event), { type: 'needsInput', item: items[index], alertId: `${items[index].deviceId}:${items[index].request.id}`, at: new Date().toISOString() });
  const acknowledge = (index) => application.evaluate((_, id) => globalThis.petHarness.acknowledge(id), `${items[index].deviceId}:${items[index].request.id}`);
  await fire(0);
  const bubble = page.locator('.bubble');
  await expect(bubble.locator('.bubble-kicker')).toHaveText('需要你批准');
  await expect(bubble.locator('.bubble-title')).toHaveText(items[0].title);
  await expect(bubble.locator('.request-summary')).toHaveText('运行 cargo test -p pockymoe-runtime');
  await expect(bubble.locator('.request-summary code')).toHaveText('cargo test -p pockymoe-runtime');
  await expect(bubble.locator('.request-summary')).toHaveCSS('-webkit-line-clamp', '2');
  await expect(bubble.locator('.bubble-title')).toHaveCSS('text-overflow', 'ellipsis');
  await expect.poll(() => bubble.locator('.bubble-title').evaluate((element) => element.isConnected && element.clientWidth > 0 && element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(bubble.getByRole('button', { name: '批准', exact: true })).toHaveCSS('background-color', rgb);
  const actionMetrics = await page.evaluate(() => { const element = document.querySelector('.bubble'); const approve = element.querySelector('[data-action="approve"]').getBoundingClientRect(), deny = element.querySelector('[data-action="deny"]').getBoundingClientRect(), map = element.querySelector('.map-action').getBoundingClientRect(); return { gap: deny.left - approve.right, approveBottom: approve.bottom, denyBottom: deny.bottom, mapBottom: map.bottom }; });
  expect(actionMetrics.gap).toBeGreaterThanOrEqual(8); expect(actionMetrics.mapBottom).toBe(actionMetrics.approveBottom); expect(actionMetrics.denyBottom).toBe(actionMetrics.approveBottom);
  await assertTail(); await shot(`${id}-approval`, context);
  await bubble.getByRole('button', { name: '批准', exact: true }).focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  await expect(bubble.getByRole('button', { name: '批准', exact: true })).toHaveCSS('outline-style', 'solid');
  await shot(`${id}-approval-focus`, context); await page.evaluate(() => document.activeElement?.blur());
  await moveTo(0, 500); await assertTail(); await shot(`${id}-approval-left`, context);
  const petWidth = await page.locator('#character').evaluate((element) => element.offsetWidth);
  await moveTo(context.width - petWidth, 500); await assertTail(); await shot(`${id}-approval-right`, context);
  await moveTo(context.width - 220, 100); await expect(page.locator('.stack')).toHaveClass(/below/); await assertTail(); await shot(`${id}-approval-below`, context);
  await bubble.getByRole('button', { name: '批准', exact: true }).click(); await acknowledge(0); await expect(bubble).toHaveCount(0);
  await moveTo(context.width - 220, 660); await fire(1);
  await expect(bubble.locator('.bubble-kicker')).toHaveText('需要你回答'); await expect(bubble.locator('.bubble-title')).toHaveText(items[1].title);
  await expect(bubble.locator('.request-summary')).toHaveText(items[1].request.summary); await expect(bubble.getByRole('button', { name: '批准', exact: true })).toHaveCount(0);
  await assertTail(); await shot(`${id}-input`, context); await bubble.getByRole('button', { name: '在地图中显示' }).click(); await acknowledge(1);
  await ensureTray(true); await expect(page.locator('.task-list')).toBeVisible(); await page.evaluate(() => { const element = document.querySelector('.task-list'); element.scrollTop = element.scrollHeight; });
  await expect(page.locator('.scroll-frame')).toHaveAttribute('data-overflow-bottom', 'false'); await expect(page.locator('.task').last().locator('.actions')).toBeInViewport();
  await shot(`${id}-tray-bottom`, context);
}
async function assertTail() {
  const bubble = page.locator('.bubble'); await expect(bubble.locator('.bubble-frame path')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => {
    const element = document.querySelector('.bubble'); if (!element?.isConnected || !element.clientWidth) return false;
    const width = element.clientWidth, head = Number(element.dataset.headX), tail = Number(element.dataset.tailX);
    return Math.abs(tail - Math.max(20, Math.min(width - 20, head))) < .05 && getComputedStyle(element, '::after').content === 'none' && element.querySelector('.bubble-frame path').getAttribute('d').includes('L');
  })).toBe(true);
}
