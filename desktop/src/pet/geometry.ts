export interface Rect { x: number; y: number; width: number; height: number }
export interface PetDisplay { id: number; workArea: Rect }
export type DockEdge = 'left' | 'right' | 'top' | 'bottom';
export interface PetPosition { displayId: number; x: number; y: number; edge: DockEdge | null }
export const PET_HEIGHT = { S: 96, M: 128, L: 160 } as const;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(Math.max(min, max), value));
export function clampRect(rect: Rect, area: Rect): Rect {
  const width = Math.min(rect.width, area.width), height = Math.min(rect.height, area.height);
  return { width, height, x: clamp(rect.x, area.x, area.x + area.width - width), y: clamp(rect.y, area.y, area.y + area.height - height) };
}
export function defaultPosition(display: PetDisplay, height: number): PetPosition {
  return { displayId: display.id, x: display.workArea.x + display.workArea.width - height - 32,
    y: display.workArea.y + display.workArea.height - height - 24, edge: null };
}
export function restorePosition(position: PetPosition | undefined, displays: PetDisplay[], primary: PetDisplay, height: number): PetPosition {
  const display = displays.find((candidate) => candidate.id === position?.displayId);
  if (!position || !display || !Number.isFinite(position.x) || !Number.isFinite(position.y) || ![null, 'left', 'right', 'top', 'bottom'].includes(position.edge)) return defaultPosition(primary, height);
  const rect = clampRect({ ...position, width: height * 192 / 208, height }, display.workArea);
  return { ...position, x: position.edge === 'left' ? display.workArea.x : position.edge === 'right' ? display.workArea.x + display.workArea.width - rect.width : rect.x, y: position.edge === 'top' ? display.workArea.y : position.edge === 'bottom' ? display.workArea.y + display.workArea.height - rect.height : rect.y };
}
export function dockPosition(position: PetPosition, area: Rect, height: number): PetPosition {
  const width = height * 192 / 208;
  const bounded = clampRect({ ...position, width, height }, area);
  const distances: [DockEdge, number][] = [['left', Math.abs(position.x - area.x)], ['right', Math.abs(position.x + width - area.x - area.width)],
    ['top', Math.abs(position.y - area.y)], ['bottom', Math.abs(position.y + height - area.y - area.height)]];
  distances.sort((a, b) => a[1] - b[1]);
  const edge = distances[0][1] <= 24 ? distances[0][0] : null;
  return { displayId: position.displayId, x: edge === 'left' ? area.x : edge === 'right' ? area.x + area.width - width : bounded.x,
    y: edge === 'top' ? area.y : edge === 'bottom' ? area.y + area.height - height : bounded.y, edge };
}
export function petLayout(position: PetPosition, area: Rect, height: number, options: { panel: boolean; bubble?: boolean; chat: boolean; mini: boolean; peek: boolean; menu?: boolean; dockAmount?: number; measured?: { tray: number; bubble: number; chat: number } }) {
  const width = Math.round(height * 192 / 208);
  let x = position.x, y = position.y;
  const dockAmount = options.dockAmount ?? (options.peek ? 0 : 1);
  if (!options.mini) {
    if (position.edge === 'left') x -= width * .45 * dockAmount;
    if (position.edge === 'right') x += width * .45 * dockAmount;
    if (position.edge === 'top') y -= height * .45 * dockAmount;
    if (position.edge === 'bottom') y += height * .45 * dockAmount;
  }
  const bodyHeight = options.mini ? 0 : height;
  // Pick the roomier side from the work area, then shrink the scrollable tray to fit.
  // This decision must not depend on panel height: otherwise measurements can flip it back and forth.
  const above = Math.max(0, y - area.y), below = Math.max(0, area.y + area.height - y - bodyHeight);
  const panelAbove = above >= below;
  const sideRoom = Math.max(above, below);
  const bubbleHeight = options.bubble ? (options.measured?.bubble || 90) + 12 : 0;
  const chatHeight = options.chat ? (options.measured?.chat || 84) + 12 : 0;
  const available = Math.max(56, sideRoom - 64 - bubbleHeight - chatHeight);
  const panelHeight = options.panel ? Math.min(options.measured?.tray || 414, 414, available) : 0;
  const extraHeight = Math.max(options.menu ? Math.min(420, sideRoom) : 48, (panelHeight ? panelHeight + 12 : 0) + bubbleHeight + chatHeight + 48);
  const windowWidth = options.panel || options.chat || options.bubble || options.menu ? 352 : Math.max(276, width + 120);
  const window = clampRect({ x: x + width / 2 - windowWidth / 2, y: panelAbove ? y - extraHeight : y - 60, width: windowWidth, height: bodyHeight + extraHeight + 60 }, area);
  return { window: { x: Math.round(window.x), y: Math.round(window.y), width: Math.round(window.width), height: Math.round(window.height) },
    pet: { x: Math.round(x - window.x), y: Math.round(y - window.y), width, height: bodyHeight }, panelHeight,
    panelAbove };
}
