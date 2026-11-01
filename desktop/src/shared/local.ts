import type { ActivitySnapshot, DesktopSettings, HostCommandResult } from './contract';
export interface LocalState {
  settings: DesktopSettings; snapshot: ActivitySnapshot | null;
  petAvailable: boolean; petPacks: { id: string; name: string }[]; version: string;
}
export type LocalAction =
  | { type: 'settings'; patch: Partial<DesktopSettings> }
  | { type: 'connect'; origin: string }
  | { type: 'open'; key: string }
  | { type: 'reply'; key: string; text: string }
  | { type: 'hide' }
  | { type: 'importPet' }
  | { type: 'checkUpdate' };
export interface LocalBridge {
  getState(): Promise<LocalState>;
  onState(listener: (state: LocalState) => void): () => void;
  action(action: LocalAction): Promise<HostCommandResult>;
}
export const localBridge = (): LocalBridge => (window as unknown as { rcDesktop: LocalBridge }).rcDesktop;
