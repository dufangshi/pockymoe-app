// Device protection (the shield, docs/ui-principles.md §6): a separate dimension from the
// connection mark, always with its words.
import { View } from 'react-native';
import { ShieldAlert, ShieldCheck } from 'lucide-react-native';
import { AppText } from '../../design/AppText';
import { useTheme } from '../../design/theme';
import { translate } from '../../i18n';
import { devicesStore, type DeviceEntry } from '../../connection/devices';

export function ProtectionMark({ device, fallback }: { device: DeviceEntry; fallback?: string }) {
  const t = useTheme();
  const status = devicesStore.useValue(s => device.target.kind === 'relay' ? s.transport[device.target.deviceId] : undefined);
  if (device.kind !== 'relay' || !status || status.state === 'error') return fallback ? <AppText variant="callout" weight="semibold">{fallback}</AppText> : null;
  const ok = status.bound && status.certificateVerified;
  const Icon = ok ? ShieldCheck : ShieldAlert;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} accessible accessibilityLabel={ok ? translate('devices.state.protected') : translate('devices.state.notProtected')}>
      <Icon size={14} color={ok ? t.c.success : t.c.warning} />
      <AppText variant="caption" color={ok ? t.c.success : t.c.warning}>{ok ? translate('devices.state.protected') : translate('devices.state.notProtected')}</AppText>
    </View>
  );
}
