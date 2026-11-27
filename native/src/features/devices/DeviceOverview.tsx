// The detail pane of a wide window before a thread is chosen: instead of an empty page, the
// device at a glance (labelled counts) and the threads that want the reader first, each one
// tap away. Phones never show it: their list is the page.
import { ScrollView, View } from 'react-native';
import { Activity, FolderGit2, MessageSquarePlus, MessagesSquare } from 'lucide-react-native';
import type { ThreadDto } from '@pockymoe/shared';
import { AppText } from '../../design/AppText';
import { Button } from '../../design/Button';
import { InfoTiles } from '../../design/InfoTiles';
import { Press } from '../../design/Press';
import { DeviceStateMark, StatusMark, type NavStatus } from '../../design/StatusMark';
import { useTheme } from '../../design/theme';
import { useIconSize } from '../../design/useIconScale';
import { translate } from '../../i18n';
import { devicesStore, findDevice } from '../../connection/devices';
import { useDeviceData } from '../../state/deviceData';
import { threadNavStatus } from '../threads/ThreadList';
import { relativeTime } from '../threads/time';
import { deviceStatusText } from './DeviceDetail';

const ORDER: NavStatus[] = ['waiting', 'failed', 'running', 'agents-running', 'unread', 'interrupted'];

export function DeviceOverview({ deviceKey, onOpen, onNewThread }: { deviceKey: string; onOpen: (threadId: string) => void; onNewThread: () => void }) {
  const t = useTheme();
  const markSlot = useIconSize(12);
  const device = devicesStore.useValue(() => findDevice(deviceKey));
  const data = useDeviceData(deviceKey);
  const roots = data.threads.filter(th => !th.parentThreadId && !th.closedAt);
  const running = new Set(data.threads.filter(th => th.parentThreadId && (th.status === 'running' || th.activeTurnId)).map(th => th.rootThreadId));
  const withStatus = roots.map(th => ({ th, status: threadNavStatus(deviceKey, th, data.waiting[th.id] ?? 0, running.has(th.id)) }));
  const waiting = withStatus.filter(x => x.status === 'waiting').length;
  const active = withStatus.filter(x => x.status === 'running' || x.status === 'agents-running').length;
  // The threads that want attention first; otherwise the latest ones.
  const attention = withStatus.filter(x => ORDER.includes(x.status)).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const list: { th: ThreadDto; status: NavStatus }[] = (attention.length ? attention : withStatus.sort((a, b) => (b.th.updatedAt ?? '').localeCompare(a.th.updatedAt ?? ''))).slice(0, 6);
  const workspace = (id: string) => data.workspaces.find(w => w.id === id)?.label;
  const loaded = !!data.loadedAt;
  const dash = '—';
  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.c.bg }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}>
      <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center', gap: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <DeviceStateMark online={device?.online ?? null} size={12} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="title" numberOfLines={1} accessibilityRole="header">{device?.name ?? ''}</AppText>
            {device ? <AppText variant="footnote" tone="muted" numberOfLines={1}>{deviceStatusText(device)}</AppText> : null}
          </View>
          <Button label={translate('workbench.createThread')} icon={MessageSquarePlus} kind="primary" size="sm" onPress={onNewThread} disabled={!data.workspaces.length} />
        </View>
        <InfoTiles columns={4} tiles={[
          { label: translate('native.threads'), icon: MessagesSquare, value: loaded ? String(roots.length) : dash },
          { label: translate('native.runningNow'), icon: Activity, value: loaded ? String(active) : dash },
          { label: translate('workbench.waitingForYou'), value: (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {waiting ? <StatusMark status="waiting" /> : null}
              <AppText variant="callout" weight="semibold">{loaded ? String(waiting) : dash}</AppText>
            </View>
          ), accessibilityValue: String(waiting) },
          { label: translate('native.workspaces'), icon: FolderGit2, value: loaded ? String(data.workspaces.length) : dash },
        ]} />
        {list.length ? (
          <View style={{ gap: 2 }}>
            <AppText variant="subhead" weight="bold" tone="soft" accessibilityRole="header" style={{ marginBottom: 4 }}>
              {attention.length ? translate('native.needsAttention') : translate('workbench.recentChats')}
            </AppText>
            {list.map(({ th, status }) => (
              <Press key={th.id} onPress={() => onOpen(th.id)} accessibilityRole="button" radius={t.radius.md}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 10, borderRadius: t.radius.md }}>
                <View style={{ width: markSlot, alignItems: 'center' }}><StatusMark status={status} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <AppText variant="callout" weight="medium" numberOfLines={1}>{th.title}</AppText>
                  <AppText variant="footnote" tone="muted" numberOfLines={1}>{[workspace(th.workspaceId), relativeTime(th.updatedAt)].filter(Boolean).join(' · ')}</AppText>
                </View>
              </Press>
            ))}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}
