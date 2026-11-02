import type { PetSound } from './sounds';
import type { ActivityItem, ActivityRecent, Appearance, DesktopSettings, HostCommandResult } from '../shared/contract';
import type { SpriteState } from './animation';
import type { PetBubble } from './bubbles';
import type { DockEdge, Rect } from './geometry';
import type { ClipFormat, PetClip } from './packs';
export interface PetViewState {
  appearance: Appearance;
  surface: 'sprite' | 'glass';
  mode: 'controls' | 'panel' | 'menu' | 'bubble';
  near: boolean;
  detailOpen: boolean;
  recent: ActivityRecent[];
  atlasRows: 9 | 11;
  frameScale: number;
  edgeHide: boolean;
  accountId: string | null;
  items: ActivityItem[];
  targets: ActivityItem[];
  mood: SpriteState;
  /** Changes on every reaction, so clicking again replays one that is already showing. */
  moodEpoch: number;
  /** Clicking the pet: the running threads above the controls. */
  pinned: boolean;
  clips: { format: ClipFormat; states: Partial<Record<SpriteState, PetClip[]>>; epoch: number } | null;
  bubble: PetBubble | null;
  settings: Pick<DesktopSettings, 'petSize' | 'petMini' | 'petSound' | 'petVoice' | 'petId'>;
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
export interface PetCue { sound: PetSound }
export type PetAction =
  | { type: 'open' | 'approve' | 'deny' | 'revealInMap'; key: string }
  | { type: 'reply'; key: string; text: string }
  | { type: 'target' | 'showConversation'; key: string }
  | { type: 'dismiss' | 'close' | 'openMap' }
  | { type: 'detail'; value: boolean }
  | { type: 'surfaceMeasure'; width: number; height: number }
  | { type: 'setEdgeHide'; value: boolean }
  | { type: 'toggleTray' | 'toggleChat' | 'click' | 'openMain' | 'preferences' | 'importFolder' | 'importZip' }
  | { type: 'setSize'; size: 'S' | 'M' | 'L' }
  | { type: 'setPack'; id: string }
  | { type: 'setMini' | 'setSound' | 'setVoice' | 'setVisible'; value: boolean }
  | { type: 'review' | 'menu' | 'reducedMotion'; value: boolean }
  | { type: 'measure'; tray: number; bubble: number; chat: number }
  | { type: 'dragStart' | 'dragMove' | 'dragEnd'; x: number; y: number };
export interface PetBridge {
  onState(listener: (state: PetViewState) => void): () => void;
  onCue(listener: (cue: PetCue) => void): () => void;
  onSpeech(listener: (audio: Uint8Array) => void): () => void;
  clip(path: string): Promise<Uint8Array | null>;
  ready(): void;
  hitTest(interactive: boolean): void;
  action(action: PetAction): Promise<HostCommandResult>;
}
