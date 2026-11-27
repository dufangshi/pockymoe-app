// The one on/off switch: the platform Switch with theme colours. Off keeps a visible track
// (a switch that is off must still read as a switch, WCAG 1.4.11); on uses the solid primary.
import { Switch } from 'react-native';
import { useTheme } from './theme';

export function Toggle({ value, onValueChange, disabled, label }: { value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  const t = useTheme();
  return (
    <Switch value={value} onValueChange={onValueChange} disabled={disabled} accessibilityLabel={label}
      trackColor={{ true: t.c.primarySolid, false: t.c.borderContrast }} ios_backgroundColor={t.c.borderContrast}
      thumbColor={value ? '#ffffff' : t.mode === 'dark' ? '#c9cdc9' : '#ffffff'} />
  );
}
