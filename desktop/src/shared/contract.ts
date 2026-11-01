// Single source of truth for the desktop host bridge. supervisor-web mirrors the
// page half in apps/supervisor-web/src/desktop/host.ts; bump
// HOST_BRIDGE_VERSION on any breaking change and feature-detect, never assume.
// Design: docs/desktop-design.zh.md §6.

export const HOST_BRIDGE_VERSION = 2;

export interface HostCapabilities {
  surface: 'desktop';
  bridgeVersion: number;
  platform: 'darwin' | 'win32' | 'linux';
  shellVersion: string;
  notifications: 'local' | 'local+apns';
  windowChrome: {
    kind: 'hiddenInset' | 'titleBarOverlay';
    /** Horizontal space the page must leave for native window controls. */
    trafficLightsWidth: number;
    toolbarHeight: number;
    /** Windows: controls sit on the right instead of the left. */
    controlsSide: 'left' | 'right';
  };
  features: {
    pet: boolean;
    quickWindow: boolean;
    multiWindow: boolean;
    nativeSave: boolean;
    badge: boolean;
  };
}

export type ActivityState = 'needsInput' | 'failed' | 'interrupted' | 'completed' | 'running' | 'idle';

export interface ActivityRequest {
  id: string;
  kind: 'approval' | 'input';
  /** Plain text, at most 140 characters. */
  summary: string;
}

export interface ActivityItem {
  /** `${deviceId}:${threadId}` */
  key: string;
  deviceId: string;
  deviceName: string;
  workspaceId: string;
  workspaceLabel: string;
  threadId: string;
  title: string;
  agentName?: string | null;
  state: ActivityState;
  /** ISO time the item entered its current state. */
  since: string;
  turnId?: string | null;
  unread: boolean;
  request?: ActivityRequest | null;
  /** First line of the result for completed/failed, at most 140 characters. */
  resultSummary?: string | null;
  durationMs?: number | null;
}

export interface ActivitySnapshot {
  version: 1;
  generatedAt: string;
  accountId: string;
  /** Thread the focused main window is showing, or null. */
  focusedThreadKey: string | null;
  /** needsInput, failed/interrupted (unread, last 24h), completed (unread) and running only. */
  items: ActivityItem[];
}

export type HostCommand =
  | { id: string; type: 'navigate'; path: string }
  | { id: string; type: 'markRead'; key: string }
  | {
      id: string;
      type: 'resolveRequest';
      deviceId: string;
      threadId: string;
      requestId: string;
      decision: 'approve' | 'deny';
    }
  | { id: string; type: 'reply'; deviceId: string; threadId: string; text: string }
  | { id: string; type: 'revealInMap'; key: string }
  | { id: string; type: 'openMap' }
  | { id: string; type: 'newThread' }
  | { id: string; type: 'openDevices' };

export interface HostCommandResult {
  ok: boolean;
  error?: string;
}

export interface DesktopSettings {
  /** Origin of the Web UI the main window loads (GitHub Pages in production). */
  webOrigin: string;
  /** Origin of the relay API (APNs registration, health). Equal to webOrigin for same-origin relays. */
  relayOrigin: string;
  alertMode: 'petFirst' | 'system' | 'both';
  petVisible: boolean;
  petId: string;
  petSize: 'S' | 'M' | 'L';
  petMini: boolean;
  petSound: boolean;
  launchAtLogin: boolean;
  /** Electron accelerator; default 'Alt+Space'. */
  quickWindowShortcut: string;
  snoozeUntil: string | null;
}

export interface Appearance {
  effective: 'light' | 'dark';
  /** Theme pack id: 'classic' | 'plum-pocket' | 'terminal' | … */
  pack: string;
  /** Resolved accent color (any CSS color) so local windows can match the page. */
  accent: string;
  fontScale?: number;
}

/** Exposed as window.pockymoeHost to the configured webOrigin's top frame only. */
export interface PockymoeHost {
  capabilities(): Promise<HostCapabilities>;
  activity: { sync(snapshot: ActivitySnapshot): void };
  onCommand(listener: (command: HostCommand) => void): () => void;
  commandResult(id: string, result: HostCommandResult): void;
  window: {
    openThread(path: string, options?: { newWindow?: boolean }): void;
    setTitle(title: string): void;
  };
  shell: { openExternal(url: string): void };
  files: {
    saveAs(name: string, data: ArrayBuffer): Promise<{ saved: boolean; path?: string }>;
  };
  pet: { setVisible(visible: boolean): void; isVisible(): Promise<boolean> };
  settings: {
    get(): Promise<DesktopSettings>;
    set(patch: Partial<DesktopSettings>): Promise<DesktopSettings>;
  };
  badge: { set(count: number, style: 'attention' | 'running' | 'none'): void };
  appearance: { sync(appearance: Appearance): void };
}

// ---- Main process: ActivityHub, shared by notifications, tray, badge and pet ----

export type ActivityEventType = 'started' | 'needsInput' | 'completed' | 'failed' | 'resolved';

export interface ActivityEvent {
  type: ActivityEventType;
  /** Stable alert id: `${deviceId}:${turnId}`, or `${deviceId}:${requestId}` for needsInput. */
  alertId: string;
  item: ActivityItem;
  at: string;
}

export interface ActivityHubLike {
  snapshot(): ActivitySnapshot | null;
  onSnapshot(listener: (snapshot: ActivitySnapshot) => void): () => void;
  onEvent(listener: (event: ActivityEvent) => void): () => void;
  /** Called by any surface (notification, pet, tray, quick window) once the user saw an alert. */
  acknowledge(alertId: string, source: 'notification' | 'pet' | 'tray' | 'main' | 'quick'): void;
  onAcknowledge(listener: (alertId: string, source: string) => void): () => void;
}

export interface SettingsStoreLike {
  get(): DesktopSettings;
  set(patch: Partial<DesktopSettings>): DesktopSettings;
  onChange(listener: (settings: DesktopSettings) => void): () => void;
}

export type PetMood =
  | 'idle'
  | 'running'
  | 'waiting'
  | 'failed'
  | 'waving'
  | 'jumping'
  | 'review'
  | 'sleeping';

/** Implemented by desktop/src/pet/controller.ts; created and owned by the main process. */
export interface PetControllerDeps {
  hub: ActivityHubLike;
  settings: SettingsStoreLike;
  /** Focus the main window and run a command in the relay page (navigate, approve, reply, ...). */
  dispatch(command: Omit<HostCommand, 'id'>): Promise<HostCommandResult>;
  /** Whether the delivery policy wants the pet to speak for this event (§5.2). */
  shouldSpeak(event: ActivityEvent): boolean;
  /** Directory holding bundled and imported pet packs. */
  petDirectories: string[];
  /** Latest page appearance, so the pet matches the selected theme. */
  appearance(): Appearance | null;
  onAppearance(listener: (appearance: Appearance) => void): () => void;
}

export interface PetController {
  setVisible(visible: boolean): void;
  isVisible(): boolean;
  dispose(): void;
}
