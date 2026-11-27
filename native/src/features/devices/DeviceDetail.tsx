// One device at a glance: connection, protection, version and what runs there, with the
// actions that apply to it. Opened from a device row's ⋯ menu, a long press, or Settings.
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Activity, Lock, FolderGit2, MessagesSquare, Package, RefreshCw, ShieldCheck, Trash2, Wifi, KeyRound } from 'lucide-react-native';
import { Sheet } from '../../design/Sheet';
import { Button } from '../../design/Button';
import { AppText } from '../../design/AppText';
import { PathChip } from '../../design/Copy';
import { InfoTiles } from '../../design/InfoTiles';
import { DeviceStateMark } from '../../design/StatusMark';
import { confirmAsync, showToast } from '../../design/Overlay';
import { Row } from '../../design/List';
import { haptic } from '../../design/haptics';
import { Toggle } from '../../design/Toggle';
import { useTheme } from '../../design/theme';
import { formatDate, getLocale, translate } from '../../i18n';
import { deviceApi, devicesStore, findDevice, probeDirect, refreshRelayDevices, removeDirect, type DeviceEntry } from '../../connection/devices';
import { deviceDataStore, loadDeviceLists, wakeDevice } from '../../state/deviceData';
import { relativeTime } from '../threads/time';
import { ProtectionMark } from './ProtectionMark';

export function deviceStatusText(device: DeviceEntry) {
  if (device.online) return translate('desktopDevices.online');
  if (device.online === false) return device.lastSeenAt ? `${translate('native.offline')} · ${relativeTime(device.lastSeenAt)}` : translate('native.offline');
  return translate('workbench.statusUnavailable');
}

/** A time today, or a date with time otherwise. */
function formatSince(value: string) {
  const d = new Date(value);
  const today = new Date().toDateString() === d.toDateString();
  const clock: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: getLocale() === 'zh-CN' ? 'h23' : undefined };
  return formatDate(value, today ? clock : { month: 'short', day: 'numeric', ...clock });
}

export function reconnectDevice(device: DeviceEntry) {
  if (device.kind === 'direct') void probeDirect(device); else void refreshRelayDevices();
  wakeDevice(device.key);
}

