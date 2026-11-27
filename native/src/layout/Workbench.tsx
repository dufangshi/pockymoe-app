// The workspace shell (T3 layer 2). It alone reads the width class:
//  compact  — the list is the root; a thread pushes over it (navigation `select` = push).
//  medium   — list and thread side by side; the inspector is a sheet.
//  expanded — list, thread and an inspector column.
// Feature views (ThreadList, ThreadView, Inspector) never branch on width.
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useKeyCommand } from '../platform/keyCommands';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MessageSquarePlus, Plus } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../design/AppText';
import { Fab } from '../design/Fab';
import { Sheet } from '../design/Sheet';
import { EmptyState, Loading } from '../design/States';
import { accountStore } from '../connection/account';
import { themePrefs, useTheme } from '../design/theme';
import { haptic } from '../design/haptics';
import { translate } from '../i18n';
import { prefs } from '../platform/prefs';
import { allDevices, devicesStore } from '../connection/devices';
import { ThreadList } from '../features/threads/ThreadList';
import { ThreadView } from '../features/thread/ThreadView';
import { NewThreadView } from '../features/thread/NewThreadView';
import { DeviceList } from '../features/devices/DeviceSwitcher';
import { NoDevices } from '../features/devices/NoDevices';
import { DeviceOverview } from '../features/devices/DeviceOverview';
import { Inspector, type InspectorPane } from '../features/inspector/Inspector';
import { ThreadDock } from '../features/thread/ThreadDock';
import { createStore } from '../state/store';
import { useDeviceData } from '../state/deviceData';
import { useLayout } from './layout';
import type { RootStack } from '../navigation/routes';

export { selectionStore, selectDevice } from './selection';
import { selectionStore, selectDevice } from './selection';

export function Workbench() {
  const t = useTheme();
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const nav = useNavigation<NativeStackNavigationProp<RootStack>>();
  const sel = selectionStore.useValue(s => s);
  const devices = devicesStore.useValue(allDevices, (a, b) => a.length === b.length && a.every((d, i) => d.key === b[i]!.key && d.online === b[i]!.online));
  const [picking, setPicking] = useState(false);
  const [scrolledDown, setScrolledDown] = useState(false);
  const deviceData = useDeviceData(sel.deviceKey);
  // New thread needs a workspace to start in: hidden until the device's workspaces are known.
  const noWorkspaces = !deviceData.loadedAt || deviceData.workspaces.length === 0;

  // A saved relay device is not in the list until the relay's device list first arrives
  // (direct Supervisors are there at once): wait for it rather than switching devices.
  const relayListPending = devicesStore.useValue(s => !s.loadedAt && !s.error);
  const relaySettling = accountStore.useValue(a => a.phase === 'checking' || a.phase === 'ready');
  const relayPending = relayListPending && relaySettling && !!sel.deviceKey?.startsWith('relay:');
  // Keep a valid device selected: the saved one, else the first online, else the first.
  useEffect(() => {
    if (!devices.length || relayPending) return;
    if (sel.deviceKey && devices.some(d => d.key === sel.deviceKey)) return;
    const pick = devices.find(d => d.online) ?? devices[0]!;
    selectDevice(pick.key);
  }, [devices, sel.deviceKey, relayPending]);

  const deviceKey = sel.deviceKey && devices.some(d => d.key === sel.deviceKey) ? sel.deviceKey : null;
  // Folding or rotating to a phone width keeps the open thread: it becomes a pushed page.
  useEffect(() => {
    if (!layout.split && deviceKey && sel.threadId) { nav.push('Thread', { deviceKey, threadId: sel.threadId }); selectionStore.set({ threadId: null }); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.split]);
  const openThread = (threadId: string) => {
    if (!deviceKey) return;
    if (layout.split) selectionStore.set({ threadId, newThread: null });
    else nav.push('Thread', { deviceKey, threadId });
  };
  const newThread = (workspaceId?: string) => {
    if (!deviceKey) return;
    if (layout.split) selectionStore.set({ newThread: { workspaceId }, threadId: null });
    else nav.push('NewThread', { deviceKey, workspaceId });
  };
  // Cmd/Ctrl+N while the workbench is the page in front.
  const focused = useIsFocused();
  useKeyCommand('newThread', () => { if (!deviceKey) return false; newThread(); }, focused);
  const openInspector = (pane: InspectorPane, paths: string[] = [], turnId?: string) => selectionStore.set(s => ({ inspector: s.inspector === pane && !paths.length && !turnId ? null : pane, inspectorPaths: paths, inspectorTurnId: turnId ?? null }));

  if (!deviceKey && relayPending) return <View style={{ flex: 1, backgroundColor: t.c.bg, paddingTop: insets.top }}><Loading /></View>;
  if (!deviceKey) {
    return <NoDevices onAddSupervisor={() => nav.push('DirectConnect')} />;
  }

  const list = (
    <ThreadList deviceKey={deviceKey} selectedThreadId={layout.split ? sel.threadId : null} onOpen={openThread} onNewThread={newThread}
      onDevices={() => setPicking(true)} onSettings={() => nav.push('Settings')} onPullRequests={() => nav.push('PullRequests', { deviceKey })} compact={!layout.split} onScrollDirection={setScrolledDown} />
  );
  const picker = (
    <Sheet visible={picking} onClose={() => setPicking(false)} title={translate('auth.devices')}>
      <DeviceList selectedKey={deviceKey} onSelect={key => { haptic.selection(); selectDevice(key); setPicking(false); }} onAdd={() => { setPicking(false); nav.push('DirectConnect'); }}
        onNewThread={key => { setPicking(false); if (key !== deviceKey) selectDevice(key); if (layout.split) selectionStore.set({ newThread: {}, threadId: null }); else nav.push('NewThread', { deviceKey: key }); }} />
    </Sheet>
  );

  if (!layout.split) {
    return (
      // A phone on its side: keep the list clear of the Dynamic Island / notch (zero when upright).
      <View style={{ flex: 1, backgroundColor: t.c.bg, paddingLeft: insets.left, paddingRight: insets.right }}>
        {list}
        {/* New thread within thumb reach (one-hand layout); not before there is a workspace. */}
        {noWorkspaces ? null : <Fab icon={Plus} label={translate('workbench.createThread')} onPress={() => newThread()} extended={!scrolledDown} bottom={insets.bottom + 18} testID="new-thread" />}
        {picker}
      </View>
    );
  }

  const detail = sel.newThread ? (
    <NewThreadView key={`new:${deviceKey}`} deviceKey={deviceKey} workspaceId={sel.newThread.workspaceId} onBack={() => selectionStore.set({ newThread: null })}
      onCreated={threadId => selectionStore.set({ newThread: null, threadId })} />
  ) : sel.threadId ? (
    <ThreadView key={`${deviceKey}:${sel.threadId}`} deviceKey={deviceKey} threadId={sel.threadId} onInspector={openInspector} inspectorOpen={sel.inspector}
      onDeleted={() => selectionStore.set({ threadId: null })} />
  ) : (
    <DeviceOverview deviceKey={deviceKey} onOpen={openThread} onNewThread={() => newThread()} />
  );
  const inspector = sel.threadId && sel.inspector ? (
    <Inspector deviceKey={deviceKey} threadId={sel.threadId} pane={sel.inspector} paths={sel.inspectorPaths} turnId={sel.inspectorTurnId} onPane={p => selectionStore.set({ inspector: p })} onClose={() => selectionStore.set({ inspector: null })} />
  ) : null;
  // Medium windows have room for the page and a docked inspector, not for all three.
  const listShown = !(inspector && layout.variant === 'medium');
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.c.chrome, paddingLeft: layout.landscape ? insets.left : 0, paddingRight: layout.landscape ? insets.right : 0 }}>
      {listShown ? <View style={{ width: layout.listWidth, borderRightWidth: 1, borderRightColor: t.c.border }}>{list}</View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>{detail}</View>
      {inspector ? (
        <View accessibilityRole="none" style={{ width: layout.inspectorWidth, borderLeftWidth: 1, borderLeftColor: t.c.border, backgroundColor: t.c.panel, paddingTop: insets.top, paddingBottom: insets.bottom }}>{inspector}</View>
      ) : null}
      {picker}
    </View>
  );
}

