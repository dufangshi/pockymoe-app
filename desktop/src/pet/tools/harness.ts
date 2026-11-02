import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createPetController } from '../controller';
import type { Appearance, ActivityEvent, ActivityHubLike, ActivitySnapshot, DesktopSettings, HostCommand, SettingsStoreLike } from '../../shared/contract';
app.getLocale = () => 'zh-CN';
app.setPath('userData', mkdtempSync(join(tmpdir(), 'rc-pet-harness-')));
const snapshotListeners = new Set<(value: ActivitySnapshot) => void>(), eventListeners = new Set<(value: ActivityEvent) => void>(), ackListeners = new Set<(id: string, source: string) => void>(), settingsListeners = new Set<(value: DesktopSettings) => void>();
let snapshot: ActivitySnapshot = { version: 1, accountId: 'pet-fixture', generatedAt: new Date().toISOString(), focusedThreadKey: null, items: [] };
let settings: DesktopSettings = { webOrigin: 'https://example.invalid', relayOrigin: 'https://example.invalid', alertMode: 'petFirst', petVisible: true, petId: 'moe', petSize: 'M', petMini: false, petSound: false, petVoice: false, petVoiceProvider: 'local', petVoiceSpeaker: 3, petVoiceSpeed: 1, petVoiceRemotes: {}, petVoiceSummary: false, petSummaryConnection: null, petSummaryLanguage: 'auto', petEdgeHide: true, launchAtLogin: false, quickWindowShortcut: 'Alt+Space', snoozeUntil: null };
const commands: Omit<HostCommand, 'id'>[] = [], acknowledgements: string[] = [];
const appearanceListeners = new Set<(value: Appearance) => void>();
let appearance: Appearance = { effective: 'light', pack: 'classic', accent: '#ad782e' };
let cursorPoint = { x: -10000, y: -10000 };
let replyFails = false, ignored = true, failingCommand: 'resolveRequest' | 'reply' | null = null;
const hub: ActivityHubLike = {
  snapshot: () => snapshot,
  onSnapshot: (listener) => { snapshotListeners.add(listener); return () => snapshotListeners.delete(listener); },
  onEvent: (listener) => { eventListeners.add(listener); return () => eventListeners.delete(listener); },
  acknowledge: (id, source) => { acknowledgements.push(id); for (const listener of ackListeners) listener(id, source); },
  onAcknowledge: (listener) => { ackListeners.add(listener); return () => ackListeners.delete(listener); },
};
const store: SettingsStoreLike = {
  get: () => ({ ...settings }),
  set: (patch) => { settings = { ...settings, ...patch }; for (const listener of settingsListeners) listener(settings); return settings; },
  onChange: (listener) => { settingsListeners.add(listener); return () => settingsListeners.delete(listener); },
};
void app.whenReady().then(() => {
  const controller = createPetController({ openPreferences: () => undefined, mainFocused: () => false, lowerMain: () => undefined, speak: async () => null, summarize: async () => null, hub, settings: store, appearance: () => appearance, onAppearance: (listener) => { appearanceListeners.add(listener); return () => appearanceListeners.delete(listener); }, dispatch: async (command) => { commands.push(command); if (command.type === failingCommand) { await new Promise((resolve) => setTimeout(resolve, 100)); return { ok: false, code: 'needsThread', error: 'needsThread' }; } if (command.type === 'reply') { await new Promise((resolve) => setTimeout(resolve, 120)); if (replyFails) return { ok: false, error: '模拟发送失败，请重试' }; } return { ok: true }; }, shouldSpeak: () => true, petDirectories: [join(process.cwd(), 'assets/pets')] });
  const window = BrowserWindow.getAllWindows().find(view => !view.getParentWindow())!, glass = BrowserWindow.getAllWindows().find(view => !!view.getParentWindow())!;
  const nativeSetBounds = window.setBounds.bind(window); let spriteBoundsCalls = 0; let requestedBounds = window.getBounds();
  window.setBounds = (bounds, animate) => { spriteBoundsCalls++; requestedBounds = { ...requestedBounds, ...bounds }; nativeSetBounds(bounds, animate); };
  let captureOnly = false;
  const nativeFocused = glass.isFocused.bind(glass), nativeFocus = glass.focus.bind(glass), nativeShow = glass.show.bind(glass);
  glass.isFocused = () => captureOnly || nativeFocused();
  glass.focus = () => { if (!captureOnly) nativeFocus(); };
  glass.show = () => { if (captureOnly) glass.showInactive(); else nativeShow(); };
  Object.assign(screen, { getCursorScreenPoint: () => cursorPoint });
  const setIgnored = window.setIgnoreMouseEvents.bind(window);
  window.setIgnoreMouseEvents = (value, options) => { ignored = value; setIgnored(value, options); };
  Object.assign(globalThis, { petHarness: {
    sync(value: ActivitySnapshot) { snapshot = value; for (const listener of snapshotListeners) listener(value); },
    event(value: ActivityEvent) { for (const listener of eventListeners) listener(value); },
    acknowledge(id: string) { hub.acknowledge(id, 'notification'); },
    theme(value: 'light' | 'dark') { nativeTheme.themeSource = value; },
    appearance(value: Appearance) { appearance = value; for (const listener of appearanceListeners) listener(value); },
    workArea(width: number) { const area = { x: 0, y: 38, width, height: 800 }; const display = { id: 1, workArea: area }; Object.assign(screen, { getPrimaryDisplay: () => display, getAllDisplays: () => [display], getDisplayNearestPoint: () => display, getDisplayMatching: () => display }); },
    captureOnly: (value: boolean) => { captureOnly = value; },
    cursor: (point: { x: number; y: number }) => { cursorPoint = point; },
    metrics: () => ({ spriteBoundsCalls, requestedBounds, dockVisible: app.dock?.isVisible(), sprite: window.getBounds(), glass: glass.getBounds(), glassVisible: glass.isVisible(), glassFocused: glass.isFocused() }),
    resetMetrics: () => { spriteBoundsCalls = 0; },
    blur: () => glass.blur(),
    displays(values: { id: number; workArea: Electron.Rectangle }[]) { Object.assign(screen, { getPrimaryDisplay: () => values[0], getAllDisplays: () => values, getDisplayNearestPoint: (point: Electron.Point) => values.find(value => point.x >= value.workArea.x && point.x <= value.workArea.x + value.workArea.width) ?? values[0] }); screen.emit('display-metrics-changed'); },
    settings: (patch: Partial<DesktopSettings>) => store.set(patch),
    failCommand: (value: 'resolveRequest' | 'reply' | null) => { failingCommand = value; },
    ignored: () => ignored, failReply: (value: boolean) => { replyFails = value; },
    commands: () => commands, acknowledgements: () => acknowledgements,
  } });
  app.on('before-quit', () => controller.dispose());
});
app.on('window-all-closed', () => app.quit());