export function DeviceDetail({ deviceKey, onClose, onOpen, onPasscode, selected }: {
  deviceKey: string | null; onClose: () => void; onOpen?: (key: string) => void; onPasscode?: (url: string) => void; selected?: boolean;
}) {
  const { c: { border, primary, muted }, radius } = useTheme();
  const device = devicesStore.useValue(() => findDevice(deviceKey));
  const data = deviceDataStore.useValue(s => (deviceKey ? s[deviceKey] : undefined));
  const [version, setVersion] = useState<string | null | undefined>(undefined);
  // Agent isolation (`api/config/agent-isolation`): null while unknown or unsupported.
  const [isolated, setIsolated] = useState<boolean | null>(null);
  const [isolationBusy, setIsolationBusy] = useState(false);

  useEffect(() => {
    if (!device) return;
    let live = true;
    setVersion(undefined);
    deviceApi(device).version().then(v => { if (live) setVersion(v.version); }, () => { if (live) setVersion(null); });
    setIsolated(null);
    if (device.online !== false) deviceApi(device).raw('/api/config/agent-isolation').then(v => { if (live) setIsolated(!!(v as { device?: boolean })?.device); }, () => undefined);
    if (!deviceDataStore.get()[device.key]?.loadedAt && device.online !== false) void loadDeviceLists(device.key);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device?.key, device?.online]);

  if (!device) return <Sheet visible={false} onClose={onClose}><View /></Sheet>;
  const loaded = !!data?.loadedAt;
  const roots = loaded ? data!.threads.filter(th => !th.parentThreadId && !th.closedAt) : [];
  const running = loaded ? data!.threads.filter(th => th.status === 'running' || th.activeTurnId).length : 0;
  const dash = '—';
  const since = device.online && device.connectedAt ? translate('devices.onlineSince', { value1: formatSince(device.connectedAt) }) : null;
  const tiles = [
    { label: translate('native.status'), icon: Wifi, accessibilityValue: deviceStatusText(device), value: (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <DeviceStateMark online={device.online} />
        <View style={{ flexShrink: 1 }}>
          <AppText variant="callout" weight="semibold" numberOfLines={2}>{deviceStatusText(device)}</AppText>
          {since ? <AppText variant="caption" tone="muted" numberOfLines={1}>{since}</AppText> : null}
        </View>
      </View>
    ) },
    ...(device.kind === 'relay' ? [{ label: translate('native.protection'), icon: ShieldCheck, value: <ProtectionMark device={device} fallback={dash} /> }] : []),
    { label: translate('devices.version'), icon: Package, value: version === undefined ? '…' : version ?? dash },
    { label: translate('native.workspaces'), icon: FolderGit2, value: loaded ? String(data!.workspaces.length) : dash },
    { label: translate('native.threads'), icon: MessagesSquare, value: loaded ? String(roots.length) : dash },
    { label: translate('native.runningNow'), icon: Activity, value: loaded ? String(running) : dash },
  ];
  const setIsolation = async (next: boolean) => {
    setIsolationBusy(true);
    const before = isolated;
    setIsolated(next);
    try { const r = await deviceApi(device).raw('/api/config/agent-isolation', { method: 'PATCH', body: JSON.stringify({ device: next }) }) as { device?: boolean }; setIsolated(!!r?.device); haptic.selection(); }
    catch (e) { setIsolated(before); showToast(String((e as Error)?.message ?? e), 'error'); }
    finally { setIsolationBusy(false); }
  };
  const remove = async () => {
    if (device.target.kind !== 'direct') return;
    if (!await confirmAsync({ title: translate('native.removeSupervisor'), message: device.name, confirmLabel: translate('native.remove'), destructive: true })) return;
    onClose();
    await removeDirect(device.target.baseUrl);
  };
  return (
    <Sheet visible={!!deviceKey} onClose={onClose} title={device.name}
      subtitle={device.shared ? translate('native.sharedWithYou') : device.kind === 'relay' ? translate('native.connectionRelay') : translate('native.connectionDirect')}
      footer={device.online !== true || (device.needsPasscode && onPasscode) || (onOpen && !selected && !device.needsPasscode) ? <>
        {device.online !== true ? <Button label={translate('native.reconnect')} icon={RefreshCw} onPress={() => reconnectDevice(device)} style={{ flex: 1 }} /> : null}
        {device.needsPasscode && device.target.kind === 'direct' && onPasscode ? <Button label={translate('native.enterPasscode')} icon={KeyRound} kind="primary" style={{ flex: 1 }}
          onPress={() => { onClose(); onPasscode((device.target as { baseUrl: string }).baseUrl); }} /> : null}
        {onOpen && !selected && !device.needsPasscode ? <Button label={translate('native.openDevice')} kind="primary" style={{ flex: 1 }} onPress={() => { onClose(); onOpen(device.key); }} /> : null}
      </> : undefined}>
      <View style={{ gap: 14, paddingTop: 4 }}>
        {device.target.kind === 'direct' ? (
          <View style={{ gap: 6 }}>
            <AppText variant="caption" tone="muted">{translate('native.address')}</AppText>
            <PathChip path={device.target.baseUrl} />
          </View>
        ) : null}
        <InfoTiles tiles={tiles} />
        {device.kind === 'relay' && !device.shared ? (
          <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: border, overflow: 'hidden' }}>
            <Row title={translate('devices.isolateDevice')} icon={Lock} numberOfLines={2} last disabled={isolated === null || device.online !== true || isolationBusy}
              subtitle={device.online !== true ? translate('devices.deviceIsolationOffline') : translate('native.isolationShort')}
              onPress={isolated === null ? undefined : () => void setIsolation(!isolated)} accessibilityLabel={translate('devices.isolateDevice')}
              trailing={<Toggle value={!!isolated} disabled={isolated === null || device.online !== true || isolationBusy} onValueChange={v => void setIsolation(v)} label={translate('devices.isolateDevice')} />} />
          </View>
        ) : null}
        {device.kind === 'direct' ? (
          <Button label={translate('native.remove')} icon={Trash2} kind="dangerOutline" size="sm" onPress={() => void remove()} style={{ alignSelf: 'flex-start', marginTop: 4 }} />
        ) : null}
        {!loaded && data?.error ? <AppText variant="footnote" tone="muted">{data.error}</AppText> : null}
      </View>
    </Sheet>
  );
}
