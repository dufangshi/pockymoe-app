import { useWindowDimensions } from 'react-native';
import { createStore } from '../state/store';

export { computeLayout, type Layout, type LayoutVariant } from './widthClass';
import { computeLayout, type Layout } from './widthClass';

/** Fold posture from the native module: a vertical hinge splits columns at the hinge. */
export const foldStore = createStore<{ hingeX: number | null; separating: boolean }>({ hingeX: null, separating: false });

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  const hingeX = foldStore.useValue(s => s.separating ? s.hingeX : null);
  return computeLayout(width, height, hingeX);
}
