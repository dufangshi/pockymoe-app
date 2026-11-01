import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, screen } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { Appearance, HostCommand, HostCommandResult, PetController, PetControllerDeps } from '../shared/contract';
import { ANIMATIONS, moodFor, type SpriteState } from './animation';
import { BubbleQueue } from './bubbles';
import { dockPosition, PET_HEIGHT, petLayout, restorePosition, type PetPosition } from './geometry';
import { importPetPack as importPack, listPetPacks, imageDimensions, type PetPack } from './packs';
import type { PetAction, PetViewState } from './bridge';

type Command = HostCommand extends infer C ? C extends { id: string } ? Omit<C, 'id'> : never : never;
export function createPetController(deps: PetControllerDeps): PetController {
  const userPets = join(app.getPath('userData'), 'pets');
  const positionFile = join(app.getPath('userData'), 'pet-positions.json');
  let positions: Record<string, PetPosition> = {};
  try { const stored: unknown = JSON.parse(readFileSync(positionFile, 'utf8')); if (stored && typeof stored === 'object' && !Array.isArray(stored)) positions = stored as Record<string, PetPosition>; } catch { /* First launch. */ }
  let settings = deps.settings.get(), items = deps.hub.snapshot()?.items ?? [];
  let appearance: Appearance = deps.appearance() ?? { effective: nativeTheme.shouldUseDarkColors ? 'dark' : 'light', pack: 'classic', accent: '#ad782e' };
  let packs: PetPack[] = [], pack: PetPack | undefined, error: string | null = null;
  let disposed = false, visible = settings.petVisible, tray = settings.petMini, chat = false, peek = false, reviewing = false;
  let menuOpen = false, reducedMotion = false, dockAmount = 0;
  let dockTimer: ReturnType<typeof setInterval> | null = null;
  let completion: 'waving' | 'jumping' | null = null, completionUntil = 0, lastCompletedAt = 0, targetKey: string | null = null;
  let drag: { x: number; y: number; origin: PetPosition; moved: boolean; previousX: number } | null = null;
  let dragMood: SpriteState | null = null, interactive = false, lastPayload = '';
  const bubbles = new BubbleQueue();
  const recentTargets = new Map<string, (typeof items)[number]>();
  let accountId = deps.hub.snapshot()?.accountId ?? null;
  let measured = { tray: 0, bubble: 0, chat: 0 };
  const primary = screen.getPrimaryDisplay();
  let position = restorePosition(positions[String(primary.id)], screen.getAllDisplays(), primary, PET_HEIGHT[settings.petSize]);
  dockAmount = position.edge ? 1 : 0;
  const window = new BrowserWindow({ width: 352, height: 252, show: false, transparent: true, frame: false,
    focusable: false, hasShadow: false, skipTaskbar: true, resizable: false, maximizable: false, minimizable: false,
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    webPreferences: { preload: join(__dirname, '../preload/pet.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  });
  window.setAlwaysOnTop(true, 'floating');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setIgnoreMouseEvents(true, { forward: true });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
    !disposed && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
  const dispatch = async (command: Command): Promise<HostCommandResult> => {
    try { return await deps.dispatch(command); } catch { return { ok: false, error: app.getLocale().startsWith('zh') ? '主窗口暂时无法连接，请稍后重试。' : 'The main window is unavailable. Try again.' }; }
  };
  function savePosition(): void {
    positions[String(position.displayId)] = position;
    try { mkdirSync(app.getPath('userData'), { recursive: true }); writeFileSync(positionFile, JSON.stringify(positions)); }
    catch { error = 'Could not save the pet position.'; }
  }
  function emit(): void {
    if (disposed || window.isDestroyed()) return;
    window.setFocusable(chat || menuOpen);
    const now = Date.now();
    bubbles.tick(now);
    if (completionUntil <= now) completion = null;
    const snoozed = !!settings.snoozeUntil && Date.parse(settings.snoozeUntil) > now;
    const display = screen.getAllDisplays().find((candidate) => candidate.id === position.displayId) ?? screen.getPrimaryDisplay();
    const layout = petLayout(position, display.workArea, PET_HEIGHT[settings.petSize], {
      panel: tray, bubble: !snoozed && !!bubbles.current, chat, mini: settings.petMini, peek, measured, menu: menuOpen, dockAmount,
    });
    if (!drag) {
      const bounds = window.getBounds();
      if (Object.keys(layout.window).some((key) => bounds[key as keyof typeof bounds] !== layout.window[key as keyof typeof layout.window])) window.setBounds(layout.window);
    }
    const state: PetViewState = { appearance, items, targets: [...new Map([...items, ...recentTargets.values()].map((item) => [item.key, item])).values()], mood: dragMood ?? moodFor(items, { snoozed, completion, reviewing }),
      bubble: snoozed ? null : bubbles.current, settings: { petSize: settings.petSize, petMini: settings.petMini, petSound: settings.petSound, petId: settings.petId },
      imageUrl: pack ? `data:image/${pack.manifest.spritesheetPath.endsWith('png') ? 'png' : 'webp'};base64,${pack.image.toString('base64')}` : '',
      ...(pack?.sleepingImage && pack.manifest.remoteCodex ? { sleeping: { imageUrl: `data:image/${pack.manifest.remoteCodex.sleeping.path.endsWith('png') ? 'png' : 'webp'};base64,${pack.sleepingImage.toString('base64')}`, frames: pack.manifest.remoteCodex.sleeping.frames, durationsMs: pack.manifest.remoteCodex.sleeping.durationsMs } } : {}),
      packName: pack?.manifest.displayName ?? '', packs: packs.map(({ manifest }) => ({ id: manifest.id, displayName: manifest.displayName })), error, locale: app.getLocale(),
      tray, chat, peek, edge: position.edge, dockAmount, pet: layout.pet, panelAbove: layout.panelAbove, panelHeight: layout.panelHeight, targetKey };
    const payload = JSON.stringify(state);
    if (payload !== lastPayload) { lastPayload = payload; window.webContents.send('rcDesktop:pet:state', state); }
  }
  function animateDock(target: number): void {
    if (dockTimer) clearInterval(dockTimer);
    const from = dockAmount, started = Date.now();
    if (reducedMotion) { dockAmount = target; emit(); return; }
    dockTimer = setInterval(() => {
      const progress = Math.min(1, (Date.now() - started) / 300);
      dockAmount = from + (target - from) * (1 - (1 - progress) ** 3);
      if (progress === 1 && dockTimer) { clearInterval(dockTimer); dockTimer = null; }
      emit();
    }, 16);
  }
  async function refreshPacks(): Promise<void> {
    const candidates = await listPetPacks([...deps.petDirectories, userPets]);
    const valid = await Promise.all(candidates.map(async (candidate) => {
      if (app.isPackaged && candidate.manifest.id === 'placeholder') return false;
      return decodeImage(window, candidate.image);
    }));
    packs = candidates.filter((_, index) => valid[index]);
    if (disposed) return;
    pack = packs.find((candidate) => candidate.manifest.id === settings.petId) ?? packs.find((candidate) => candidate.manifest.id === 'moe') ?? packs.find((candidate) => candidate.manifest.id === 'placeholder') ?? packs[0];
    error = pack ? null : 'No valid Codex v1 pet pack is installed.';
    emit();
  }
  function acknowledgeKey(key: string): void {
    const item = items.find((candidate) => candidate.key === key);
    const ids = bubbles.pending.flatMap((bubble) => bubble.events.filter((event) => event.item.key === key).map((event) => event.alertId));
    if (item) ids.push(`${item.deviceId}:${item.request?.id ?? item.turnId ?? item.threadId}`);
    for (const id of new Set(ids)) deps.hub.acknowledge(id, 'pet');
  }
  async function action(value: unknown): Promise<HostCommandResult> {
    if (!value || typeof value !== 'object' || typeof (value as PetAction).type !== 'string') return { ok: false, error: 'Invalid pet action' };
    const action = value as PetAction;
    const item = 'key' in action && typeof action.key === 'string' ? items.find((candidate) => candidate.key === action.key) ?? recentTargets.get(action.key) : undefined;
    if (['open', 'approve', 'deny', 'reply', 'target', 'revealInMap'].includes(action.type) && !item) return { ok: false, error: app.getLocale().startsWith('zh') ? '线程已不在活动列表中。' : 'This thread is no longer active.' };
    switch (action.type) {
      case 'open': {
        if (!item) break;
        const result = await dispatch({ type: 'navigate', path: `/devices/${encodeURIComponent(item.deviceId)}/threads/${encodeURIComponent(item.threadId)}` });
        if (result.ok) { acknowledgeKey(item.key); await dispatch({ type: 'markRead', key: item.key }); }
        return result;
      }
      case 'revealInMap': if (!item) break; return dispatch({ type: 'revealInMap', key: item.key });
      case 'approve': case 'deny':
        if (!item?.request || item.request.kind !== 'approval' || !items.some((candidate) => candidate.key === item.key && candidate.request?.id === item.request?.id)) return { ok: false, error: 'This request is no longer awaiting approval.' };
        return dispatch({ type: 'resolveRequest', deviceId: item.deviceId, threadId: item.threadId, requestId: item.request.id, decision: action.type });
      case 'reply':
        if (!item || typeof action.text !== 'string' || !action.text.trim() || action.text.length > 16000) return { ok: false, error: 'Please enter a reply (maximum 16000 characters).' };
        return dispatch({ type: 'reply', deviceId: item.deviceId, threadId: item.threadId, text: action.text.trim() });
      case 'target': if (!item) break; recentTargets.set(item.key, item); targetKey = item.key; chat = true; window.setFocusable(true); window.focus(); break;
      case 'dismiss': for (const event of [...(bubbles.current?.events ?? [])]) deps.hub.acknowledge(event.alertId, 'pet'); break;
      case 'toggleTray': tray = !tray; peek = tray; if (position.edge) animateDock(peek ? 0 : 1); break;
      case 'toggleChat': chat = !chat; if (chat) { window.setFocusable(true); window.focus(); } if (!targetKey) targetKey = items[0]?.key ?? null; break;
      case 'click':
        if (position.edge) { peek = !peek; tray = peek; animateDock(peek ? 0 : 1); }
        else { tray = !tray; completion = 'jumping'; completionUntil = Date.now() + 840; }
        break;
      case 'openMain': return dispatch({ type: 'navigate', path: '/' });
      case 'preferences': return dispatch({ type: 'navigate', path: '/settings' });
      case 'setMini': if (typeof action.value !== 'boolean') break; deps.settings.set({ petMini: action.value }); tray = action.value; break;
      case 'setSound': if (typeof action.value !== 'boolean') break; deps.settings.set({ petSound: action.value }); break;
      case 'setVisible': if (typeof action.value !== 'boolean') break; deps.settings.set({ petVisible: action.value }); break;
      case 'setSize': if (!['S', 'M', 'L'].includes(action.size)) break; deps.settings.set({ petSize: action.size }); position = dockPosition(position, screen.getDisplayMatching({ x: Math.round(position.x), y: Math.round(position.y), width: 1, height: 1 }).workArea, PET_HEIGHT[action.size]); break;
      case 'setPack': if (!packs.some((candidate) => candidate.manifest.id === action.id)) break; deps.settings.set({ petId: action.id }); break;
      case 'review': reviewing = action.value === true; break;
      case 'menu': menuOpen = action.value === true; if (menuOpen) { window.setFocusable(true); window.focus(); } break;
      case 'reducedMotion': reducedMotion = action.value === true; break;
      case 'measure':
        if (![action.tray, action.bubble, action.chat].every((value) => Number.isFinite(value) && value >= 0 && value <= 10000)) break;
        measured = { tray: Math.min(action.tray, 414), bubble: Math.min(action.bubble, 280), chat: Math.min(action.chat, 140) }; break;
      case 'importFolder': case 'importZip': {
        const chosen = await dialog.showOpenDialog({ title: 'Import Codex pet', properties: [action.type === 'importFolder' ? 'openDirectory' : 'openFile'], ...(action.type === 'importZip' ? { filters: [{ name: 'Codex pet pack', extensions: ['zip'] }] } : {}) });
        if (!chosen.canceled && chosen.filePaths[0]) {
          try {
            const imported = await importPack(chosen.filePaths[0], userPets, (bytes) => decodeImage(window, bytes), packs.map((pack) => pack.manifest.id));
            await refreshPacks(); deps.settings.set({ petId: imported.manifest.id });
          } catch (cause) { error = cause instanceof Error ? cause.message : 'Pet import failed'; emit(); return { ok: false, error }; }
        }
        break;
      }
      case 'dragStart': case 'dragMove': case 'dragEnd': {
        if (!Number.isFinite(action.x) || !Number.isFinite(action.y) || Math.abs(action.x) > 100000 || Math.abs(action.y) > 100000) break;
        if (action.type === 'dragStart') drag = { x: action.x, y: action.y, origin: { ...position }, moved: false, previousX: action.x };
        else if (drag) {
          if (Math.hypot(action.x - drag.x, action.y - drag.y) >= 4) drag.moved = true;
          if (drag.moved) {
            const point = { x: Math.round(action.x), y: Math.round(action.y) }, display = screen.getDisplayNearestPoint(point);
            position = { ...drag.origin, x: drag.origin.x + action.x - drag.x, y: drag.origin.y + action.y - drag.y, displayId: display.id, edge: null };
            dragMood = action.x >= drag.previousX ? 'running-right' : 'running-left';
            drag.previousX = action.x;
            const layout = petLayout(position, display.workArea, PET_HEIGHT[settings.petSize], { panel: tray, bubble: !!bubbles.current, chat, mini: settings.petMini, peek: true });
            window.setBounds(layout.window);
          }
          if (action.type === 'dragEnd') {
            const display = screen.getAllDisplays().find((candidate) => candidate.id === position.displayId) ?? screen.getPrimaryDisplay();
            if (drag.moved) { dockAmount = 0; position = dockPosition(position, display.workArea, PET_HEIGHT[settings.petSize]); peek = false; if (position.edge) animateDock(1); savePosition(); }
            drag = null; dragMood = null;
          }
        }
        break;
      }
      default: return { ok: false, error: 'Unknown pet action' };
    }
    emit(); return { ok: true };
  }
  const onReady = (event: Electron.IpcMainEvent): void => { if (trusted(event)) { lastPayload = ''; emit(); if (visible) window.showInactive(); } };
  const onHitTest = (event: Electron.IpcMainEvent, hit: unknown): void => {
    if (!trusted(event) || typeof hit !== 'boolean' || interactive === hit) return;
    interactive = hit; window.setIgnoreMouseEvents(!hit, { forward: true });
  };
  ipcMain.on('rcDesktop:pet:ready', onReady);
  ipcMain.on('rcDesktop:pet:hitTest', onHitTest);
  ipcMain.handle('rcDesktop:pet:action', (event, value: unknown) => trusted(event) ? action(value) : { ok: false, error: 'Untrusted pet frame' });
  const unsubscribes = [deps.onAppearance((next) => { appearance = next; emit(); }), deps.hub.onSnapshot((snapshot) => {
    if (accountId && accountId !== snapshot.accountId) { bubbles.clear(); recentTargets.clear(); targetKey = null; }
    accountId = snapshot.accountId; items = snapshot.items;
    for (const item of items) if (recentTargets.has(item.key)) recentTargets.set(item.key, item);
    for (const bubble of [...bubbles.pending]) for (const event of bubble.events)
      if (event.type === 'needsInput' && !items.some((candidate) => candidate.key === event.item.key && candidate.request?.id === event.item.request?.id)) bubbles.resolve(event.item.key, Date.now());
    emit();
  }), deps.hub.onEvent((event) => {
    if (event.type === 'resolved') bubbles.resolve(event.item.key, Date.now());
    else if (event.type === 'completed') { completion = Date.now() - lastCompletedAt <= 1200 ? 'jumping' : 'waving'; lastCompletedAt = Date.now(); completionUntil = Date.now() + ANIMATIONS[completion].durations.reduce((a: number, b: number) => a + b, 0); }
    if (visible && deps.shouldSpeak(event) && !(settings.snoozeUntil && Date.parse(settings.snoozeUntil) > Date.now())) {
      if (bubbles.push(event, Date.now())) { targetKey = event.item.key; recentTargets.delete(event.item.key); recentTargets.set(event.item.key, event.item); while (recentTargets.size > 20) recentTargets.delete(recentTargets.keys().next().value!); }
    }
    emit();
  }), deps.hub.onAcknowledge((id) => { bubbles.acknowledge(id, Date.now()); emit(); }), deps.settings.onChange((next) => {
    const changedPack = settings.petId !== next.petId;
    if (settings.petMini !== next.petMini) { tray = next.petMini; peek = next.petMini; }
    settings = next; visible = next.petVisible;
    if (visible) window.showInactive(); else { window.hide(); bubbles.clear(); }
    if (changedPack) { pack = packs.find((candidate) => candidate.manifest.id === next.petId) ?? pack; if (!packs.some((candidate) => candidate.manifest.id === next.petId)) void refreshPacks(); }
    emit();
  })];
  const displayChanged = (): void => {
    position = restorePosition(position, screen.getAllDisplays(), screen.getPrimaryDisplay(), PET_HEIGHT[settings.petSize]); savePosition(); emit();
  };
  screen.on('display-removed', displayChanged); screen.on('display-metrics-changed', displayChanged);
  const timer = setInterval(emit, 250);
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  void (devUrl ? window.loadURL(`${devUrl.replace(/\/$/, '')}/pet/index.html`) : window.loadFile(join(__dirname, '../renderer/pet/index.html'))).then(refreshPacks);
  return {
    setVisible(value) { if (deps.settings.get().petVisible !== value) deps.settings.set({ petVisible: value }); visible = value; if (value) window.showInactive(); else window.hide(); },
    isVisible: () => visible && !disposed,
    dispose() {
      if (disposed) return; disposed = true; clearInterval(timer); if (dockTimer) clearInterval(dockTimer); savePosition();
      for (const unsubscribe of unsubscribes) unsubscribe();
      screen.removeListener('display-removed', displayChanged); screen.removeListener('display-metrics-changed', displayChanged);
      ipcMain.removeListener('rcDesktop:pet:ready', onReady); ipcMain.removeListener('rcDesktop:pet:hitTest', onHitTest); ipcMain.removeHandler('rcDesktop:pet:action');
      window.destroy();
    },
  };
}

/** Native Settings import entry; shell owns the parent window, pet owns validation. */
export async function importPetPack(deps: { petDirectories: string[]; settings: PetControllerDeps['settings']; parent: BrowserWindow }): Promise<void> {
  const choice = await dialog.showMessageBox(deps.parent, { type: 'question', message: app.getLocale().startsWith('zh') ? '导入 Codex 宠物包' : 'Import a Codex pet pack', buttons: ['Folder', 'ZIP', 'Cancel'], cancelId: 2 });
  if (choice.response === 2) return;
  const result = await dialog.showOpenDialog(deps.parent, { properties: [choice.response === 0 ? 'openDirectory' : 'openFile'], ...(choice.response === 1 ? { filters: [{ name: 'Codex pet pack', extensions: ['zip'] }] } : {}) });
  if (result.canceled || !result.filePaths[0]) return;
  const installed = await listPetPacks(deps.petDirectories);
  const pack = await importPack(result.filePaths[0], join(app.getPath('userData'), 'pets'), (bytes) => decodeImage(deps.parent, bytes), installed.map((pack) => pack.manifest.id));
  deps.settings.set({ petId: pack.manifest.id });
}

async function decodeImage(window: BrowserWindow, bytes: Buffer): Promise<boolean> {
  const dimensions = imageDimensions(bytes);
  if (dimensions.format === 'png') { const image = nativeImage.createFromBuffer(bytes); return !image.isEmpty() && image.getSize().width === dimensions.width && image.getSize().height === dimensions.height; }
  // Electron nativeImage only guarantees PNG/JPEG. Decode WebP in the sandboxed local Chromium page.
  const url = `data:image/webp;base64,${bytes.toString('base64')}`;
  try { return await window.webContents.executeJavaScript(`(async () => { const image = new Image(); image.src = ${JSON.stringify(url)}; try { await image.decode(); return image.naturalWidth === ${dimensions.width} && image.naturalHeight === ${dimensions.height}; } catch { return false; } })()`); } catch { return false; }
}
