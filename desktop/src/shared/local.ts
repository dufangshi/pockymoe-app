import type { ActivitySnapshot, Appearance, DesktopSettings, HostCommandResult } from './contract';
import type { SummaryStatus, VoiceStatus } from './voice';
export interface LocalMessage {
  id: number; title: string; message: string; detail: string; buttons: string[]; cancelId: number; defaultId: number; dangerId?: number;
}
export interface LocalState {
  revision?: number; connectionError?: string;
  /** Chromium's error name for the last failed main-window load (e.g. ERR_CONNECTION_REFUSED). */
  offlineReason?: string;
  message?: LocalMessage | null;
  glassFallback?: boolean; platform?: string; locale: string; preferencesRequestId: number; preferencesSection: 'general' | 'pet' | 'shortcuts'; settings: DesktopSettings; appearance: Appearance | null; snapshot: ActivitySnapshot | null;
  petAvailable: boolean; petPacks: { id: string; name: string; thumbnail?: string; rows?: number; imported?: boolean; author?: string; source?: string; license?: string; licenseUrl?: string }[]; version: string; voice: VoiceStatus; summary: SummaryStatus;
}
export type LocalAction =
  | { type: 'settings'; patch: Partial<DesktopSettings> }
  | { type: 'connect'; origin: string; webOrigin?: string; relayOrigin?: string }
  | { type: 'open'; key: string }
  | { type: 'reply'; key: string; text: string }
  | { type: 'changeConnection' }
  | { type: 'retryConnection' }
  | { type: 'probeConnection' }
  | { type: 'hide' }
  | { type: 'importPet' }
  | { type: 'deletePet'; id: string }
  | { type: 'external'; url: string }
  | { type: 'quickSize'; height: number }
  | { type: 'connectionSize'; expanded: boolean }
  | { type: 'checkUpdate' }
  | { type: 'openAbout' }
  | { type: 'messageResponse'; id: number; response: number }
  | { type: 'voiceModel'; command: 'download' | 'cancel' | 'remove' }
  | { type: 'voiceKey'; key: string | null }
  | { type: 'voiceDiscover' }
  | { type: 'voicePreview' }
  | { type: 'voiceInstall' }
  | { type: 'openUpstreams' }
  | { type: 'summaryConnections' }
  | { type: 'muteTargets' }
  | { type: 'summaryTest' };
export interface LocalBridge {
  onRendering?(listener: (rendering: boolean) => void): () => void;
  getState(): Promise<LocalState>;
  onState(listener: (state: LocalState) => void): () => void;
  action(action: LocalAction): Promise<HostCommandResult>;
}
export const localBridge = (): LocalBridge => (window as unknown as { pockymoeDesktop: LocalBridge }).pockymoeDesktop;
