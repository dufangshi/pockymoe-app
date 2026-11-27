// Devices of the account and saved Supervisors, each with its connection mark and, for
// relay devices, protection (shield, §6: a separate dimension from connection).
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { View } from 'react-native';
import { ArrowRight, Check, Folder, List, Lock, Plus, Laptop, Cloud, Info, MoreHorizontal, RefreshCw, Trash2, Copy as CopyIcon } from 'lucide-react-native';
import { Globe as GlobeIcon } from 'lucide-react-native';
import { IconButton } from '../../design/Button';
import { confirmAsync, showMenu, type Anchor } from '../../design/Overlay';
import { AppText } from '../../design/AppText';
import { Press } from '../../design/Press';
import { DeviceStateMark } from '../../design/StatusMark';
import { useTheme } from '../../design/theme';
import { useIconSize } from '../../design/useIconScale';
import { translate } from '../../i18n';
import { allDevices, devicesStore, isolationStore, loadIsolation, removeDirect, type DeviceEntry } from '../../connection/devices';
import { deviceDataStore, loadDeviceLists, type DeviceData } from '../../state/deviceData';
import { StatusMark } from '../../design/StatusMark';
import { DeviceDetail, deviceStatusText, reconnectDevice } from './DeviceDetail';
import { ProtectionMark } from './ProtectionMark';

export { ProtectionMark };

/** The menu every device row opens from ⋯ or a long press (§3: one menu, three ways in). */
/** The Web's device menu order: Open, New thread, Device details, then what applies here. */
export function deviceMenu(device: DeviceEntry, onDetails: () => void, anchor?: Anchor, go?: { onOpen?: () => void; onNewThread?: () => void }) {
  showMenu({ anchor, title: device.name, items: [
    ...(go?.onOpen ? [{ label: translate('devices.open'), icon: ArrowRight, onPress: go.onOpen }] : []),
    ...(go?.onNewThread ? [{ label: translate('workbench.createThread'), icon: Plus, onPress: go.onNewThread }] : []),
    { label: translate('native.deviceDetails'), icon: Info, onPress: onDetails },
    ...(device.online !== true ? [{ label: translate('native.reconnect'), icon: RefreshCw, onPress: () => reconnectDevice(device) }] : []),
    ...(device.target.kind === 'direct' ? [
      { label: translate('native.copyAddress'), icon: CopyIcon, copy: device.target.baseUrl },
      { label: translate('native.removeEllipsis'), icon: Trash2, destructive: true, onPress: async () => {
        if (device.target.kind !== 'direct') return;
        if (await confirmAsync({ title: translate('native.removeSupervisor'), message: device.name, confirmLabel: translate('native.remove'), destructive: true })) await removeDirect(device.target.baseUrl);
      } },
    ] : []),
  ] });
}

/** The Web device card's counts: running, waiting for you, workspaces, threads (DeviceCard). */
export function deviceCounts(data: DeviceData) {
  const roots = data.threads.filter(th => !th.parentThreadId && !th.closedAt);
  return {
    running: roots.filter(th => th.status === 'running' || th.activeTurnId).length,
    attention: roots.filter(th => (data.waiting[th.id] ?? 0) > 0).length,
    workspaces: data.workspaces.length,
    threads: roots.length,
  };
}

function DeviceCounts({ running, attention, workspaces, threads }: ReturnType<typeof deviceCounts>) {
  const t = useTheme();
  const item = (mark: ReactNode, value: number, label: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }} accessible accessibilityLabel={`${label}: ${value}`}>{mark}<AppText variant="footnote" weight="semibold" tone="soft">{value}</AppText></View>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 2 }}>
      {item(<StatusMark status={running ? 'running' : 'idle'} size={10} />, running, running ? translate('desktopDevices.running') : translate('desktopDevices.noneRunning'))}
      {item(<StatusMark status={attention ? 'waiting' : 'idle'} size={10} />, attention, attention ? translate('desktopDevices.needsYou') : translate('desktopDevices.noneWaiting'))}
      {item(<Folder size={12} color={t.c.fgMuted} />, workspaces, translate('desktopDevices.workspaces', { count: workspaces }))}
      {item(<List size={12} color={t.c.fgMuted} />, threads, translate('desktopDevices.threads', { count: threads }))}
    </View>
  );
}

/** The Web's isolation mark: a lock and "Isolated" in a bordered pill. */
function IsolatedPill() {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, height: 20, borderRadius: t.radius.pill, borderWidth: 1, borderColor: t.c.borderStrong }}>
      <Lock size={11} color={t.c.fgSoft} />
      <AppText variant="caption" tone="soft">{translate('devices.deviceIsolated')}</AppText>
    </View>
  );
}

