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
    y: display.workArea.y + display.workArea.height - height - CONTROLS_CLEARANCE - 8, edge: null };
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
  // Signed: dragging hard at an edge overshoots it, which must dock rather than count as far away.
  const distances: [DockEdge, number][] = [['left', position.x - area.x], ['right', area.x + area.width - position.x - width],
    ['top', position.y - area.y], ['bottom', area.y + area.height - position.y - height]];
  distances.sort((a, b) => a[1] - b[1]);
  const edge = distances[0][1] <= 24 ? distances[0][0] : null;
  return { displayId: position.displayId, x: edge === 'left' ? area.x : edge === 'right' ? area.x + area.width - width : bounded.x,
    y: edge === 'top' ? area.y : edge === 'bottom' ? area.y + area.height - height : Math.min(bounded.y, area.y + area.height - height - CONTROLS_CLEARANCE), edge };
}
/** Fixed sprite bounds: panel, menu, bubble and hover state never affect this window. */
export function petLayout(position: PetPosition, area: Rect, height: number, options: { panel?: boolean; bubble?: boolean; chat?: boolean; mini?: boolean; peek?: boolean; menu?: boolean; dockAmount?: number; measured?: { tray: number; bubble: number; chat: number } } = {}) {
  const width = Math.round(height * 192 / 208);
  const window = clampRect({ x: Math.round(position.x), y: Math.round(position.y), width, height }, area);
  const amount = options.dockAmount ?? (options.peek ? 0 : 1);
  const x = position.edge === 'left' ? -width * .75 * amount : position.edge === 'right' ? width * .75 * amount : 0;
  const y = position.edge === 'top' ? -height * .75 * amount : position.edge === 'bottom' ? height * .75 * amount : 0;
  return { window, pet: { x, y, width, height }, panelAbove: window.y - area.y >= area.y + area.height - window.y - height, panelHeight: Math.min(258, area.height - 16) };
}
/** The strip of a tucked pet still on screen; hovering only this brings it out. */
export function exposedRect(window: Rect, edge: DockEdge, visible = .25): Rect {
  const width = Math.round(window.width * visible), height = Math.round(window.height * visible);
  if (edge === 'left') return { ...window, width };
  if (edge === 'right') return { ...window, x: window.x + window.width - width, width };
  if (edge === 'top') return { ...window, height };
  return { ...window, y: window.y + window.height - height, height };
}
/** Room kept under the pet so its controls fit there. */
export const CONTROLS_CLEARANCE = 44;
/** The glass child sits below the pet; only a surface with no room there goes above it. */
export function surfaceLayout(sprite: Rect, area: Rect, width: number, height: number): Rect {
  const below = sprite.y + sprite.height + 8, room = below + height <= area.y + area.height;
  return clampRect({ x: Math.round(sprite.x + sprite.width / 2 - width / 2), y: Math.round(room ? below : sprite.y - height - 8), width, height }, area);
}
