export interface Rect { x: number; y: number; width: number; height: number }
export interface PetDisplay { id: number; workArea: Rect }
export type DockEdge = 'left' | 'right' | 'top' | 'bottom';
export interface PetPosition { displayId: number; x: number; y: number; edge: DockEdge | null }
export const PET_HEIGHT = { S: 96, M: 128, L: 160 } as const;
/** Mini mode: the pet stays, just small. */
export const MINI_HEIGHT = 72;
/** How far a docked pet stays tucked when an alert brings its head out; 1 is the resting half-face peek. */
export const HEAD_PEEK = .6;
/** Fractions in the right-edge source image. Anchor is the face/edge crossing;
 * headHeight measures crown-to-chin, bounds exclude transparent padding. */
export interface PeekArt { path: 'peek.png' | 'peek.webp'; width: number; height: number; anchor: [number, number]; alertAnchor?: number; headHeight: number; bounds: [number, number, number, number] }
export function peekPose(width: number, height: number, edge: DockEdge, amount: number, face: FaceBox, art: PeekArt): Rect {
  const h = (face[3] - face[1]) * 2 * height / art.headHeight, w = h * art.width / art.height;
  // The cut side stays outside the physical edge, including the alert's fuller face.
  const alert = art.alertAnchor ?? Math.max(art.anchor[0], art.bounds[2] - .04);
  const crossing = art.anchor[0] + (alert - art.anchor[0]) * Math.min(1, Math.max(0, (1 - amount) / (1 - HEAD_PEEK)));
  const rightX = width - crossing * w;
  return { x: edge === 'right' ? rightX : width - rightX - w, y: (face[1] + face[3]) / 2 * height - art.anchor[1] * h, width: w, height: h };
}
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
export function petLayout(position: PetPosition, area: Rect, height: number, options: { panel?: boolean; bubble?: boolean; chat?: boolean; mini?: boolean; peek?: boolean; menu?: boolean; dockAmount?: number; faceBox?: FaceBox; peekArt?: PeekArt; measured?: { tray: number; bubble: number; chat: number } } = {}) {
  const width = Math.round(height * 192 / 208);
  const window = clampRect({ x: Math.round(position.x), y: Math.round(position.y), width, height }, area);
  const amount = options.dockAmount ?? (options.peek ? 0 : 1);
  const pose = dockedPose(width, height, position.edge, amount, options.faceBox, options.peekArt);
  return { window, pet: { x: pose.x, y: pose.y, width, height }, ...pose, panelAbove: window.y - area.y >= area.y + area.height - window.y - height, panelHeight: Math.min(258, area.height - 16) };
}
/** Render and hover geometry share one transform, including a slender pack's neck pivot. */
export function dockedPose(width: number, height: number, edge: DockEdge | null, amount: number, face: FaceBox = DEFAULT_FACE_BOX, art?: PeekArt) {
  if (art && amount > 0 && (edge === 'left' || edge === 'right')) {
    const image = peekPose(width, height, edge, amount, face, art), b = art.bounds;
    const bx = edge === 'right' ? b[0] : 1 - b[2];
    const x0 = Math.max(0, image.x + bx * image.width), y0 = Math.max(0, image.y + b[1] * image.height);
    const x1 = Math.min(width, image.x + (bx + b[2] - b[0]) * image.width), y1 = Math.min(height, image.y + b[3] * image.height);
    return { x: 0, y: 0, pivot: { x: width / 2, y: height / 2 }, clip: null, visible: { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) } };
  }
  const headOnly = amount > 0 && !!edge && face[3] - face[1] < .28;
  const sideHead = headOnly && (edge === 'left' || edge === 'right');
  const faceX = (face[0] + face[2]) / 2 * width, faceY = (face[1] + face[3]) / 2 * height;
  const pivot = headOnly ? { x: faceX, y: Math.min(1, face[3] + (face[3] - face[1]) * .35) * height } : { x: width / 2, y: height / 2 };
  const angle = dockTilt(edge, amount) * Math.PI / 180;
  const rotate = (x: number, y: number) => ({ x: pivot.x + (x - pivot.x) * Math.cos(angle) - (y - pivot.y) * Math.sin(angle), y: pivot.y + (x - pivot.x) * Math.sin(angle) + (y - pivot.y) * Math.cos(angle) });
  const center = rotate(faceX, faceY);
  const x = edge === 'left' ? -center.x * amount : edge === 'right' ? (width - center.x) * amount : 0;
  const eyes = (face[1] + (face[3] - face[1]) * .6) * height;
  // Hold the face at its undocked screen height while it leans around the neck.
  let y = sideHead ? faceY - center.y : edge === 'top' ? -center.y * amount : edge === 'bottom' ? (height - eyes) * amount : 0;
  const fw = face[2] - face[0], fh = face[3] - face[1];
  const left = Math.max(0, face[0] - fw * .65) * width, right = Math.min(1, face[2] + fw * .65) * width;
  const top = Math.max(0, face[1] - fh * 1.4) * height, bottom = Math.min(1, face[3] + fh * .45) * height;
  // Slender packs reveal only crown/hair, face and collarbone at every edge.
  // Keep the collar cut behind the physical top/bottom edge even during alerts.
  if (headOnly && (edge === 'top' || edge === 'bottom')) {
    const collar = rotate(faceX, bottom).y;
    y = edge === 'top' ? Math.min(y, -collar) : Math.max(y, height - collar);
  }
  const clip: Rect | null = headOnly ? { x: left, y: top, width: right - left, height: bottom - top } : null;
  const source = clip ?? { x: 0, y: 0, width, height };
  const corners = [[source.x, source.y], [source.x + source.width, source.y], [source.x, source.y + source.height], [source.x + source.width, source.y + source.height]].map(([x, y]) => rotate(x, y));
  const x0 = Math.max(0, Math.min(...corners.map(p => p.x + x))), x1 = Math.min(width, Math.max(...corners.map(p => p.x + x)));
  const y0 = Math.max(0, Math.min(...corners.map(p => p.y + y))), y1 = Math.min(height, Math.max(...corners.map(p => p.y + y)));
  return { x, y, pivot, clip, visible: { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) } };
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
/** What is being read goes over her head when it fits, where it does not cover the controls below. */
export function speechSurfaceSide(sprite: Rect, area: Rect, height: number): SurfaceSide {
  return sprite.y - 6 - height >= area.y ? 'above' : 'below';
}
/** Pass the side a visible surface already has: growing on hover must not flip it away from the pointer. */
export function surfaceLayout(sprite: Rect, area: Rect, width: number, height: number, side = surfaceSide(sprite, area, height), edge: DockEdge | null = null): Rect {
  return clampRect({ x: Math.round(edge === 'left' ? area.x + 8 : edge === 'right' ? area.x + area.width - width - 8 : sprite.x + sprite.width / 2 - width / 2), y: Math.round(side === 'below' ? sprite.y + sprite.height + 6 : sprite.y - height - 6), width, height }, area);
}
