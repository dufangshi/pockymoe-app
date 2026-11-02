import type { ActivitySnapshot, Appearance, DesktopSettings, HostCommandResult } from './contract';
import type { SummaryStatus, VoiceStatus } from './voice';
export interface LocalState {
  locale: string; preferencesRequestId: number; preferencesSection: 'general' | 'pet' | 'shortcuts'; settings: DesktopSettings; appearance: Appearance | null; snapshot: ActivitySnapshot | null;
  petAvailable: boolean; petPacks: { id: string; name: string; thumbnail?: string; rows?: number; author?: string; source?: string; license?: string; licenseUrl?: string }[]; version: string; voice: VoiceStatus; summary: SummaryStatus;
}
export type LocalAction =
  | { type: 'settings'; patch: Partial<DesktopSettings> }
  | { type: 'connect'; origin: string; webOrigin?: string; relayOrigin?: string }
  | { type: 'open'; key: string }
  | { type: 'reply'; key: string; text: string }
  | { type: 'changeConnection' }
  | { type: 'hide' }
  | { type: 'importPet' }
  | { type: 'external'; url: string }
  | { type: 'quickSize'; height: number }
  | { type: 'connectionSize'; expanded: boolean }
  | { type: 'checkUpdate' }
  | { type: 'voiceModel'; command: 'download' | 'cancel' | 'remove' }
  | { type: 'voiceKey'; key: string | null }
  | { type: 'voiceList' }
  | { type: 'voicePreview' }
  | { type: 'voiceInstall' }
  | { type: 'openUpstreams' }
  | { type: 'summaryConnections' }
  | { type: 'summaryTest' };
export interface LocalBridge {
  getState(): Promise<LocalState>;
  onState(listener: (state: LocalState) => void): () => void;
  action(action: LocalAction): Promise<HostCommandResult>;
}
export const localBridge = (): LocalBridge => (window as unknown as { pockymoeDesktop: LocalBridge }).pockymoeDesktop;
