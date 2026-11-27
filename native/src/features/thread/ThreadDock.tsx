// The phone one-hand dock under the composer, as the Web's: the current thread (tap for the
// thread sheet, swipe sideways for the neighbouring thread), Chat | Files, and More (the
// thread's menu with Git) — all in thumb reach.
import { useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector, Directions } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { FolderOpen, GitBranch, ChevronsUpDown, MessageSquare, MoreHorizontal } from 'lucide-react-native';
import { AppText } from '../../design/AppText';
import { Press } from '../../design/Press';
import { Sheet } from '../../design/Sheet';
import { StatusMark } from '../../design/StatusMark';
import { useTheme } from '../../design/theme';
import { haptic } from '../../design/haptics';
import { translate } from '../../i18n';
import { useDeviceData } from '../../state/deviceData';
import { threadNavStatus } from '../threads/ThreadList';
import { relativeTime } from '../threads/time';
import type { InspectorPane } from '../inspector/Inspector';

export function ThreadDock({ deviceKey, threadId, onInspector, onSwitch, onMore }: { deviceKey: string; threadId: string; onInspector: (p: InspectorPane) => void; onSwitch: (threadId: string) => void; onMore?: () => void }) {
  const t = useTheme();
  const data = useDeviceData(deviceKey);
  const [open, setOpen] = useState(false);
  const threads = data.threads.filter(th => !th.parentThreadId && !th.closedAt).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  const index = threads.findIndex(th => th.id === threadId);
  const current = threads[index];
  const go = (delta: number) => { const next = threads[index + delta]; if (next) { haptic.selection(); onSwitch(next.id); } };
  const fling = Gesture.Race(
    Gesture.Fling().direction(Directions.LEFT).onEnd(() => runOnJS(go)(1)),
    Gesture.Fling().direction(Directions.RIGHT).onEnd(() => runOnJS(go)(-1)),
  );
  // The Web's phone dock (phone-dock.css): the thread pill, the Chat | Files switcher and More.
  const pill = { borderWidth: 1, borderColor: t.c.border, backgroundColor: t.c.panel };
  const segment = (Icon: typeof GitBranch, label: string, active: boolean, onPress: () => void) => (
    <Press onPress={onPress} feedback="dim" accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={label}
      style={{ width: 44, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: t.terminal ? 0 : 12,
        backgroundColor: active ? t.c.muted : 'transparent', ...(active ? { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : null) }}>
      <Icon size={20} color={active ? t.c.fg : t.c.fgSoft} />
    </Press>
  );
  const status = current ? threadNavStatus(deviceKey, current, data.waiting[current.id] ?? 0, false) : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 4 }}>
      <GestureDetector gesture={fling}>
        <Press onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${translate('native.threads')}: ${current?.title ?? ''}`} accessibilityHint={translate('native.dockHint')}
          style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 10, borderRadius: t.terminal ? 0 : 13, ...pill }}>
          {status ? <StatusMark status={status} size={10} /> : null}
          <AppText variant="subhead" weight="semibold" numberOfLines={1} style={{ flex: 1, fontSize: 14 }}>{current?.title ?? ''}</AppText>
          <ChevronsUpDown size={16} color={t.c.fgMuted} />
        </Press>
      </GestureDetector>
      <View accessibilityRole="tablist" accessibilityLabel={translate('workbench.phoneDockPanes')} style={{ flexDirection: 'row', padding: 2, borderRadius: t.terminal ? 0 : 15, ...pill }}>
        {segment(MessageSquare, translate('workbench.chat'), true, () => undefined)}
        {segment(FolderOpen, translate('native.files'), false, () => onInspector('files'))}
      </View>
      <Press onPress={onMore ?? (() => onInspector('git'))} feedback="dim" accessibilityRole="button" accessibilityLabel={translate('native.more')}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 13 }}>
        <MoreHorizontal size={20} color={t.plum ? '#f6e9d2' : t.c.fgSoft} />
      </Press>
      <Sheet visible={open} onClose={() => setOpen(false)} title={translate('native.threads')}>
        {threads.slice(0, 30).map(th => (
          <Press key={th.id} onPress={() => { setOpen(false); if (th.id !== threadId) onSwitch(th.id); }} accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, paddingHorizontal: 8, borderRadius: t.radius.md, backgroundColor: th.id === threadId ? t.c.accentSoft : 'transparent' }}>
            <StatusMark status={threadNavStatus(deviceKey, th, data.waiting[th.id] ?? 0, false)} />
            <AppText variant="callout" numberOfLines={1} style={{ flex: 1 }}>{th.title}</AppText>
            <AppText variant="caption" tone="muted">{relativeTime(th.updatedAt)}</AppText>
          </Press>
        ))}
      </Sheet>
    </View>
  );
}
