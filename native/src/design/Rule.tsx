// A horizontal rule, solid or dashed. Android draws a dashed border only on a box with all four
// sides, so a dashed rule is the top edge of a taller dashed box clipped to the line.
import { View, type StyleProp, type ViewStyle } from 'react-native';

export function Rule({ color, width = 1, dashed = false, style }: { color: string; width?: number; dashed?: boolean; style?: StyleProp<ViewStyle> }) {
  if (!dashed) return <View style={[{ height: width, backgroundColor: color }, style]} />;
  return (
    <View style={[{ height: width, overflow: 'hidden' }, style]}>
      <View style={{ height: width * 4, borderWidth: width, borderStyle: 'dashed', borderColor: color, borderRadius: 0.1 }} />
    </View>
  );
}
