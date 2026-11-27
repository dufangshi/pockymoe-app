// Width classes and column widths, pure so they can be tested off device.
/**
 * Width class of the window (T3's layering: only the shell reads it).
 * compact < 600: the list is the root and pages push; the inspector is a sheet.
 * medium 600–899: list and page side by side; the inspector is a sheet.
 * expanded ≥ 900: list, page and an inspector column.
 * On medium windows an open inspector docks beside the page and the list steps aside
 * (the Web's rule: a docked panel once the conversation keeps its minimum width).
 */
export type LayoutVariant = 'compact' | 'medium' | 'expanded';
export interface Layout { variant: LayoutVariant; width: number; height: number; listWidth: number; inspectorWidth: number; split: boolean; landscape: boolean }

export function computeLayout(width: number, height: number, hingeX: number | null = null): Layout {
  // A phone on its side is wide but short: columns need height too, or they become slivers.
  const variant: LayoutVariant = width >= 900 && height >= 520 ? 'expanded' : width >= 600 && height >= 480 ? 'medium' : 'compact';
  const split = variant !== 'compact';
  let listWidth = variant === 'expanded' ? Math.min(380, Math.max(300, width * 0.28)) : variant === 'medium' ? Math.min(340, Math.max(280, width * 0.4)) : width;
  // A book-style foldable: put the column edge on the hinge.
  if (split && hingeX && hingeX > 240 && hingeX < width - 320) listWidth = hingeX;
  let inspectorWidth = variant === 'expanded' ? Math.min(460, Math.max(340, width * 0.3)) : variant === 'medium' ? Math.min(420, Math.max(320, width * 0.44)) : 0;
  // A docked inspector on a medium foldable fills the second half: its edge sits on the hinge.
  if (variant === 'medium' && hingeX && hingeX > 280 && hingeX < width - 280) inspectorWidth = width - hingeX;
  return { variant, width, height, listWidth, inspectorWidth, split, landscape: width > height };
}
