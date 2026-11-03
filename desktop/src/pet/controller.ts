import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, screen } from 'electron';
import { release } from 'node:os';
import { windowsGlassMaterial } from '../shared/platform';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { ActivityItem, ActivityRecent, Appearance, DesktopSettings, HostCommand, HostCommandResult, PetController, PetControllerDeps } from '../shared/contract';
import { resolveLocale, setLocale, t } from '../shared/i18n';
import { agentAlertPolicy } from '../main/delivery';
import { conversationKey, conversationTitle, spokenActivityTitle } from '../shared/activityGroups';
import { isMuted, type MuteRule } from '../shared/mutes';
import { ANIMATIONS } from './animation';
import { BUBBLE_MS, BubbleQueue } from './bubbles';
import { dockPosition, HEAD_PEEK, MINI_HEIGHT, PET_HEIGHT, petLayout, restorePosition, surfaceLayout, surfaceSide, type PetPosition, type SurfaceSide } from './geometry';
import { importPetPack as importPack, listPetPacks, imageDimensions, readClip, type ClipState, type PetPack } from './packs';
import { petConversations } from './conversations';
import { StableMood, withoutResolvedRequest } from './stability';
import { configureOverlay, glassOptions, windowWasDestroyed } from './windows';
import type { PetAction, PetCue, PetViewState } from './bridge';

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
  let quitting = false;
  let disposed = false, visible = settings.petVisible, near = false, peek = false, dockAmount = 0;
  let mode: PetViewState['mode'] = 'controls', panel = false, menu = false, detailOpen = false;
  let lastSprite = '', lastGlass = '', readySprite = false, readyGlass = false, glassDismissed = false;
  let moodEpoch = 0;
  // How long a reaction holds: a pack's own clip decides, since its art can run for seconds.
  const reactionMs = (mood: Exclude<ClipState, 'resting'>): number => {
    const clips = pack?.manifest.remoteCodex?.clips?.[mood], format = pack?.manifest.remoteCodex?.clipFormat;
    if (clips?.length && format) return Math.max(...clips.map(clip => clip.frames)) / format.fps * 1000;
    return ANIMATIONS[mood].durations.reduce((a: number, b: number) => a + b, 0) * (pack?.manifest.remoteCodex?.frameScale ?? 1);
  };
  let hoverSince = 0, awaySince = 0, lastOpacity = 1, lastCue = 0, lastSpeech = 0, controlsPinned = false;
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  let drag: { x: number; y: number; origin: PetPosition; moved: boolean } | null = null;
  const completedConversations = new Map<string, number>();
  const primary = screen.getPrimaryDisplay();
  const petHeight = (value: Pick<DesktopSettings, 'petMini' | 'petSize'>): number => Math.round((value.petMini ? MINI_HEIGHT : PET_HEIGHT[value.petSize]) * (pack?.manifest.remoteCodex?.sizeScale ?? 1));
  let position = restorePosition(positions[String(lastDisplayId ?? primary.id)], screen.getAllDisplays(), primary, petHeight(settings));
  dockAmount = position.edge && settings.petEdgeHide !== false ? 1 : 0;
  const preload = join(__dirname, '../preload/pet.js');
  const security = { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, autoplayPolicy: 'no-user-gesture-required' as const, backgroundThrottling: false };
  const window = new BrowserWindow({ ...petLayout(position, (screen.getAllDisplays().find(candidate => candidate.id === position.displayId) ?? primary).workArea, petHeight(settings)).window, show: false, transparent: true, frame: false,
    focusable: false, hasShadow: false, skipTaskbar: true, resizable: false, maximizable: false, minimizable: false,
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}), webPreferences: security });
  const glass = new BrowserWindow({ ...glassOptions(process.platform, release(), process.env.POCKYMOE_WINDOWS_GLASS === 'solid'), parent: window, width: 280, height: 40, show: false, webPreferences: security });
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
    const bounds = petLayout(position, display().workArea, petHeight(settings)).window;
    window.setBounds(bounds); glassSide = null; placeGlass();
  }
  let glassSize = { width: 132, height: 36 }, glassSide: SurfaceSide | null = null, glassContent = '';
  function placeGlass(): void {
    glassSide ??= surfaceSide(window.getBounds(), display().workArea, glassSize.height);
    const bounds = surfaceLayout(window.getBounds(), display().workArea, glassSize.width, glassSize.height, glassSide);
    const before = glass.getBounds();
    if (Object.keys(bounds).some(key => bounds[key as keyof typeof bounds] !== before[key as keyof typeof before])) glass.setBounds(bounds);
  }
  // The size depends on the settings and on the pack, which can change independently.
  let appliedHeight = petHeight(settings);
  function applyPetSize(): void {
    const height = petHeight(settings);
    if (height === appliedHeight) return;
    appliedHeight = height;
    position = restorePosition(position, screen.getAllDisplays(), screen.getPrimaryDisplay(), height); placeSprite(); savePosition();
  }
  function closeSurface(): void { panel = false; menu = false; detailOpen = false; controlsPinned = false; mode = 'controls'; glassDismissed = true; emit(); }
  function play(audio: Uint8Array): void { if (readySprite && !window.isDestroyed()) window.webContents.send('rcDesktop:pet:speech', audio); }
  // Synthesis takes seconds: read one at a time, and only the newest of whatever piled up meanwhile.
  let synthesizing = false, nextSpeech: string | (() => Promise<string>) | null = null;
  async function say(text: string | (() => Promise<string>)): Promise<void> {
    if (synthesizing) { nextSpeech = text; return; }
    synthesizing = true;
    try { const audio = await deps.speak(typeof text === 'string' ? text : await text()); if (audio && !disposed) play(audio); }
    catch { /* The chime already told them; the voice service records why. */ }
    synthesizing = false;
    if (nextSpeech) { const next = nextSpeech; nextSpeech = null; void say(next); }
  }
  function cue(sound: PetCue['sound'] | undefined, speech?: string | (() => Promise<string>)): void {
    const now = Date.now();
    if (sound && settings.petSound && now - lastCue >= 800 && readySprite && !window.isDestroyed()) { lastCue = now; window.webContents.send('rcDesktop:pet:cue', { sound }); }
    if (speech && settings.petVoice && now - lastSpeech >= 2500) { lastSpeech = now; void say(speech); }
  }
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
  // The pet panel takes keyboard focus. Closing it must not hand that focus to the main window,
  // which macOS would then bring forward: pass it to the sprite first, and if the window came
  // forward anyway, put it back. Closing by clicking elsewhere is not this: that click means it.
  let mainWasFocused = false;
  function dismissSurface(): void {
    if (process.platform !== 'darwin') { closeSurface(); return; }
    const wasFocused = mainWasFocused;
    window.setFocusable(true); window.focus();
    closeSurface();
    window.setFocusable(false);
    const settle = (): void => { if (!disposed && !wasFocused && deps.mainFocused()) deps.lowerMain(); };
    settle(); setTimeout(settle, 150);
  }
  function openSurface(next: 'panel' | 'menu', selectedKey: string | null = null): void {
    mainWasFocused = deps.mainFocused();
    panel = next === 'panel'; menu = next === 'menu'; detailOpen = false; mode = next; glassDismissed = false; peek = true;
    if (panel) targetKey = selectedKey;
    // show() would activate the app and raise the main window; a panel takes key focus without that.
    glass.setFocusable(true); emit(); glass.showInactive(); glass.focus();
  }
  const live = (): boolean => !disposed && !window.isDestroyed() && !glass.isDestroyed();
  function retireDestroyed(error: unknown): void {
    if (!windowWasDestroyed(error)) throw error;
    dispose();
  }
  function emit(): void {
    if (!live()) return;
    try { emitState(); } catch (error) { retireDestroyed(error); }
  }
  function emitState(): void {
    const now = Date.now();
    const expiring = bubbles.current && !bubbles.current.sticky && bubbles.current.shownAt !== null && now - bubbles.current.shownAt >= BUBBLE_MS ? [...bubbles.current.events] : [];
    bubbles.tick(now);
    for (const event of expiring) deps.hub.acknowledge(event.alertId, 'pet');
    const snoozed = !!settings.snoozeUntil && Date.parse(settings.snoozeUntil) > now;
    const bubble = snoozed ? null : bubbles.current;
    mode = panel ? 'panel' : menu ? 'menu' : bubble && !controlsPinned ? 'bubble' : 'controls';
    const controlsShown = near || controlsPinned;
    const layout = petLayout(position, display().workArea, petHeight(settings), { dockAmount, faceBox: pack?.manifest.remoteCodex?.faceBox });
    const effectiveTargets = [...new Map([...items, ...targets.values(), ...recent.map(item => ({ ...item, workspaceId: '', state: 'idle' as const, since: new Date(0).toISOString(), unread: false }))].map(item => [item.key, item])).values()];
    const sleeping = pack?.manifest.remoteCodex?.sleeping;
    const shared = { appearance, glassFallback: process.platform === 'win32' && windowsGlassMaterial(release(), process.env.POCKYMOE_WINDOWS_GLASS === 'solid') === 'solid', accountId, items, recent, targets: effectiveTargets, mood: drag?.moved && pack?.manifest.remoteCodex?.clips?.dragging ? 'dragging' : moods.value(items, now, snoozed), moodEpoch, pinned: controlsPinned && !panel && !menu,
      faceBox: pack?.manifest.remoteCodex?.faceBox, talk: pack?.manifest.remoteCodex?.talk,
      clips: pack?.manifest.remoteCodex?.clips && pack.manifest.remoteCodex.clipFormat ? { format: pack.manifest.remoteCodex.clipFormat, states: pack.manifest.remoteCodex.clips, epoch: packEpoch } : null,
      // Timing stays here: while the pointer holds a bubble, its restart must not reach the renderer as a change.
      bubble: bubble && { ...bubble, createdAt: 0, shownAt: null },
      settings: { petSize: settings.petSize, petMini: settings.petMini, petSound: settings.petSound, petVoice: settings.petVoice, petId: settings.petId, petMutes: settings.petMutes },
      imageUrl: pack ? `data:image/${pack.manifest.spritesheetPath.endsWith('png') ? 'png' : 'webp'};base64,${pack.image.toString('base64')}` : '',
      ...(pack?.sleepingImage && sleeping ? { sleeping: { imageUrl: `data:image/${sleeping.path.endsWith('png') ? 'png' : 'webp'};base64,${pack.sleepingImage.toString('base64')}`, frames: sleeping.frames, durationsMs: sleeping.durationsMs } } : {}),
      atlasRows: (pack?.manifest.spriteVersionNumber === 2 ? 11 : 9) as 9 | 11, frameScale: pack?.manifest.remoteCodex?.frameScale ?? 1,
      packName: pack?.manifest.displayName ?? '', packs: packs.map(({ manifest }) => ({ id: manifest.id, displayName: manifest.displayName })),
      error, locale: uiLocale, tray: panel, chat: panel, mode, near: controlsShown, peek, detailOpen, edgeHide: settings.petEdgeHide !== false,
      edge: position.edge, dockAmount, pet: layout.pet, panelAbove: layout.panelAbove, panelHeight: 258, targetKey };
    for (const view of [window, glass]) {
      if (!live()) return;
      const state: PetViewState = { ...shared, surface: view === window ? 'sprite' : 'glass' };
      const payload = JSON.stringify(state), previous = view === window ? lastSprite : lastGlass;
      if (payload !== previous && (view === window ? readySprite : readyGlass)) {
        if (view === window) lastSprite = payload; else lastGlass = payload;
        view.webContents.send('rcDesktop:pet:state', state);
      }
    }
    if (!live()) return;
    const show = visible && readyGlass && (panel || menu || !!bubble || controlsPinned || !glassDismissed && (near || awaySince > 0 && now - awaySince < 220));
    glass.setIgnoreMouseEvents(mode === 'controls' && !controlsShown, { forward: true });
    if (!live()) return;
    const opacity = mode === 'controls' && !controlsShown ? Math.max(0, 1 - (now - awaySince) / 220) : 1;
    if (opacity !== lastOpacity && process.platform !== 'linux') { lastOpacity = opacity; glass.setOpacity(opacity); }
    if (!live()) return;
    if (show && !glass.isVisible()) { placeGlass(); if (live()) glass.showInactive(); }
    if (!live()) return;
    if (!show && glass.isVisible()) { glass.hide(); glassSide = null; }
    glass.setFocusable(panel || menu || detailOpen);
  }
  let packEpoch = 0;
  async function refreshPacks(): Promise<void> {
    const candidates = await listPetPacks([...deps.petDirectories, userPets]);
    const valid = await Promise.all(candidates.map(async candidate => !(app.isPackaged && candidate.manifest.id === 'placeholder') && decodeImage(window, candidate.image)));
    if (disposed) return;
    packs = candidates.filter((_, index) => valid[index]);
    pack = packs.find(candidate => candidate.manifest.id === settings.petId) ?? packs.find(candidate => candidate.manifest.id === 'moe') ?? packs[0];
    moodEpoch++; applyPetSize();
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
    if (['open', 'approve', 'deny', 'reply', 'target', 'showConversation', 'revealInMap', 'toggleMute'].includes(action.type) && !item) return { ok: false, error: t('线程已不在活动列表中。', {}, uiLocale) };
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
      case 'toggleTray': case 'toggleChat': if (panel) dismissSurface(); else openSurface('panel'); break;
      case 'click':
        moods.react('poked', Date.now(), reactionMs('poked')); moodEpoch++; cue('click');
        // A click reveals what is running, above the control capsule; the panel opens from there.
        if (panel || menu) closeSurface(); else { controlsPinned = !controlsPinned; glassDismissed = false; peek = true; }
        break;
      case 'menu': if (action.value) openSurface('menu'); else closeSurface(); break;
      case 'close': dismissSurface(); break;
      case 'detail': detailOpen = action.value === true; if (detailOpen) { glass.setFocusable(true); glass.showInactive(); glass.focus(); } break;
      case 'openMain': closeSurface(); return dispatch({ type: 'navigate', path: '/' });
      case 'openMap': closeSurface(); return dispatch({ type: 'openMap' });
      case 'preferences': closeSurface(); deps.openPreferences('pet'); return { ok: true };
      case 'setMini': if (typeof action.value === 'boolean') deps.settings.set({ petMini: action.value }); break;
      case 'setSound': if (typeof action.value === 'boolean') deps.settings.set({ petSound: action.value }); break;
      case 'setVoice': if (typeof action.value === 'boolean') deps.settings.set({ petVoice: action.value }); break;
      case 'toggleMute': {
        if (!item) break;
        const key = conversationKey('state' in item ? item as ActivityItem : { ...item, state: 'idle', since: '', unread: false, workspaceId: '' });
        const rule: MuteRule = { kind: 'thread', id: key, label: conversationTitle('state' in item ? item as ActivityItem : { ...item, state: 'idle', since: '', unread: false, workspaceId: '' }, items) };
        const rest = settings.petMutes.filter(entry => !(entry.kind === 'thread' && entry.id === key));
        deps.settings.set({ petMutes: rest.length === settings.petMutes.length ? [...rest, rule] : rest });
        break;
      }
      case 'setVisible': if (typeof action.value === 'boolean') deps.settings.set({ petVisible: action.value }); break;
      case 'setEdgeHide': if (typeof action.value === 'boolean') deps.settings.set({ petEdgeHide: action.value }); break;
      case 'setSize': if (['S', 'M', 'L'].includes(action.size)) deps.settings.set({ petSize: action.size }); break;
      case 'setPack': if (packs.some(candidate => candidate.manifest.id === action.id)) deps.settings.set({ petId: action.id }); break;
      case 'reducedMotion': break; // Renderer owns CSS motion and frame stepping.
      case 'surfaceMeasure':
        if (Number.isFinite(action.width) && Number.isFinite(action.height) && action.width >= 28 && action.width <= 320 && action.height >= 28 && action.height <= 900) {
          glassSize = { width: Math.ceil(action.width), height: Math.ceil(action.height) };
          // New content picks a side for its own size; the same content growing on hover keeps it.
          const content = `${mode}:${controlsPinned}`;
          if (content !== glassContent) { glassContent = content; glassSide = null; }
          placeGlass();
        } break;
      case 'importFolder': case 'importZip': {
        const choice = await dialog.showOpenDialog({ title: t('导入 Codex 宠物包', {}, uiLocale), buttonLabel: t('打开', {}, uiLocale), properties: [action.type === 'importFolder' ? 'openDirectory' : 'openFile'], ...(action.type === 'importZip' ? { filters: [{ name: t('Codex 宠物包', {}, uiLocale), extensions: ['zip'] }] } : {}) });
        if (!choice.canceled && choice.filePaths[0]) {
          try { const imported = await importPack(choice.filePaths[0], userPets, bytes => decodeImage(window, bytes), await builtInPetIds(deps.petDirectories)); await refreshPacks(); packEpoch++; deps.settings.set({ petId: imported.manifest.id }); }
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
            if (action.type === 'dragEnd') {
              position = dockPosition(position, next.workArea, petHeight(settings)); peek = false; savePosition();
              if (pack?.manifest.remoteCodex?.clips?.landing) { moods.react('landing', Date.now(), reactionMs('landing')); moodEpoch++; }
            }
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
  ipcMain.handle('rcDesktop:pet:clip', async (event, path: unknown) => trusted(event) === window && pack && typeof path === 'string' ? readClip(pack, path) : null);
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
    if (delivered) {
      const title = spokenActivityTitle(event.item, items);
      // The summary runs only when its turn comes up to be read, so a burst costs one model call.
      const line = (fallback: string) => async (): Promise<string> => (await deps.summarize(event)) ?? fallback;
      if (event.type === 'needsInput') cue('needsInput', t('{title} 需要你处理', { title }, uiLocale));
      else if (event.type === 'completed') cue('completed', !agentAlertPolicy(event, settings).voice || isMuted(event.item, settings.petMutes) ? undefined : line(t('{title} 完成了', { title }, uiLocale)));
      else if (event.type === 'failed') cue('failed', agentAlertPolicy(event, settings).voice ? line(t('{title} 失败了', { title }, uiLocale)) : undefined);
    }
    moods.onEvent(event.type, now, delivered, reaction, reactionMs(event.type === 'failed' ? 'failed' : reaction));
    if (delivered && ['completed', 'failed'].includes(event.type)) moodEpoch++;
    if (delivered && bubbles.push(event, now)) {
      targetKey = event.item.key; targets.set(event.item.key, event.item); while (targets.size > 20) targets.delete(targets.keys().next().value!);
      glassDismissed = false;
    }
    emit();
  }), deps.hub.onAcknowledge(id => { bubbles.acknowledge(id, Date.now()); emit(); }), deps.settings.onChange(next => {
    const packChanged = settings.petId !== next.petId;
    const soundOn = next.petSound && !settings.petSound, voiceOn = next.petVoice && !settings.petVoice;
    settings = next; visible = next.petVisible;
    // Turning a cue on previews it, so the setting's effect is obvious.
    if (soundOn) cue('completed');
    if (voiceOn) cue(undefined, t('语音播报已打开', {}, uiLocale));
    if (packChanged) { pack = packs.find(candidate => candidate.manifest.id === next.petId) ?? pack; if (!packs.some(candidate => candidate.manifest.id === next.petId)) void refreshPacks(); }
    applyPetSize();
    if (visible && readySprite && !window.isVisible()) window.showInactive();
    if (!visible) { window.hide(); glass.hide(); bubbles.clear(); panel = false; menu = false; }
    emit();
  })];
  const displayChanged = (): void => { position = restorePosition(position, screen.getAllDisplays(), screen.getPrimaryDisplay(), petHeight(settings)); placeSprite(); savePosition(); emit(); };
  screen.on('display-removed', displayChanged); screen.on('display-metrics-changed', displayChanged);
  function visiblePetRect() {
    const layout = petLayout(position, display().workArea, petHeight(settings), { dockAmount, faceBox: pack?.manifest.remoteCodex?.faceBox });
    const { pet } = layout, bounds = window.getBounds();
    // Use the actual visible face strip, not a fraction of a tall figure's window.
    const x = position.edge === 'right' ? Math.max(0, pet.x) : 0;
    const y = position.edge === 'bottom' ? Math.max(0, pet.y) : 0;
    return { x: bounds.x + x, y: bounds.y + y, width: Math.max(0, bounds.width - Math.abs(pet.x)), height: Math.max(0, bounds.height - Math.abs(pet.y)) };
  }
  const pollPointer = (): void => {
    const now = Date.now(), cursor = screen.getCursorScreenPoint(), bounds = window.getBounds(), child = glass.getBounds();
    const within = (r: Electron.Rectangle, margin = 0) => cursor.x >= r.x - margin && cursor.x <= r.x + r.width + margin && cursor.y >= r.y - margin && cursor.y <= r.y + r.height + margin;
    const tucked = position.edge && settings.petEdgeHide !== false && dockAmount > 0;
    const close = (tucked ? within(visiblePetRect(), 0) : within(bounds, 60)) || glass.isVisible() && within(child, 8);
    if (controlsPinned && !close && now - awaySince >= 4000) controlsPinned = false;
    if (close) bubbles.hold(now); // Reading it keeps it there.
    if (close) { if (!near) glassDismissed = false; near = true; awaySince = 0; if (!hoverSince) hoverSince = now; }
    else { near = false; hoverSince = 0; if (!awaySince) awaySince = now; }
    if (!position.edge || settings.petEdgeHide === false || panel || menu || controlsPinned || close && now - hoverSince >= 150) peek = true;
    else if (!close && now - awaySince >= 800) peek = false;
    // A docked pet shows only its head for an alert, and tucks back in when the alert is gone.
    const alerting = !!bubbles.current && !(settings.snoozeUntil && Date.parse(settings.snoozeUntil) > now);
    dockAmount = position.edge && settings.petEdgeHide !== false && !peek ? alerting ? HEAD_PEEK : 1 : 0;
    emit();
  };
  const timer = setInterval(() => {
    if (!live()) return;
    try { pollPointer(); } catch (error) { retireDestroyed(error); }
  }, 100);
  // Stop native-window polling before Electron begins destroying those windows.
  const beforeQuit = (): void => { quitting = true; dispose(false); };
  const closeGlass = (event: Electron.Event): void => { if (!quitting && !deps.isUpdating?.()) { event.preventDefault(); dismissSurface(); } };
  const closeSprite = (event: Electron.Event): void => { if (!quitting && !deps.isUpdating?.()) { event.preventDefault(); deps.settings.set({ petVisible: false }); } };
  const nativeClosed = (): void => dispose();
  glass.on('close', closeGlass); window.on('close', closeSprite);
  app.once('before-quit', beforeQuit);
  window.once('closed', nativeClosed); glass.once('closed', nativeClosed);
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  for (const view of [window, glass]) void (devUrl ? view.loadURL(`${devUrl.replace(/\/$/, '')}/pet/index.html`) : view.loadFile(join(__dirname, '../renderer/pet/index.html'))).then(() => { if (view === window) void refreshPacks(); });
  function dispose(destroyWindows = true): void {
    if (disposed) return; disposed = true; clearInterval(timer); clearTimeout(blurTimer); savePosition();
    app.removeListener('before-quit', beforeQuit);
    window.removeListener('closed', nativeClosed); glass.removeListener('closed', nativeClosed);
    glass.removeListener('close', closeGlass); window.removeListener('close', closeSprite);
    for (const unsubscribe of unsubscribes) unsubscribe();
    screen.removeListener('display-removed', displayChanged); screen.removeListener('display-metrics-changed', displayChanged);
    ipcMain.removeListener('rcDesktop:pet:ready', onReady); ipcMain.removeListener('rcDesktop:pet:hitTest', onHitTest); ipcMain.removeHandler('rcDesktop:pet:action'); ipcMain.removeHandler('rcDesktop:pet:clip');
    // Windows may already be destroying a native owner's children while closed
    // is delivered. Let that stack unwind before retiring the surviving window.
    if (destroyWindows) setImmediate(() => {
      if (!glass.isDestroyed()) glass.destroy();
      if (!window.isDestroyed()) window.destroy();
    });
  }
  return {
    async reloadPacks() { await refreshPacks(); packEpoch++; emit(); },
    setVisible(value) { if (deps.settings.get().petVisible !== value) deps.settings.set({ petVisible: value }); }, isVisible: () => visible && !disposed, isAvailable: live, play, say(text) { cue(undefined, text); },
    dispose,
  };
}
/** Native Settings import entry; shell owns the parent window, pet owns validation. */
export async function importPetPack(deps: { petDirectories: string[]; settings: PetControllerDeps['settings']; parent: BrowserWindow }): Promise<void> {
  // One zip holds the whole pet. macOS can also pick a folder in the same dialog.
  const result = await dialog.showOpenDialog(deps.parent, { title: t('导入宠物包'), buttonLabel: t('导入'), properties: process.platform === 'darwin' ? ['openFile', 'openDirectory'] : ['openFile'], filters: [{ name: t('宠物包'), extensions: ['zip'] }] });
  if (result.canceled || !result.filePaths[0]) return;
  const pack = await importPack(result.filePaths[0], join(app.getPath('userData'), 'pets'), (bytes) => decodeImage(deps.parent, bytes), await builtInPetIds(deps.petDirectories));
  deps.settings.set({ petId: pack.manifest.id });
}
/** Bundled packs are the first directory; anything imported can be replaced by importing again. */
async function builtInPetIds(directories: string[]): Promise<string[]> {
  return (await listPetPacks(directories.slice(0, 1))).map(pack => pack.manifest.id);
}

async function decodeImage(window: BrowserWindow, bytes: Buffer): Promise<boolean> {
  const dimensions = imageDimensions(bytes);
  if (dimensions.format === 'png') { const image = nativeImage.createFromBuffer(bytes); return !image.isEmpty() && image.getSize().width === dimensions.width && image.getSize().height === dimensions.height; }
  // Electron nativeImage only guarantees PNG/JPEG. Decode WebP in the sandboxed local Chromium page.
  const url = `data:image/webp;base64,${bytes.toString('base64')}`;
  try { return await window.webContents.executeJavaScript(`(async () => { const image = new Image(); image.src = ${JSON.stringify(url)}; try { await image.decode(); return image.naturalWidth === ${dimensions.width} && image.naturalHeight === ${dimensions.height}; } catch { return false; } })()`); } catch { return false; }
}
