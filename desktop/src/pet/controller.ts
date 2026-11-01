import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, screen } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { ActivityItem, ActivityRecent, Appearance, HostCommand, HostCommandResult, PetController, PetControllerDeps } from '../shared/contract';
import { resolveLocale, setLocale, t } from '../shared/i18n';
import { conversationKey } from '../shared/activityGroups';
import { ANIMATIONS } from './animation';
import { BubbleQueue } from './bubbles';
import { dockPosition, PET_HEIGHT, petLayout, restorePosition, surfaceLayout, type PetPosition } from './geometry';
import { importPetPack as importPack, listPetPacks, imageDimensions, type PetPack } from './packs';
import { petConversations } from './conversations';
import { StableMood, withoutResolvedRequest } from './stability';
import { configureOverlay, glassOptions } from './windows';
import type { PetAction, PetViewState } from './bridge';

type Command = HostCommand extends infer C ? C extends { id: string } ? Omit<C, 'id'> : never : never;
export function createPetController(deps: PetControllerDeps): PetController {
  const userPets = join(app.getPath('userData'), 'pets'), positionFile = join(app.getPath('userData'), 'pet-positions.json');
  let positions: Record<string, PetPosition> = {}, lastDisplayId: number | undefined;
  try {
    const stored = JSON.parse(readFileSync(positionFile, 'utf8'));
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      positions = stored.positions && typeof stored.positions === 'object' ? stored.positions : stored;
      if (typeof stored.lastDisplayId === 'number') lastDisplayId = stored.lastDisplayId;
    }
  } catch { /* First launch. */ }
  let settings = deps.settings.get();
  let appearance: Appearance = deps.appearance() ?? { effective: nativeTheme.shouldUseDarkColors ? 'dark' : 'light', pack: 'classic', accent: '#ad782e' };
  let uiLocale = resolveLocale(appearance.locale || app.getLocale()); setLocale(uiLocale);
  const moods = new StableMood(Date.now()), bubbles = new BubbleQueue();
  let items: ActivityItem[] = [], recent: ActivityRecent[] = [], accountId: string | null = null, targetKey: string | null = null;
  const targets = new Map<string, ActivityItem>();
  const initial = deps.hub.snapshot();
  if (initial) { items = initial.items; recent = initial.recent ?? []; accountId = initial.accountId; }
  let packs: PetPack[] = [], pack: PetPack | undefined, error: string | null = null;
  let disposed = false, visible = settings.petVisible, near = false, peek = false, dockAmount = 0;
  let mode: PetViewState['mode'] = 'controls', panel = false, menu = false, detailOpen = false;
  let lastSprite = '', lastGlass = '', readySprite = false, readyGlass = false, glassDismissed = false;
  let hoverSince = 0, awaySince = 0, alertPeekUntil = 0, lastOpacity = 1;
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  let drag: { x: number; y: number; origin: PetPosition; moved: boolean } | null = null;
  const completedConversations = new Map<string, number>();
  const primary = screen.getPrimaryDisplay();
  let position = restorePosition(positions[String(lastDisplayId ?? primary.id)], screen.getAllDisplays(), primary, PET_HEIGHT[settings.petSize]);
  dockAmount = position.edge && settings.petEdgeHide !== false ? 1 : 0;
  const preload = join(__dirname, '../preload/pet.js');
  const security = { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true };
  const window = new BrowserWindow({ ...petLayout(position, (screen.getAllDisplays().find(candidate => candidate.id === position.displayId) ?? primary).workArea, PET_HEIGHT[settings.petSize]).window, show: false, transparent: true, frame: false,
    focusable: false, hasShadow: false, skipTaskbar: true, resizable: false, maximizable: false, minimizable: false,
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}), webPreferences: security });
  const glass = new BrowserWindow({ ...glassOptions(process.platform), parent: window, width: 280, height: 40, show: false, webPreferences: security });
  configureOverlay(window); configureOverlay(glass);
  window.setIgnoreMouseEvents(true, { forward: true });
  for (const view of [window, glass]) {
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    view.webContents.on('will-navigate', event => event.preventDefault());
  }
  const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): BrowserWindow | null => {
    if (disposed) return null;
    return [window, glass].find(view => event.sender === view.webContents && event.senderFrame === view.webContents.mainFrame) ?? null;
  };
  const display = () => screen.getAllDisplays().find(candidate => candidate.id === position.displayId) ?? screen.getPrimaryDisplay();
  const dispatch = async (command: Command): Promise<HostCommandResult> => { try { return await deps.dispatch(command); } catch { return { ok: false, error: t('主窗口暂时无法连接，请稍后重试。', {}, uiLocale) }; } };
  function savePosition(): void {
    positions[String(position.displayId)] = position;
    try { mkdirSync(app.getPath('userData'), { recursive: true }); writeFileSync(positionFile, JSON.stringify({ positions, lastDisplayId: position.displayId })); } catch { error = t('无法保存桌宠位置。', {}, uiLocale); }
  }
  // Only moving/resizing the character (or a display change) may ever change these bounds.
  function placeSprite(): void {
    const bounds = petLayout(position, display().workArea, PET_HEIGHT[settings.petSize]).window;
    window.setBounds(bounds); placeGlass();
  }
  let glassSize = { width: 132, height: 36 };
  function placeGlass(): void {
    const bounds = surfaceLayout(window.getBounds(), display().workArea, glassSize.width, glassSize.height, position.edge);
    const before = glass.getBounds();
    if (Object.keys(bounds).some(key => bounds[key as keyof typeof bounds] !== before[key as keyof typeof before])) glass.setBounds(bounds);
  }
  function closeSurface(): void { panel = false; menu = false; detailOpen = false; mode = 'controls'; glassDismissed = true; emit(); }
  // macOS can deliver the prior panel's blur after a rapid close/reopen. Verify
  // settled native focus so that stale blur never tears down the newly opened UI.
  glass.on('blur', () => {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      if (disposed || glass.isDestroyed() || glass.isFocused()) return;
      if (panel || menu) closeSurface(); else if (detailOpen) { detailOpen = false; emit(); }
    }, 100);
  });
  glass.on('focus', () => clearTimeout(blurTimer));
  function openSurface(next: 'panel' | 'menu', selectedKey: string | null = null): void {
    panel = next === 'panel'; menu = next === 'menu'; detailOpen = false; mode = next; glassDismissed = false; peek = true;
    if (panel) targetKey = selectedKey;
    glass.setFocusable(true); emit(); glass.show(); glass.focus();
  }
  function emit(): void {
    if (disposed) return;
    const now = Date.now();
    const expiring = bubbles.current && !bubbles.current.sticky && bubbles.current.shownAt !== null && now - bubbles.current.shownAt >= 6000 ? [...bubbles.current.events] : [];
    bubbles.tick(now);
    for (const event of expiring) deps.hub.acknowledge(event.alertId, 'pet');
    const snoozed = !!settings.snoozeUntil && Date.parse(settings.snoozeUntil) > now;
    const bubble = snoozed ? null : bubbles.current;
    mode = panel ? 'panel' : menu ? 'menu' : bubble ? 'bubble' : 'controls';
    const layout = petLayout(position, display().workArea, PET_HEIGHT[settings.petSize], { dockAmount });
    const effectiveTargets = [...new Map([...items, ...targets.values(), ...recent.map(item => ({ ...item, workspaceId: '', state: 'idle' as const, since: new Date(0).toISOString(), unread: false }))].map(item => [item.key, item])).values()];
    const sleeping = pack?.manifest.remoteCodex?.sleeping;
    const shared = { appearance, accountId, items, recent, targets: effectiveTargets, mood: moods.value(items, now, snoozed), bubble,
      settings: { petSize: settings.petSize, petMini: settings.petMini, petSound: settings.petSound, petId: settings.petId },
      imageUrl: pack ? `data:image/${pack.manifest.spritesheetPath.endsWith('png') ? 'png' : 'webp'};base64,${pack.image.toString('base64')}` : '',
      ...(pack?.sleepingImage && sleeping ? { sleeping: { imageUrl: `data:image/${sleeping.path.endsWith('png') ? 'png' : 'webp'};base64,${pack.sleepingImage.toString('base64')}`, frames: sleeping.frames, durationsMs: sleeping.durationsMs } } : {}),
      atlasRows: (pack?.manifest.spriteVersionNumber === 2 ? 11 : 9) as 9 | 11, frameScale: pack?.manifest.remoteCodex?.frameScale ?? 1,
      packName: pack?.manifest.displayName ?? '', packs: packs.map(({ manifest }) => ({ id: manifest.id, displayName: manifest.displayName })),
      error, locale: uiLocale, tray: panel, chat: panel, mode, near, peek, detailOpen, edgeHide: settings.petEdgeHide !== false,
      edge: position.edge, dockAmount, pet: layout.pet, panelAbove: layout.panelAbove, panelHeight: 258, targetKey };
    for (const view of [window, glass]) {
      const state: PetViewState = { ...shared, surface: view === window ? 'sprite' : 'glass' };
      const payload = JSON.stringify(state), previous = view === window ? lastSprite : lastGlass;
      if (payload !== previous && (view === window ? readySprite : readyGlass)) {
        if (view === window) lastSprite = payload; else lastGlass = payload;
        view.webContents.send('rcDesktop:pet:state', state);
      }
    }
    const show = visible && readyGlass && (panel || menu || !!bubble || settings.petMini || !glassDismissed && (near || awaySince > 0 && now - awaySince < 220));
    glass.setIgnoreMouseEvents(mode === 'controls' && !near && !settings.petMini, { forward: true });
    const opacity = mode === 'controls' && !near && !settings.petMini ? Math.max(0, 1 - (now - awaySince) / 220) : 1;
    if (opacity !== lastOpacity && process.platform !== 'linux') { lastOpacity = opacity; glass.setOpacity(opacity); }
    if (show && !glass.isVisible()) { placeGlass(); glass.showInactive(); }
    if (!show && glass.isVisible()) glass.hide();
    glass.setFocusable(panel || menu || detailOpen);
  }
  async function refreshPacks(): Promise<void> {
    const candidates = await listPetPacks([...deps.petDirectories, userPets]);
    const valid = await Promise.all(candidates.map(async candidate => !(app.isPackaged && candidate.manifest.id === 'placeholder') && decodeImage(window, candidate.image)));
    if (disposed) return;
    packs = candidates.filter((_, index) => valid[index]);
    pack = packs.find(candidate => candidate.manifest.id === settings.petId) ?? packs.find(candidate => candidate.manifest.id === 'moe') ?? packs[0];
    error = pack ? null : t('没有可用的宠物包。', {}, uiLocale); emit();
  }
  function acknowledgeKey(key: string, capturedItem?: ActivityItem): void {
    const item = capturedItem ?? items.find(candidate => candidate.key === key);
    const ids = bubbles.pending.flatMap(bubble => bubble.events.filter(event => (event.item.key === key || conversationKey(event.item) === key)).map(event => event.alertId));
    if (item) ids.push(`${item.deviceId}:${item.request?.id ?? item.turnId ?? item.threadId}`);
    for (const id of new Set(ids)) deps.hub.acknowledge(id, 'pet');
  }
  async function action(value: unknown): Promise<HostCommandResult> {
    if (!value || typeof value !== 'object' || typeof (value as PetAction).type !== 'string') return { ok: false, error: t('桌宠操作无效', {}, uiLocale) };
    const action = value as PetAction;
    const item = 'key' in action ? items.find(candidate => candidate.key === action.key) ?? targets.get(action.key) ?? recent.find(candidate => candidate.key === action.key) ?? petConversations([...items, ...targets.values()]).find(group => group.key === action.key)?.root : undefined;
    if (['open', 'approve', 'deny', 'reply', 'target', 'showConversation', 'revealInMap'].includes(action.type) && !item) return { ok: false, error: t('线程已不在活动列表中。', {}, uiLocale) };
    switch (action.type) {
      case 'open': {
        if (!item) break;
        const result = await dispatch({ type: 'navigate', path: `/devices/${encodeURIComponent(item.deviceId)}/threads/${encodeURIComponent(item.threadId)}` });
        if (result.ok) { acknowledgeKey(item.key, 'state' in item ? item as ActivityItem : undefined); await dispatch({ type: 'markRead', key: item.key }); closeSurface(); } return result;
      }
      case 'revealInMap': if (item) { closeSurface(); return dispatch({ type: 'revealInMap', key: item.key }); } break;
      case 'approve': case 'deny': {
        if (!item || !('request' in item) || (item as ActivityItem).request?.kind !== 'approval') return { ok: false, error: t('此请求已不再等待批准。', {}, uiLocale) };
        const result = await dispatch({ type: 'resolveRequest', deviceId: item.deviceId, threadId: item.threadId, requestId: (item as ActivityItem).request!.id, decision: action.type });
        if (result.ok) {
          // A resolved snapshot can arrive before commandResult; retain the actual request's alert identity.
          deps.hub.acknowledge(`${item.deviceId}:${(item as ActivityItem).request!.id}`, 'pet');
          items = withoutResolvedRequest(items, item as ActivityItem);
        } emit(); return result;
      }
      case 'reply':
        if (item && typeof action.text === 'string' && action.text.trim() && action.text.length <= 16000) return dispatch({ type: 'reply', deviceId: item.deviceId, threadId: item.threadId, text: action.text.trim() });
        return { ok: false, error: t('请输入回复（最多16000个字符）。', {}, uiLocale) };
      case 'target': if (item) targetKey = item.key; break;
      case 'showConversation': if (item) openSurface('panel', conversationKey('state' in item ? item as ActivityItem : { ...item, state: 'idle', since: '', unread: false, workspaceId: '' })); break;
      case 'dismiss': for (const event of [...(bubbles.current?.events ?? [])]) deps.hub.acknowledge(event.alertId, 'pet'); break;
      case 'toggleTray': case 'toggleChat': if (panel) closeSurface(); else openSurface('panel'); break;
      case 'click': moods.react('jumping', Date.now(), ANIMATIONS.jumping.durations.reduce((a, b) => a + b, 0) * (pack?.manifest.remoteCodex?.frameScale ?? 1)); openSurface('panel'); break;
      case 'menu': if (action.value) openSurface('menu'); else closeSurface(); break;
      case 'close': closeSurface(); break;
      case 'detail': detailOpen = action.value === true; if (detailOpen) { glass.setFocusable(true); glass.show(); glass.focus(); } break;
      case 'openMain': closeSurface(); return dispatch({ type: 'navigate', path: '/' });
      case 'openMap': closeSurface(); return dispatch({ type: 'openMap' });
      case 'preferences': closeSurface(); return dispatch({ type: 'navigate', path: '/settings' });
      case 'setMini': if (typeof action.value === 'boolean') deps.settings.set({ petMini: action.value }); break;
      case 'setSound': if (typeof action.value === 'boolean') deps.settings.set({ petSound: action.value }); break;
      case 'setVisible': if (typeof action.value === 'boolean') deps.settings.set({ petVisible: action.value }); break;
      case 'setEdgeHide': if (typeof action.value === 'boolean') deps.settings.set({ petEdgeHide: action.value }); break;
      case 'setSize': if (['S', 'M', 'L'].includes(action.size)) deps.settings.set({ petSize: action.size }); break;
      case 'setPack': if (packs.some(candidate => candidate.manifest.id === action.id)) deps.settings.set({ petId: action.id }); break;
      case 'reducedMotion': break; // Renderer owns CSS motion and frame stepping.
      case 'surfaceMeasure':
        if (Number.isFinite(action.width) && Number.isFinite(action.height) && action.width >= 100 && action.width <= 320 && action.height >= 32 && action.height <= 900) { glassSize = { width: Math.ceil(action.width), height: Math.ceil(action.height) }; placeGlass(); } break;
      case 'importFolder': case 'importZip': {
        const choice = await dialog.showOpenDialog({ title: t('导入 Codex 宠物包', {}, uiLocale), buttonLabel: t('打开', {}, uiLocale), properties: [action.type === 'importFolder' ? 'openDirectory' : 'openFile'], ...(action.type === 'importZip' ? { filters: [{ name: t('Codex 宠物包', {}, uiLocale), extensions: ['zip'] }] } : {}) });
        if (!choice.canceled && choice.filePaths[0]) {
          try { const imported = await importPack(choice.filePaths[0], userPets, bytes => decodeImage(window, bytes), packs.map(candidate => candidate.manifest.id)); await refreshPacks(); deps.settings.set({ petId: imported.manifest.id }); }
          catch (cause) { return { ok: false, error: cause instanceof Error ? cause.message : t('操作失败，请重试', {}, uiLocale) }; }
        } break;
      }
      case 'dragStart': case 'dragMove': case 'dragEnd': {
        if (!Number.isFinite(action.x) || !Number.isFinite(action.y) || Math.abs(action.x) > 100000 || Math.abs(action.y) > 100000) break;
        if (action.type === 'dragStart') { drag = { x: action.x, y: action.y, origin: { ...position }, moved: false }; closeSurface(); }
        else if (drag) {
          if (Math.hypot(action.x - drag.x, action.y - drag.y) >= 4) drag.moved = true;
          if (drag.moved) {
            const next = screen.getDisplayNearestPoint({ x: Math.round(action.x), y: Math.round(action.y) });
            position = { ...drag.origin, x: drag.origin.x + action.x - drag.x, y: drag.origin.y + action.y - drag.y, displayId: next.id, edge: null }; dockAmount = 0;
            if (action.type === 'dragEnd') { position = dockPosition(position, next.workArea, PET_HEIGHT[settings.petSize]); peek = false; savePosition(); }
            placeSprite();
          }
          if (action.type === 'dragEnd') drag = null;
        } break;
      }
      case 'measure': case 'review': break; // Older local renderers cannot move the sprite window.
      default: return { ok: false, error: t('未知桌宠操作', {}, uiLocale) };
    }
    emit(); return { ok: true };
  }
  const onReady = (event: Electron.IpcMainEvent): void => {
    const view = trusted(event); if (!view) return;
    if (view === window) { readySprite = true; lastSprite = ''; if (visible) window.showInactive(); }
    else { readyGlass = true; lastGlass = ''; } emit();
  };
  const onHitTest = (event: Electron.IpcMainEvent, hit: unknown): void => { if (trusted(event) === window && typeof hit === 'boolean') window.setIgnoreMouseEvents(!hit, { forward: true }); };
  ipcMain.on('rcDesktop:pet:ready', onReady); ipcMain.on('rcDesktop:pet:hitTest', onHitTest);
  ipcMain.handle('rcDesktop:pet:action', (event, value: unknown) => trusted(event) ? action(value) : { ok: false, error: t('不受信任的桌宠页面', {}, uiLocale) });
  const unsubscribes = [deps.onAppearance(next => { appearance = next; if (next.locale) uiLocale = resolveLocale(next.locale); setLocale(uiLocale); emit(); }), deps.hub.onSnapshot(snapshot => {
    if (accountId !== snapshot.accountId) { bubbles.clear(); targets.clear(); completedConversations.clear(); moods.reset(Date.now()); targetKey = null; panel = false; menu = false; }
    accountId = snapshot.accountId; items = snapshot.items; recent = snapshot.recent ?? [];
    for (const item of items) if (targets.has(item.key)) targets.set(item.key, item);
    for (const bubble of [...bubbles.pending]) for (const event of bubble.events)
      if (event.type === 'needsInput' && items.some(item => item.key === event.item.key && item.request?.id !== event.item.request?.id)) bubbles.acknowledge(event.alertId, Date.now());
    emit();
  }), deps.hub.onEvent(event => {
    const now = Date.now();
    // Hub events are already filtered against per-device connection baselines (§2.1).
    if (event.type === 'resolved') { bubbles.acknowledge(event.alertId, now); items = withoutResolvedRequest(items, event.item); }
    const delivered = visible && deps.shouldSpeak(event) && !(settings.snoozeUntil && Date.parse(settings.snoozeUntil) > now);
    let reaction: 'waving' | 'jumping' = 'waving';
    if (event.type === 'completed' && delivered) {
      for (const [key, at] of completedConversations) if (now - at > 1200) completedConversations.delete(key);
      completedConversations.set(conversationKey(event.item), now);
      reaction = completedConversations.size > 1 ? 'jumping' : 'waving';
    }
    moods.onEvent(event.type, now, delivered, reaction, ANIMATIONS[reaction].durations.reduce((a, b) => a + b, 0) * (pack?.manifest.remoteCodex?.frameScale ?? 1));
    if (delivered && bubbles.push(event, now)) {
      targetKey = event.item.key; targets.set(event.item.key, event.item); while (targets.size > 20) targets.delete(targets.keys().next().value!);
      alertPeekUntil = now + 6000; glassDismissed = false;
    }
    emit();
  }), deps.hub.onAcknowledge(id => { bubbles.acknowledge(id, Date.now()); emit(); }), deps.settings.onChange(next => {
    const sizeChanged = settings.petSize !== next.petSize, packChanged = settings.petId !== next.petId;
    settings = next; visible = next.petVisible;
    if (sizeChanged) { position = restorePosition(position, screen.getAllDisplays(), screen.getPrimaryDisplay(), PET_HEIGHT[next.petSize]); placeSprite(); savePosition(); }
    if (packChanged) { pack = packs.find(candidate => candidate.manifest.id === next.petId) ?? pack; if (!packs.some(candidate => candidate.manifest.id === next.petId)) void refreshPacks(); }
    if (visible && readySprite && !window.isVisible()) window.showInactive();
    if (!visible) { window.hide(); glass.hide(); bubbles.clear(); panel = false; menu = false; }
    emit();
  })];
  const displayChanged = (): void => { position = restorePosition(position, screen.getAllDisplays(), screen.getPrimaryDisplay(), PET_HEIGHT[settings.petSize]); placeSprite(); savePosition(); emit(); };
  screen.on('display-removed', displayChanged); screen.on('display-metrics-changed', displayChanged);
  const timer = setInterval(() => {
    if (disposed) return;
    const now = Date.now(), cursor = screen.getCursorScreenPoint(), bounds = window.getBounds(), child = glass.getBounds();
    const within = (r: Electron.Rectangle, margin = 0) => cursor.x >= r.x - margin && cursor.x <= r.x + r.width + margin && cursor.y >= r.y - margin && cursor.y <= r.y + r.height + margin;
    const close = within(bounds, 60) || glass.isVisible() && within(child, 8);
    if (close) { if (!near) glassDismissed = false; near = true; awaySince = 0; if (!hoverSince) hoverSince = now; }
    else { near = false; hoverSince = 0; if (!awaySince) awaySince = now; }
    if (!position.edge || settings.petEdgeHide === false || panel || menu || bubbles.current?.sticky || now < alertPeekUntil || close && now - hoverSince >= 150) peek = true;
    else if (!close && now - awaySince >= 800) peek = false;
    const destination = position.edge && settings.petEdgeHide !== false && !peek ? 1 : 0;
    dockAmount = destination;
    emit();
  }, 100);
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  for (const view of [window, glass]) void (devUrl ? view.loadURL(`${devUrl.replace(/\/$/, '')}/pet/index.html`) : view.loadFile(join(__dirname, '../renderer/pet/index.html'))).then(() => { if (view === window) void refreshPacks(); });
  return {
    setVisible(value) { if (deps.settings.get().petVisible !== value) deps.settings.set({ petVisible: value }); }, isVisible: () => visible && !disposed,
    dispose() {
      if (disposed) return; disposed = true; clearInterval(timer); clearTimeout(blurTimer); savePosition();
      for (const unsubscribe of unsubscribes) unsubscribe();
      screen.removeListener('display-removed', displayChanged); screen.removeListener('display-metrics-changed', displayChanged);
      ipcMain.removeListener('rcDesktop:pet:ready', onReady); ipcMain.removeListener('rcDesktop:pet:hitTest', onHitTest); ipcMain.removeHandler('rcDesktop:pet:action'); glass.destroy(); window.destroy();
    },
  };
}
/** Native Settings import entry; shell owns the parent window, pet owns validation. */
export async function importPetPack(deps: { petDirectories: string[]; settings: PetControllerDeps['settings']; parent: BrowserWindow }): Promise<void> {
  const choice = await dialog.showMessageBox(deps.parent, { type: 'question', message: t('导入 Codex 宠物包'), buttons: [t('文件夹'), 'ZIP', t('取消')], cancelId: 2 });
  if (choice.response === 2) return;
  const result = await dialog.showOpenDialog(deps.parent, { title: t('导入 Codex 宠物包'), buttonLabel: t('打开'), properties: [choice.response === 0 ? 'openDirectory' : 'openFile'], ...(choice.response === 1 ? { filters: [{ name: t('Codex 宠物包'), extensions: ['zip'] }] } : {}) });
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
