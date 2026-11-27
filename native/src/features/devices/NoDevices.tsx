// What the workbench shows before it has a device to open. Each case says why and offers
// the one step that moves on: still loading, the account needs setup on the Web, the relay
// did not answer, or there really is no device yet.
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import { KeyRound, LogOut, MonitorSmartphone, WifiOff } from 'lucide-react-native';
import { EmptyState, SkeletonRows } from '../../design/States';
import { Button } from '../../design/Button';
import { useTheme } from '../../design/theme';
import { translate } from '../../i18n';
import { accountStore, signOut } from '../../connection/account';
import { devicesStore, refreshRelayDevices } from '../../connection/devices';

export function NoDevices({ onAddSupervisor }: { onAddSupervisor: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const account = accountStore.useValue(s => s);
  const relay = devicesStore.useValue(s => ({ loading: s.loading, error: s.error, loadedAt: s.loadedAt }), (a, b) => a.loading === b.loading && a.error === b.error && a.loadedAt === b.loadedAt);
  let body;
  if (account.phase === 'setupOnWeb') {
    body = (
      <EmptyState icon={KeyRound} title={translate('native.setupOnWeb')} body={translate('native.setupOnWebBody')}
        action={account.origin ? { label: translate('native.openWeb'), onPress: () => void Linking.openURL(account.origin!) } : undefined}>
        <Button label={translate('native.signOut')} icon={LogOut} kind="ghost" onPress={() => void signOut()} />
      </EmptyState>
    );
  } else if (account.phase === 'ready' && !relay.loadedAt && !relay.error) {
    body = <SkeletonRows rows={3} header={false} />;
  } else if (account.phase === 'ready' && relay.error && !relay.loadedAt) {
    body = (
      <EmptyState icon={WifiOff} title={translate('native.devicesUnavailable')} body={relay.error}
        action={{ label: translate('common.retry'), onPress: () => void refreshRelayDevices() }}>
        <Button label={translate('native.addSupervisor')} kind="ghost" onPress={onAddSupervisor} />
      </EmptyState>
    );
  } else {
    body = <EmptyState icon={MonitorSmartphone} title={translate('native.noDevices')} body={translate('native.noDevicesBody')} action={{ label: translate('native.addSupervisor'), onPress: onAddSupervisor }} />;
  }
  return <View style={{ flex: 1, backgroundColor: t.c.bg, paddingTop: insets.top, paddingBottom: insets.bottom }}>{body}</View>;
}
