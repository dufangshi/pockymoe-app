// Packaged notification/pet integration. Isolated fixture only; no auth traces,
// raw errors, credential output or authentication screenshots are retained.
import { _electron as electron, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const executable = process.env.POCKYMOE_PACKAGED_EXECUTABLE || join(repo, 'desktop/release/mac-arm64/Pockymoe.app/Contents/MacOS/Pockymoe');
const evidence = process.env.POCKYMOE_DESKTOP_EVIDENCE || '/tmp/rc-desktop/evidence/round3/shell';
mkdirSync(evidence, { recursive: true });
let fixture;
try {
  fixture = JSON.parse(readFileSync(join(repo, '.local/e2e-desktop-env.json'), 'utf8'));
  for (const origin of [fixture.webOrigin, fixture.relayOrigin]) { const u = new URL(origin); if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.port === '45679') throw new Error(); }
} catch { throw new Error('Isolated fixture metadata unavailable'); }
const profile = mkdtempSync(join(tmpdir(), 'pockymoe-alert-qa-')), env = {};
for (const key of ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME']) if (process.env[key]) env[key] = process.env[key];
Object.assign(env, { POCKYMOE_DESKTOP_E2E: '1', POCKYMOE_DESKTOP_APNS: '0', POCKYMOE_DESKTOP_USER_DATA: profile, POCKYMOE_DESKTOP_WEB_ORIGIN: fixture.webOrigin, POCKYMOE_DESKTOP_RELAY_ORIGIN: fixture.relayOrigin });
const report = { executable, checks: [], cases: [], source: { fixtureDevices: fixture.devices.length, fixtureThreads: fixture.devices.reduce((n, device) => n + device.threads.length, 0) }, limitations: ['Idle input is simulated at powerMonitor; no OS idle setting is changed.', 'Native Notification objects are real. The notification click test emits the native object event; physical Notification Center delivery/click requires the owner.'] };
let app, web, sprite, glass, stage = 'launch', pendingKey = null;
const changed = new Map();
const save = () => writeFileSync(join(evidence, 'packaged-alerts.json'), JSON.stringify(report, null, 2));
function check(name, ok, details) { report.checks.push({ name, ok, ...(details ? { details } : {}) }); }
function control(type, device, thread) {
  const result = spawnSync(join(repo, 'scripts/e2e-desktop-backend.sh'), [type, String(device.index), thread], { stdio: 'pipe' });
  if (result.status !== 0) { report.controlFailure = { type, device: device.index, thread, status: result.status }; throw new Error('Fixture control failed'); }
}
async function sample() {
  return app.evaluate(() => {
    const r = globalThis.__pockymoeDesktopTest;
    return { events: globalThis.__alertQa.events, acknowledgements: globalThis.__alertQa.acknowledgements, commands: globalThis.__alertQa.commands,
      constructed: r.notifications.constructed, decisions: r.notifications.decisions,
      active: [...r.notifications.active.keys()], snapshots: globalThis.__alertQa.snapshots, items: r.hub.snapshot()?.items || [] };
  });
}
async function petLog() { return sprite.evaluate(() => window.__alertQa || []); }
async function petLatest() { return sprite.evaluate(() => window.__alertQa?.at(-1) || null); }
async function attachPet(page) {
  await page.evaluate(() => {
    window.__alertQa = [];
    window.rcDesktop.pet.onState(state => {
      const value = { at: Date.now(), surface: state.surface, mood: state.mood, mode: state.mode, visible: state.settings.petVisible,
        bubble: state.bubble ? { id: state.bubble.id, sticky: state.bubble.sticky, ids: state.bubble.events.map(event => event.alertId) } : null, pack: state.packName, error: state.error };
      const previous = window.__alertQa.at(-1);
      if (!previous || JSON.stringify({ ...previous, at: 0 }) !== JSON.stringify({ ...value, at: 0 })) window.__alertQa.push(value);
    }); window.rcDesktop.pet.ready();
  });
  await expect.poll(() => page.evaluate(() => window.__alertQa.length)).toBeGreaterThan(0);
  return page.evaluate(() => window.__alertQa[0].surface);
}
try {
  if (!existsSync(executable)) throw new Error('Build the packaged app first');
  app = await electron.launch({ executablePath: executable, env, timeout: 45_000 });
  report.source.asarSha256 = createHash('sha256').update(readFileSync(await app.evaluate(({ app }) => app.getAppPath()))).digest('hex');
  await expect.poll(() => app.windows().some(page => page.url().startsWith(fixture.webOrigin))).toBe(true);
  web = app.windows().find(page => page.url().startsWith(fixture.webOrigin));
  await app.evaluate(({ app, powerMonitor }) => {
    const r = globalThis.__pockymoeDesktopTest;
    globalThis.__alertQa = { events: [], acknowledgements: [], commands: [], snapshots: [], currentKey: null, idle: 0, packaged: app.isPackaged };
    powerMonitor.getSystemIdleTime = () => globalThis.__alertQa.idle;
    r.hub.onSnapshot(snapshot => { const item = snapshot.items.find(item => item.key === globalThis.__alertQa.currentKey); if (globalThis.__alertQa.currentKey) globalThis.__alertQa.snapshots.push({ at: Date.now(), accountId: snapshot.accountId, state: item?.state, unread: item?.unread, since: item?.since, turnId: item?.turnId }); });
    r.hub.onEvent(event => globalThis.__alertQa.events.push({ at: Date.now(), type: event.type, alertId: event.alertId, key: event.item.key }));
    r.hub.onAcknowledge((alertId, source) => globalThis.__alertQa.acknowledgements.push({ at: Date.now(), alertId, source }));
    const dispatch = r.windows.dispatch.bind(r.windows);
    r.windows.dispatch = (command, ...args) => { globalThis.__alertQa.commands.push({ at: Date.now(), type: command.type, key: command.key, path: command.path }); return dispatch(command, ...args); };
  });
  stage = 'sign-in';
  await web.evaluate(() => { localStorage.setItem('remote-codex.locale', 'en'); });
  await web.goto(`${fixture.webOrigin}/relay-portal?returnTo=%2F`);
  await web.getByLabel('Email or username', { exact: true }).fill(fixture.username);
  await web.getByLabel('Password', { exact: true }).fill(fixture.password);
  await web.getByRole('button', { name: 'Sign in', exact: true }).click();
  await web.locator('.thread-map[data-presentation="page"]').waitFor({ timeout: 30_000 });
  await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.focusMain());
  stage = 'pet-ready';
  await expect.poll(() => app.windows().filter(page => page.url().includes('/pet/')).length).toBe(2);
  for (const page of app.windows().filter(page => page.url().includes('/pet/'))) {
    const surface = await attachPet(page); if (surface === 'sprite') sprite = page; else glass = page;
  }
  if (!sprite || !glass) throw new Error('Both pet surfaces are required');
  await expect.poll(() => sprite.evaluate(() => window.__alertQa.at(-1)?.pack)).toBe('Moe');
  stage = 'activity-ready';
  await expect.poll(() => app.evaluate(() => !!globalThis.__pockymoeDesktopTest.hub.snapshot()), { timeout: 30_000 }).toBe(true);
  await app.evaluate(() => globalThis.__pockymoeDesktopTest.settings.set({ petVisible: true, petId: 'moe', petMini: false, petSound: false, alertMode: 'petFirst', snoozeUntil: null }));
  // Empty devices are valid. Completion metadata, not active-item membership,
  // tells us which initial device reads finished. Older pages omit this field.
  await expect.poll(() => app.evaluate((_e, deviceIds) => {
    const value = globalThis.__pockymoeDesktopTest.hub.snapshot();
    return !!value && (!value.syncedDeviceIds || deviceIds.every(id => value.syncedDeviceIds.includes(id)));
  }, fixture.devices.map(device => device.id)), { timeout: 30_000 }).toBe(true);
  report.login = await sample();
  check('packaged executable', await app.evaluate(() => globalThis.__alertQa.packaged));
  check('packaged Moe loaded without error', (await petLatest()).pack === 'Moe' && (await petLatest()).error === null);
  check('real fixture login emits no historical alerts', report.login.events.filter(event => ['needsInput', 'completed', 'failed'].includes(event.type)).length === 0);
  if (process.env.POCKYMOE_PACKAGED_QA_PHASE === 'matrix') {
    const path = join(evidence, 'packaged-alerts-history-proof.json'), proof = JSON.parse(readFileSync(path, 'utf8'));
    if (proof.source?.asarSha256 !== report.source.asarSha256 || proof.stress?.milliseconds < 60_000 ||
        !['250 historical items emit no events', '60 second historical mood stability', 'each control-bar button keeps sprite geometry fixed'].every(name => proof.checks.some(check => check.name === name && check.ok))) throw new Error('Same-artifact history proof required');
    report.phase = 'matrix with verified same-artifact history/control proof'; report.historyProof = path;
    report.stress = proof.stress; report.controls = proof.controls;
    report.checks.push(...proof.checks.filter(check => ['250 historical items emit no events', '60 second historical mood stability', 'each control-bar button keeps sprite geometry fixed'].includes(check.name)));
    await app.evaluate(() => { globalThis.__alertQa.spriteBounds = 0; });
    console.log('Reusing verified same-artifact history/control proof; running the event matrix.');
  } else {
    stage = 'historical-stress';
    // Supplemental contract stress runs in the real packaged main/pet processes.
    // It is kept distinct from the authenticated backend fixture results above.
    await app.evaluate(({ ipcMain }) => {
      const r = globalThis.__pockymoeDesktopTest, qa = globalThis.__alertQa;
      qa.savedSync = ipcMain.listeners('desktop.activity.sync'); ipcMain.removeAllListeners('desktop.activity.sync');
      qa.stressEventsAt = qa.events.length; qa.spriteBounds = 0;
      const time = new Date().toISOString(); qa.stressStart = Date.now();
      r.hub.sync({ version: 1, generatedAt: time, accountId: 'packaged-historical-stress', focusedThreadKey: null, items: [], syncedDeviceIds: ['history-9', 'history-10'] });
    });
    // Capture the sprite identity explicitly, without assuming window ordering.
    const spriteId = await (await app.browserWindow(sprite)).evaluate(window => window.webContents.id);
    await app.evaluate(({ BrowserWindow }, id) => {
      const qa = globalThis.__alertQa; qa.spriteId = id;
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.id === id);
      const set = window.setBounds.bind(window); window.setBounds = (...args) => { qa.spriteBounds++; return set(...args); };
    }, spriteId);
    await sprite.evaluate(() => { window.__stressAt = Date.now(); });
    const old = new Date(Date.now() - 3600_000).toISOString();
    const history = Array.from({ length: 250 }, (_, n) => ({ key: `history-${n % 9}:thread-${n}`, deviceId: `history-${n % 9}`, deviceName: `History ${n % 9}`, workspaceId: `workspace-${n % 21}`, workspaceLabel: `Workspace ${n % 21}`, threadId: `thread-${n}`, title: `Historical conversation ${n}`, state: n % 10 === 0 ? 'running' : n % 2 ? 'failed' : 'completed', since: old, turnId: `historical-turn-${n}`, unread: n % 10 !== 0 }));
    for (let device = 0; device < 9; device++) {
      await app.evaluate((_e, value) => globalThis.__pockymoeDesktopTest.hub.sync(value), { version: 1, generatedAt: new Date().toISOString(), accountId: 'packaged-historical-stress', focusedThreadKey: null,
        items: history.filter(item => Number(item.deviceId.split('-')[1]) <= device), syncedDeviceIds: Array.from({ length: device + 1 }, (_, n) => `history-${n}`).concat(['history-9', 'history-10']) });
    }
    console.log('Packaged app: observing 250 historical items for 60 seconds.');
    const stressStarted = Date.now();
    while (Date.now() - stressStarted < 60_000) await new Promise(done => setTimeout(done, Math.min(1000, 60_000 - (Date.now() - stressStarted))));
    const beforeStress = (await petLog()).filter(state => state.at < stressStarted).at(-1);
    const stressLog = (await petLog()).filter(state => state.at >= stressStarted), moods = [beforeStress?.mood, ...stressLog.map(state => state.mood)].filter(Boolean).filter((mood, at, all) => at === 0 || mood !== all[at - 1]);
    report.stress = { kind: 'supplemental contract snapshots in packaged app', items: 250, devices: 11, workspaces: 21, milliseconds: Date.now() - stressStarted, moods, states: stressLog,
      events: await app.evaluate(() => globalThis.__alertQa.events.slice(globalThis.__alertQa.stressEventsAt)) };
    check('250 historical items emit no events', report.stress.events.length === 0);
    check('60 second historical mood stability', moods.length <= 3 && !moods.includes('failed'), { changes: Math.max(0, moods.length - 1), moods });
    stage = 'control-bar-geometry';
    const boundsBefore = await app.evaluate(({ screen, BrowserWindow }) => {
      const qa = globalThis.__alertQa, window = BrowserWindow.getAllWindows().find(window => window.webContents.id === qa.spriteId), bounds = window.getBounds();
      qa.originalCursor = screen.getCursorScreenPoint.bind(screen); screen.getCursorScreenPoint = () => ({ x: bounds.x + Math.round(bounds.width / 2), y: bounds.y + Math.round(bounds.height / 2) });
      return qa.spriteBounds;
    });
    report.controls = [];
    for (const action of ['toggleTray', 'openMain', 'openMap', 'more']) {
      stage = `control-bar-${action}`;
      await glass.evaluate(() => window.rcDesktop.pet.action({ type: 'close' }));
      const button = glass.locator(`button[data-action="${action}"]`);
      await expect(button).toBeVisible(); await button.click();
      report.controls.push(action);
      await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.focusMain());
    }
    await glass.evaluate(() => window.rcDesktop.pet.action({ type: 'close' }));
    const boundsAfter = await app.evaluate(({ screen }) => { screen.getCursorScreenPoint = globalThis.__alertQa.originalCursor; return globalThis.__alertQa.spriteBounds; });
    check('each control-bar button keeps sprite geometry fixed', boundsBefore === boundsAfter, { before: boundsBefore, after: boundsAfter, cursor: 'simulated proximity input; rendered buttons clicked' });
    await app.evaluate(({ ipcMain }) => { for (const handler of globalThis.__alertQa.savedSync) ipcMain.on('desktop.activity.sync', handler); });
    await web.reload(); await web.locator('.thread-map[data-presentation="page"]').waitFor();
    await expect.poll(() => app.evaluate(() => globalThis.__pockymoeDesktopTest.hub.snapshot()?.accountId !== 'packaged-historical-stress')).toBe(true);
    if (report.checks.every(check => check.ok)) writeFileSync(join(evidence, 'packaged-alerts-history-proof.json'), JSON.stringify({ source: report.source, stress: report.stress, controls: report.controls, checks: report.checks }, null, 2));
  }
  stage = 'event-matrix';
  const device = fixture.devices[0], targets = device.threads.filter(thread => thread.burst).slice(-10);
  const cases = [
    { name: 'active completion', event: 'complete', type: 'completed', pet: true, system: false, reaction: 'waving' },
    { name: 'active failure', event: 'fail', type: 'failed', pet: true, system: false, reaction: 'failed' },
    { name: 'new approval, native click path', event: 'request-approval', type: 'needsInput', pet: true, system: true, reaction: 'waiting', click: 'notification' },
    { name: 'new approval, bubble click path', event: 'request-approval', type: 'needsInput', pet: true, system: true, reaction: 'waiting', click: 'bubble' },
    { name: 'idle completion', event: 'complete', type: 'completed', pet: true, system: true, reaction: 'waving', idle: 120 },
    { name: 'hidden pet failure', event: 'fail', type: 'failed', pet: false, system: true, hidden: true },
    { name: 'explicit both completion', event: 'complete', type: 'completed', pet: true, system: true, reaction: 'waving', mode: 'both' },
    { name: 'system-only failure', event: 'fail', type: 'failed', pet: false, system: true, mode: 'system' },
    { name: 'approval while main hidden', event: 'request-approval', type: 'needsInput', pet: true, system: true, reaction: 'waiting', hideMain: true, click: 'notification' }
  ];
  let executed = 0;
  for (const [index, entry] of cases.entries()) {
    if (process.env.POCKYMOE_PACKAGED_QA_CASE && process.env.POCKYMOE_PACKAGED_QA_CASE !== entry.name) continue;
    executed++;
    console.log(`Packaged event check: ${entry.name}`);
    const thread = targets[index]?.id; if (!thread) throw new Error('Fixture needs ten independent event threads');
    const key = `${device.id}:${thread}`; pendingKey = key; stage = `${entry.name}:prepare`;
    await app.evaluate((_e, key) => { globalThis.__alertQa.currentKey = key; globalThis.__alertQa.snapshots = []; }, key);
    await app.evaluate((_e, entry) => { globalThis.__alertQa.idle = entry.idle || 0; globalThis.__pockymoeDesktopTest.settings.set({ petVisible: !entry.hidden, alertMode: entry.mode || 'petFirst' }); }, entry);
    await app.evaluate(() => { void globalThis.__pockymoeDesktopTest.windows.dispatch({ type: 'openMap' }); });
    if (entry.hideMain) await app.evaluate(() => globalThis.__pockymoeDesktopTest.windows.main().close());
    if (entry.event !== 'request-approval') {
      const previous = (await sample()).items.find(item => item.key === key)?.turnId;
      stage = `${entry.name}:start-turn`; control('start-turn', device, thread); changed.set(key, { device, thread });
      stage = `${entry.name}:running-snapshot`;
      await expect.poll(async () => { const item = (await sample()).items.find(item => item.key === key); return item?.state === 'running' && item.turnId !== previous; }, { timeout: 20_000 }).toBe(true);
    } else changed.set(key, { device, thread });
    stage = `${entry.name}:trigger`; const since = Date.now(); control(entry.event, device, thread);
    stage = `${entry.name}:hub-event`;
    let event;
    await expect.poll(async () => { event = (await sample()).events.find(event => event.at >= since && event.key === key && event.type === entry.type); return !!event; }, { timeout: 20_000 }).toBe(true);
    await expect.poll(async () => (await sample()).decisions.some(decision => decision.alertId === event.alertId && decision.type === entry.type)).toBe(true);
    // Wait for the notification coalescer, and for any reaction's visible state.
    await new Promise(done => setTimeout(done, 1800));
    const native = await sample(), states = (await petLog()).filter(state => state.at >= since);
    const decision = native.decisions.find(decision => decision.alertId === event.alertId && decision.type === entry.type);
    const constructed = native.constructed.some(notice => notice.events.some(candidate => candidate.alertId === event.alertId));
    const bubble = states.some(state => state.bubble?.ids.includes(event.alertId));
    const reaction = states.some(state => state.mood === entry.reaction);
    if (entry.type !== 'needsInput') changed.delete(key);
    const result = { name: entry.name, mainHidden: entry.hideMain ? await app.evaluate(() => !globalThis.__pockymoeDesktopTest.windows.main().isVisible()) : undefined, event, expected: { pet: entry.pet, system: entry.system, reaction: entry.reaction }, decision, constructed, bubble, reaction, states, snapshots: native.snapshots };
    report.cases.push(result);
    stage = `${entry.name}:screenshots`;
    if (entry.pet) {
      report.screenshots ||= [];
      for (const [name, page] of [['sprite', sprite], ['glass', glass]]) {
        const path = join(evidence, `packaged-event-${index + 1}-${name}.png`);
        await page.screenshot({ path, omitBackground: true, animations: 'disabled' }); report.screenshots.push(path);
      }
    }

    if (entry.hideMain) check('approval arrives while main remains hidden', result.mainHidden);
    check(`${entry.name}: delivery`, decision.pet === entry.pet && decision.system === entry.system && constructed === entry.system);
    check(`${entry.name}: bubble`, bubble === entry.pet);
    if (entry.reaction) check(`${entry.name}: reaction`, reaction);
    if (entry.mode === 'system') check('system-only mode has no visible pet reaction', !states.some(state => state.mood === 'failed'));
    stage = `${entry.name}:handoff`;
    if (entry.click === 'notification') {
      const clicked = await app.evaluate((_e, id) => { const notification = globalThis.__pockymoeDesktopTest.notifications.active.get(id); if (!notification) return false; notification.emit('click'); return true; }, event.alertId);
      await expect.poll(() => web.url()).toContain(`/threads/${thread}`);
      await expect.poll(async () => !(await petLatest()).bubble?.ids.includes(event.alertId)).toBe(true);
      result.click = { source: 'native object click event', clicked, crossSurfaceDismissed: !(await sample()).active.includes(event.alertId) };
      check('notification click navigates and dismisses bubble', clicked && result.click.crossSurfaceDismissed);
    } else if (entry.click === 'bubble') {
      await expect(glass.locator(`.bubble[data-alert-id="${event.alertId}"] .bubble-title`)).toBeVisible();
      await glass.locator(`.bubble[data-alert-id="${event.alertId}"] .bubble-title`).click();
      await expect.poll(() => web.url()).toContain(`/threads/${thread}`);
      await expect.poll(async () => !(await sample()).active.includes(event.alertId)).toBe(true);
      result.click = { source: 'rendered bubble button', crossSurfaceDismissed: !(await petLatest()).bubble?.ids.includes(event.alertId) };
      check('bubble click navigates and dismisses notification', result.click.crossSurfaceDismissed);
    }
    await app.evaluate((_e, id) => globalThis.__pockymoeDesktopTest.hub.acknowledge(id, 'main'), event.alertId);
    save();
  }
  if (!executed) throw new Error('Unknown event case');
  stage = 'identity';
  await app.evaluate(() => globalThis.__pockymoeDesktopTest.settings.set({ petVisible: true, alertMode: 'petFirst' }));
  const identity = await app.evaluate(({ app }) => {
    const r = globalThis.__pockymoeDesktopTest, window = r.windows.focusMain();
    const before = app.dock?.isVisible(); window.close(); const hidden = !window.isVisible() && !window.isDestroyed();
    const afterClose = app.dock?.isVisible(); app.emit('activate');
    return { dockBefore: before, closeHides: hidden, dockAfterClose: afterClose, dockAfterReopen: app.dock?.isVisible(), focused: window.isFocused(), visible: window.isVisible() };
  });
  report.identity = { ...identity, reopenPath: 'app activation event handler' };
  check('Dock survives pet, close-to-tray and reopen', process.platform !== 'darwin' || identity.dockBefore && identity.dockAfterClose && identity.dockAfterReopen && identity.closeHides && identity.visible);
  if (process.platform === 'darwin') {
    const pid = app.process().pid;
    const info = execFileSync('/usr/bin/lsappinfo', ['info', `#${pid}`], { encoding: 'utf8' });
    report.identity.launchServices = { pid: Number(info.match(/\bpid\s*=\s*(\d+)/)?.[1]), type: info.match(/type="([^"]+)"/)?.[1], bundleId: info.match(/bundleID="([^"]+)"/)?.[1] };
    check('Launch Services reports this foreground app (Cmd-Tab eligible)', report.identity.launchServices.pid === pid && report.identity.launchServices.type === 'Foreground' && report.identity.launchServices.bundleId === 'com.pockymoe.desktop');
  }
  stage = 'evidence';
  report.eventLog = await sample(); report.petStates = await petLog();
  report.spriteBoundsChanges = await app.evaluate(() => globalThis.__alertQa.spriteBounds);
  report.result = report.checks.every(check => check.ok) ? 'passed' : 'failed'; save();
  console.log(`Packaged alert QA ${report.result}; structured evidence saved.`);
} catch {
  if (!['sign-in', 'launch'].includes(stage) && app) {
    try { const value = await sample(); report.failureState = { key: pendingKey, item: value.items.find(item => item.key === pendingKey), events: value.events.slice(-20), snapshots: value.snapshots, decisions: value.decisions.slice(-20), pet: await petLatest() }; } catch { /* Diagnostic collection must not hide the original stage. */ }
  }
  report.result = 'failed'; report.stage = stage; save(); console.error(`Packaged alert QA failed at ${stage}; authentication data is not logged.`); process.exitCode = 1;
} finally {
  // Only outstanding fixture requests/runs need settlement. Completing an
  // already terminal fixture thread would create another fake turn and alert.
  if (app) await app.evaluate(() => globalThis.__pockymoeDesktopTest.settings.set({ snoozeUntil: new Date(Date.now() + 60_000).toISOString() })).catch(() => {});
  for (const { device, thread } of changed.values()) { try { control('complete', device, thread); } catch { /* Only disposable fixture events. */ } }
  if (app) await app.close().catch(() => {});
  rmSync(profile, { recursive: true, force: true });
}
if (report.result !== 'passed') process.exitCode = 1;