export function DeviceRow({ device, selected, onPress, onMore, role = 'radio' }: { device: DeviceEntry; selected?: boolean; onPress: () => void; onMore?: (anchor?: Anchor) => void; role?: 'radio' | 'button' }) {
  const t = useTheme();
  const glyph = useIconSize(18);
  const box = useIconSize(34);
  const Icon = device.kind === 'direct' ? Laptop : Cloud;
  const moreRef = useRef<ComponentRef<typeof View>>(null);
  const more = () => moreRef.current?.measureInWindow((x, y, width, height) => onMore?.({ x, y, width, height }));
  const isolated = isolationStore.useValue(s => s[device.key] ?? false);
  const data = deviceDataStore.useValue(s => s[device.key]);
  const counts = data?.loadedAt ? deviceCounts(data) : null;
  const status = device.online === null && device.target.kind === 'direct' ? device.target.baseUrl.replace(/^https?:\/\//, '') : deviceStatusText(device);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: t.radius.md, backgroundColor: selected ? t.c.accentSoft : 'transparent' }}>
      <Press onPress={onPress} onLongPress={onMore ? more : undefined} accessibilityRole={role} accessibilityState={role === 'radio' ? { checked: !!selected } : undefined}
        accessibilityLabel={[device.name, status, device.shared ? translate('native.sharedWithYou') : null].filter(Boolean).join(', ')} testID={`device-${device.name}`}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingLeft: 10, paddingRight: onMore ? 0 : 10, borderRadius: t.radius.md }}>
        <View style={{ width: box, height: box, borderRadius: t.radius.md, backgroundColor: t.c.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={glyph} color={t.c.fgSoft} />
          <View style={{ position: 'absolute', right: -2, bottom: -2, backgroundColor: t.c.sheet, borderRadius: 7, padding: 2 }}><DeviceStateMark online={device.online} size={9} /></View>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <AppText variant="callout" weight="medium" numberOfLines={1} style={{ flexShrink: 1 }}>{device.name}</AppText>
            {isolated ? <IsolatedPill /> : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <AppText variant="footnote" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>{status}</AppText>
            <ProtectionMark device={device} />
          </View>
          {counts ? <DeviceCounts {...counts} /> : null}
        </View>
        {selected ? <Check size={18} color={t.c.accentStrong} /> : null}
      </Press>
      {onMore ? <View ref={moreRef} collapsable={false}><IconButton icon={MoreHorizontal} label={`${translate('native.moreActions')}: ${device.name}`} onPress={more} /></View> : null}
    </View>
  );
}

/** A small group title inside a sheet or card. */
function GroupTitle({ title }: { title: string }) {
  return <AppText variant="footnote" weight="semibold" tone="muted" style={{ paddingHorizontal: 10, paddingTop: 10, paddingBottom: 2 }} accessibilityRole="header">{title}</AppText>;
}

/** Devices grouped by how they are reached; titles appear only when there is more than one group. */
export function groupDevices(devices: DeviceEntry[]) {
  const groups = [
    { key: 'own', title: translate('native.yourDevices'), items: devices.filter(d => d.kind === 'relay' && !d.shared) },
    { key: 'shared', title: translate('native.sharedWithYou'), items: devices.filter(d => d.shared) },
    { key: 'direct', title: translate('native.thisNetwork'), items: devices.filter(d => d.kind === 'direct') },
  ].filter(g => g.items.length);
  return { groups, titled: groups.length > 1 };
}

export function DeviceList({ selectedKey, onSelect, onAdd, onAddRelay, onPasscode, onNewThread }: { selectedKey: string | null; onSelect: (key: string) => void; onAdd: () => void; /** Shown while no relay account is set up (D11). */ onAddRelay?: () => void; onPasscode?: (url: string) => void; onNewThread?: (key: string) => void }) {
  const t = useTheme();
  const devices = devicesStore.useValue(allDevices, (a, b) => a.length === b.length && a.every((d, i) => d === b[i]));
  const [detail, setDetail] = useState<string | null>(null);
  const { groups, titled } = groupDevices(devices);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    loadIsolation(devices);
    // Counts for every online device, as the Web cards show them (lists load once and stay cached).
    for (const d of devices) if (d.online && !deviceDataStore.get()[d.key]?.loadedAt) void loadDeviceLists(d.key);
  }, [devices.map(d => `${d.key}:${d.online}`).join()]);
  return (
    <View>
      {groups.map(g => (
        <View key={g.key}>
          {titled ? <GroupTitle title={g.title} /> : null}
          {g.items.map(d => <DeviceRow key={d.key} device={d} selected={d.key === selectedKey} onPress={() => onSelect(d.key)} onMore={anchor => deviceMenu(d, () => setDetail(d.key), anchor, { onOpen: () => onSelect(d.key), onNewThread: onNewThread ? () => onNewThread(d.key) : undefined })} />)}
        </View>
      ))}
      <Press onPress={onAdd} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, paddingHorizontal: 10, marginTop: titled ? 6 : 0, borderRadius: t.radius.md }}>
        <View style={{ width: 34, alignItems: 'center' }}><Plus size={18} color={t.c.accentStrong} /></View>
        <AppText variant="callout" tone="accent">{translate('native.addSupervisor')}</AppText>
      </Press>
      {onAddRelay ? (
        <Press onPress={onAddRelay} accessibilityRole="button" testID="add-relay" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, paddingHorizontal: 10, borderRadius: t.radius.md }}>
          <View style={{ width: 34, alignItems: 'center' }}><GlobeIcon size={18} color={t.c.accentStrong} /></View>
          <AppText variant="callout" tone="accent">{translate('native.relayAccount')}</AppText>
        </Press>
      ) : null}
      <DeviceDetail deviceKey={detail} onClose={() => setDetail(null)} selected={detail === selectedKey} onOpen={onSelect} onPasscode={onPasscode} />
    </View>
  );
}
