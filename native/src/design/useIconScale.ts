import { useWindowDimensions } from 'react-native';
/** Icons and status marks grow with the system font scale (capped at 1.5×, text stops at
 *  1.8×) so they stay in proportion to the text beside them; at the default scale they keep
 *  their size. */
export function useIconScale() {
  return Math.min(Math.max(useWindowDimensions().fontScale, 1), 1.5);
}
/** A size in points scaled with the text, rounded to whole points. */
export function useIconSize(size: number) { return Math.round(size * useIconScale()); }
