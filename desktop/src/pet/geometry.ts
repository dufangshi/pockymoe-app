export interface Rect { x: number; y: number; width: number; height: number }
export interface PetDisplay { id: number; workArea: Rect }
export type DockEdge = 'left' | 'right' | 'top' | 'bottom';
export interface PetPosition { displayId: number; x: number; y: number; edge: DockEdge | null }
export const PET_HEIGHT = { S: 96, M: 128, L: 160 } as const;
/** Mini mode: the pet stays, just small. */
export const MINI_HEIGHT = 72;
/** How far a docked pet stays tucked when an alert brings its head out; 1 is the resting half-face peek. */
export const HEAD_PEEK = .6;
export type FaceBox = [number, number, number, number];
/** MOE's head; imported slender figures should declare their own face box. */
export const DEFAULT_FACE_BOX: FaceBox = [.22, .4, .78, .8];
export function dockTilt(edge: DockEdge | null, amount: number): number {
  return !edge || !amount ? 0 : edge === 'top' ? 180 : edge === 'bottom' ? 0 : (edge === 'left' ? 16 : -16) * Math.min(1, amount * 1.4);
}
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(Math.max(min, max), value));
export function clampRect(rect: Rect, area: Rect): Rect {
  const width = Math.min(rect.width, area.width), height = Math.min(rect.height, area.height);
  return { width, height, x: clamp(rect.x, area.x, area.x + area.width - width), y: clamp(rect.y, area.y, area.y + area.height - height) };
}
export function defaultPosition(display: PetDisplay, height: number): PetPosition {
  return { displayId: display.id, x: display.workArea.x + display.workArea.width - height - 32,
    y: display.workArea.y + display.workArea.height - height - LIST_CLEARANCE, edge: null };
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
export function petLayout(position: PetPosition, area: Rect, height: number, options: { panel?: boolean; bubble?: boolean; chat?: boolean; mini?: boolean; peek?: boolean; menu?: boolean; dockAmount?: number; faceBox?: FaceBox; measured?: { tray: number; bubble: number; chat: number } } = {}) {
  const width = Math.round(height * 192 / 208);
  const window = clampRect({ x: Math.round(position.x), y: Math.round(position.y), width, height }, area);
  const amount = options.dockAmount ?? (options.peek ? 0 : 1);
  const face = options.faceBox ?? DEFAULT_FACE_BOX, angle = dockTilt(position.edge, amount) * Math.PI / 180;
  const fx = (face[0] + face[2]) / 2 * width - width / 2;
  const fy = (face[1] + face[3]) / 2 * height - height / 2;
  const cx = width / 2 + fx * Math.cos(angle) - fy * Math.sin(angle);
  const cy = height / 2 + fx * Math.sin(angle) + fy * Math.cos(angle);
  // At rest the edge bisects the face. Alerts travel farther out; hover reveals all.
  const x = position.edge === 'left' ? -cx * amount : position.edge === 'right' ? (width - cx) * amount : 0;
  const eyes = (face[1] + (face[3] - face[1]) * .6) * height;
  const y = position.edge === 'top' ? -cy * amount : position.edge === 'bottom' ? (height - eyes) * amount : 0;
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
/** Room kept under the pet so a bubble with its controls fits there. */
export const CONTROLS_CLEARANCE = 78;
/** A new pet also starts with room for the list of running threads. */
const LIST_CLEARANCE = 240;
/** The glass child sits below the pet; only a surface with no room there goes above it. */
export type SurfaceSide = 'below' | 'above';
export function surfaceSide(sprite: Rect, area: Rect, height: number): SurfaceSide {
  return sprite.y + sprite.height + 6 + height <= area.y + area.height ? 'below' : 'above';
}
/** Pass the side a visible surface already has: growing on hover must not flip it away from the pointer. */
export function surfaceLayout(sprite: Rect, area: Rect, width: number, height: number, side = surfaceSide(sprite, area, height)): Rect {
  return clampRect({ x: Math.round(sprite.x + sprite.width / 2 - width / 2), y: Math.round(side === 'below' ? sprite.y + sprite.height + 6 : sprite.y - height - 6), width, height }, area);
}
