import type { ComponentRef, Ref } from 'react';
import { Platform, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from './theme';

export interface PressProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle> | ((pressed: boolean) => StyleProp<ViewStyle>);
  /** Pressed look: a background wash (rows) or dimming (icons, chips). */
  feedback?: 'wash' | 'dim' | 'none';
  radius?: number;
  ref?: Ref<ComponentRef<typeof Pressable>>;
}
/** The one pressable: ripple on Android, a wash or dim on iOS; never leaves a pressed state behind (§16). */
export function Press({ style, feedback = 'wash', radius, disabled, ref, ...rest }: PressProps) {
  const t = useTheme();
  return (
    <Pressable
      ref={ref}
      disabled={disabled}
      android_ripple={feedback === 'none' || disabled ? undefined : { color: t.c.hover, borderless: false, foreground: true }}
      style={({ pressed }) => [
        typeof style === 'function' ? style(pressed) : style,
        radius !== undefined ? { borderRadius: radius, overflow: 'hidden' as const } : null,
        pressed && Platform.OS === 'ios' && feedback === 'wash' ? { backgroundColor: t.c.hover } : null,
        pressed && feedback === 'dim' ? { opacity: 0.55 } : null,
        disabled ? { opacity: 0.45 } : null,
      ]}
      {...rest}
    />
  );
}
