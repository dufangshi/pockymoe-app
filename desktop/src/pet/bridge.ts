import type { ActivityItem, Appearance, DesktopSettings, HostCommandResult } from '../shared/contract';
import type { SpriteState } from './animation';
import type { PetBubble } from './bubbles';
import type { DockEdge, Rect } from './geometry';
export interface PetViewState {
  appearance: Appearance;
  accountId: string | null;
  items: ActivityItem[];
  targets: ActivityItem[];
  mood: SpriteState;
  bubble: PetBubble | null;
  settings: Pick<DesktopSettings, 'petSize' | 'petMini' | 'petSound' | 'petId'>;
  imageUrl: string;
  sleeping?: { imageUrl: string; frames: number; durationsMs: number[] };
  packName: string;
  packs: { id: string; displayName: string }[];
  error: string | null;
  locale: string;
  tray: boolean;
  chat: boolean;
  peek: boolean;
  edge: DockEdge | null;
  dockAmount: number;
  pet: Rect;
  panelAbove: boolean;
  panelHeight: number;
  targetKey: string | null;
}
export type PetAction =
  | { type: 'open' | 'approve' | 'deny' | 'revealInMap'; key: string }
  | { type: 'reply'; key: string; text: string }
  | { type: 'target'; key: string }
  | { type: 'dismiss' }
  | { type: 'toggleTray' | 'toggleChat' | 'click' | 'openMain' | 'preferences' | 'importFolder' | 'importZip' }
  | { type: 'setSize'; size: 'S' | 'M' | 'L' }
  | { type: 'setPack'; id: string }
  | { type: 'setMini' | 'setSound' | 'setVisible'; value: boolean }
  | { type: 'review' | 'menu' | 'reducedMotion'; value: boolean }
  | { type: 'measure'; tray: number; bubble: number; chat: number }
  | { type: 'dragStart' | 'dragMove' | 'dragEnd'; x: number; y: number };
export interface PetBridge {
  onState(listener: (state: PetViewState) => void): () => void;
  ready(): void;
  hitTest(interactive: boolean): void;
  action(action: PetAction): Promise<HostCommandResult>;
}