/** A thread pushed on a phone, with the one-hand dock under its composer. */
export function ThreadScreen({ deviceKey, threadId }: { deviceKey: string; threadId: string }) {
  const nav = useNavigation<NativeStackNavigationProp<RootStack>>();
  const oneHand = themePrefs.useValue(s => s.oneHand);
  const [inspector, setInspector] = useState<{ pane: InspectorPane; paths: string[]; turnId?: string } | null>(null);
  const layout = useLayout();
  // Unfolding or rotating to a wide window shows this thread in the detail column instead.
  useEffect(() => {
    if (layout.split) { selectionStore.set({ deviceKey, threadId }); nav.goBack(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.split]);
  const open = (pane: InspectorPane, paths: string[] = [], turnId?: string) => setInspector({ pane, paths, ...(turnId ? { turnId } : {}) });
  return (
    <>
      <ThreadView deviceKey={deviceKey} threadId={threadId} onBack={() => { if (nav.canGoBack()) nav.goBack(); }} onInspector={open} inspectorOpen={inspector?.pane ?? null}
        onDeleted={() => { if (nav.canGoBack()) nav.goBack(); }}
        // The one-hand dock is for a phone held upright; on its side the height goes to the thread.
        dock={oneHand && !layout.landscape ? <ThreadDock deviceKey={deviceKey} threadId={threadId} onInspector={open} onSwitch={id => nav.replace('Thread', { deviceKey, threadId: id })} /> : undefined} />
      <Sheet visible={!!inspector} onClose={() => setInspector(null)} tall scroll={false} header={false}>
        {inspector ? <Inspector deviceKey={deviceKey} threadId={threadId} pane={inspector.pane} paths={inspector.paths} turnId={inspector.turnId ?? null} onPane={p => setInspector({ pane: p, paths: [] })} onClose={() => setInspector(null)} /> : null}
      </Sheet>
    </>
  );
}
