// The thread list of one device: search, starred, recent, then workspaces. Every row
// carries the one status mark (§6) in a fixed slot. A tap selects (wide windows) or
// pushes (phones); long press and ⋯ open the same menu.
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { LayoutAnimation, RefreshControl, ScrollView, TextInput, View, type GestureResponderEvent } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { GitPullRequest, ChevronDown, ChevronRight, ChevronsUpDown, Bot, User, ExternalLink, LogOut, MonitorSmartphone, FolderGit2, FolderPlus, MoreHorizontal, WifiOff, Plus, MessageSquarePlus, Search, Settings, Star, X, Pencil, Trash2, Copy as CopyIcon } from 'lucide-react-native';
import type { ThreadDto, WorkspaceDto } from '@pockymoe/shared';
import { AppBar } from '../../design/AppBar';
import { AppText } from '../../design/AppText';
import { IconButton } from '../../design/Button';
import { Press } from '../../design/Press';
import { DeviceStateMark, StatusMark, navigationStatusLabel, type NavStatus } from '../../design/StatusMark';
import { AgentAvatar } from '../../design/AgentAvatar';
import { Banner, EmptyState, SkeletonRows } from '../../design/States';
import { ErrorMark } from '../../design/ErrorMark';
import { AccountAvatar } from '../../design/AccountAvatar';
import { accountStore, signOut } from '../../connection/account';
import { useIconSize } from '../../design/useIconScale';
import { Highlight, aroundMatch } from '../../design/Highlight';
import { confirmAsync, showMenu, showToast, type Anchor } from '../../design/Overlay';
import { useTheme } from '../../design/theme';
import { translate } from '../../i18n';
import { deviceApi, devicesStore, findDevice } from '../../connection/devices';
import { loadDeviceLists, removeThread, retainDevice, upsertThread, useDeviceData, wakeDevice } from '../../state/deviceData';
import { draftPreview, draftStore } from '../thread/Composer';
import { threadKey } from '../../state/threadDetail';
import type { SearchMatch } from '../../protocol/api';
import { isUnread, referenceFor, referencesStore, refreshReferences, toggleStar } from './references';
import { RenameSheet } from './RenameSheet';
import { AddWorkspaceSheet } from '../workspaces/AddWorkspaceSheet';
import { useDelayed } from '../../design/useDelayed';
import { useKeyCommand } from '../../platform/keyCommands';
import { useIsFocused } from '@react-navigation/native';
import { threadAgentKey } from '../../protocol/agentKey';

/** Search reports the reader's own messages as "You" (older Supervisors: "User"). */
const isPromptRole = (role: string | undefined) => role === 'You' || role?.toLowerCase() === 'user';

/** A menu opened by a tap is anchored where the finger was (the ⋯ button under it). */
const tapAnchor = (e: GestureResponderEvent) => ({ x: e.nativeEvent.pageX - 20, y: e.nativeEvent.pageY - 20, width: 40, height: 40 });

export function threadNavStatus(deviceKey: string, thread: ThreadDto, waiting: number, childRunning: boolean): NavStatus {
  if (waiting > 0) return 'waiting';
  if (thread.status === 'running' || thread.activeTurnId) return 'running';
  if (childRunning) return 'agents-running';
  if (thread.status === 'failed' || thread.status === 'system_error') return 'failed';
  if (thread.status === 'interrupted') return 'interrupted';
  if (isUnread(deviceKey, thread)) return 'unread';
  return 'idle';
}

type Row =
  | { type: 'header'; key: string; title: string; workspace?: WorkspaceDto; collapsed?: boolean; count?: number }
  | { type: 'thread'; key: string; thread: ThreadDto; workspace?: WorkspaceDto }
  | { type: 'more'; key: string; workspace: WorkspaceDto; hidden: number }
  | { type: 'match'; key: string; match: SearchMatch };

export interface ThreadListProps {
  deviceKey: string;
  selectedThreadId?: string | null;
  onOpen: (threadId: string) => void;
  onNewThread: (workspaceId?: string) => void;
  onDevices: (anchor?: Anchor) => void;
  onSettings: () => void;
  /** The device's pull requests page (owner devices only). */
  onPullRequests?: () => void;
  /** Phones put New thread in a floating button, wide windows in the bar. */
  compact: boolean;
  /** true while the reader scrolls down (the phone's New thread button folds to its icon). */
  onScrollDirection?: (down: boolean) => void;
}

export function ThreadList({ deviceKey, selectedThreadId, onOpen, onNewThread, onDevices, onSettings, onPullRequests, compact, onScrollDirection }: ThreadListProps) {
  const lastY = useRef(0);
  const small = useIconSize(15);
  const markSlot = useIconSize(12);
  const rowTag = useIconSize(16);
  const settleDirection = (y: number) => {
    if (!onScrollDirection) return;
    if (y < 24 || y < lastY.current - 16) onScrollDirection(false); else if (y > lastY.current + 16) onScrollDirection(true);
  };
  const t = useTheme();
  const data = useDeviceData(deviceKey);
  const device = devicesStore.useValue(() => findDevice(deviceKey));
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [matches, setMatches] = useState<SearchMatch[] | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [renaming, setRenaming] = useState<ThreadDto | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = <RefreshControl refreshing={refreshing} tintColor={t.c.primary} colors={[t.c.primary]} onRefresh={async () => { setRefreshing(true); await Promise.all([loadDeviceLists(deviceKey), refreshReferences()]); setRefreshing(false); }} />;
  const [adding, setAdding] = useState(false);
  const searchRef = useRef<ComponentRef<typeof TextInput>>(null);
  useKeyCommand('search', () => { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 50); }, useIsFocused());
  useEffect(() => retainDevice(deviceKey), [deviceKey]);
  useEffect(() => { void refreshReferences(); }, [deviceKey]);

  // Full-text search on the device, debounced; titles filter locally at once.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || !device) { setMatches(null); return; }
    let live = true;
    const timer = setTimeout(() => { deviceApi(device).search(q).then(r => { if (live) setMatches(r.matches); }, () => { if (live) setMatches([]); }); }, 280);
    return () => { live = false; clearTimeout(timer); };
  }, [query, device]);

  const rows = useMemo<Row[]>(() => {
    const roots = data.threads.filter(th => !th.parentThreadId && !th.closedAt);
    const byWorkspace = new Map(data.workspaces.map(w => [w.id, w]));
    const sorted = [...roots].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    const q = query.trim().toLowerCase();
    const out: Row[] = [];
    if (q) {
      const titled = sorted.filter(th => th.title.toLowerCase().includes(q));
      if (titled.length) { out.push({ type: 'header', key: 'h:titles', title: translate('native.threads') }); titled.forEach(th => out.push({ type: 'thread', key: `t:${th.id}`, thread: th, workspace: byWorkspace.get(th.workspaceId) })); }
      const messageMatches = (matches ?? []).filter(m => m.kind === 'message');
      if (messageMatches.length) { out.push({ type: 'header', key: 'h:messages', title: translate('native.messages') }); messageMatches.slice(0, 40).forEach((m, i) => out.push({ type: 'match', key: `m:${i}:${m.threadId}:${m.itemId}`, match: m })); }
      return out;
    }
    const starred = sorted.filter(th => referenceFor(deviceKey, th.id)?.favorite);
    if (starred.length) { out.push({ type: 'header', key: 'h:starred', title: translate('workbench.shortcuts') }); starred.forEach(th => out.push({ type: 'thread', key: `s:${th.id}`, thread: th, workspace: byWorkspace.get(th.workspaceId) })); }
    // Recent earns its place only when the workspaces below are long.
    // ...and only when threads span several workspaces; otherwise it repeats the one below.
    const spread = new Set(sorted.map(th => th.workspaceId)).size > 1;
    const recent = sorted.length > 8 && spread ? sorted.slice(0, 5).filter(th => !starred.includes(th)) : [];
    if (recent.length) { out.push({ type: 'header', key: 'h:recent', title: translate('workbench.recentChats') }); recent.forEach(th => out.push({ type: 'thread', key: `r:${th.id}`, thread: th, workspace: byWorkspace.get(th.workspaceId) })); }
    const workspaces = [...data.workspaces].sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''));
    for (const w of workspaces) {
      const list = sorted.filter(th => th.workspaceId === w.id);
      const isCollapsed = collapsed[w.id] ?? false;
      out.push({ type: 'header', key: `w:${w.id}`, title: w.label, workspace: w, collapsed: isCollapsed, count: list.length });
      if (isCollapsed) continue;
      const limit = expanded[w.id] ? list.length : 6;
      list.slice(0, limit).forEach(th => out.push({ type: 'thread', key: `w:${w.id}:${th.id}`, thread: th, workspace: w }));
      if (list.length > limit) out.push({ type: 'more', key: `more:${w.id}`, workspace: w, hidden: list.length - limit });
    }
    return out;
  }, [data.threads, data.workspaces, query, matches, collapsed, expanded, deviceKey]);

  const childRunning = useMemo(() => {
    const set = new Set<string>();
    for (const th of data.threads) if (th.parentThreadId && (th.status === 'running' || th.activeTurnId) && th.rootThreadId) set.add(th.rootThreadId);
    return set;
  }, [data.threads]);
  const references = referencesStore.useValue(s => s);
  const drafts = draftStore.useValue(s => s);
  const rowState = useMemo(() => ({ waiting: data.waiting, threads: data.threads, selectedThreadId, references, drafts, query }), [data.waiting, data.threads, selectedThreadId, references, drafts, query]);
  const childCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const th of data.threads) if (th.rootThreadId && th.parentThreadId && !th.closedAt) map.set(th.rootThreadId, (map.get(th.rootThreadId) ?? 0) + 1);
    return map;
  }, [data.threads]);

  const workspaceMenu = (w: WorkspaceDto, anchor?: Anchor) => showMenu({ anchor, title: w.label, items: [
    { label: translate('workbench.createThread'), icon: MessageSquarePlus, onPress: () => onNewThread(w.id) },
    { label: w.isFavorite ? translate('native.unpinWorkspace') : translate('native.pinWorkspace'), icon: Star, onPress: async () => {
      try { await deviceApi(device!).favoriteWorkspace(w.id, !w.isFavorite); await loadDeviceLists(deviceKey); } catch (e) { showToast(String((e as Error)?.message ?? e), 'error'); }
    } },
    ...(w.absPath ? [{ label: translate('files.copyAbsolutePath'), icon: CopyIcon, copy: w.absPath }] : []),
  ] });

  const threadMenu = (thread: ThreadDto, workspace: WorkspaceDto | undefined, anchor?: Anchor) => showMenu({ anchor, title: thread.title, items: [
    { label: referenceFor(deviceKey, thread.id)?.favorite ? translate('workbench.unstarThread') : translate('workbench.starThread'), icon: Star, onPress: () => void toggleStar(deviceKey, thread, workspace?.label ?? '') },
    // The Web's thread menu, in its order (Share and the Codex link are Web-only for now).
    { label: translate('workbench.openThread'), icon: ExternalLink, onPress: () => onOpen(thread.id) },
    { label: translate('native.copyThreadId'), icon: CopyIcon, copy: thread.id },
    ...(thread.providerSessionId ? [{ label: translate('workbench.copyHarnessSessionID'), icon: CopyIcon, copy: thread.providerSessionId }] : []),
    { label: translate('workbench.renameThread'), icon: Pencil, onPress: () => setRenaming(thread) },
    { label: translate('native.deleteThread'), icon: Trash2, destructive: true, onPress: async () => {
      if (!await confirmAsync({ title: translate('native.deleteThreadTitle'), message: thread.title, confirmLabel: translate('native.delete'), destructive: true })) return;
      try { await deviceApi(device!).deleteThread(thread.id); removeThread(deviceKey, thread.id); } catch (e) { showToast(String((e as Error)?.message ?? e), 'error'); }
    } },
  ] });

  const renderRow = ({ item }: { item: Row }) => {
    if (item.type === 'header') {
      if (!item.workspace) return <AppText variant="subhead" weight="semibold" tone="soft" style={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 4 }} accessibilityRole="header">{t.terminal ? `# ${item.title}` : item.title}</AppText>;
      const w = item.workspace;
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 10, paddingRight: 4, paddingTop: 6 }}>
          <Press onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeInEaseOut', 'opacity')); setCollapsed(c => ({ ...c, [w.id]: !item.collapsed })); }} onLongPress={() => workspaceMenu(w)} accessibilityRole="button" accessibilityState={{ expanded: !item.collapsed }}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 6, borderRadius: t.radius.sm }}>
            {item.collapsed ? <ChevronRight size={small} color={t.c.fgMuted} /> : <ChevronDown size={small} color={t.c.fgMuted} />}
            <FolderGit2 size={small} color={t.c.fgSoft} />
            <AppText variant="subhead" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{w.label}</AppText>
            {w.isFavorite ? <Star size={12} color={t.c.waiting} fill={t.c.waiting} /> : null}
            {item.count ? <AppText variant="caption" tone="muted" accessibilityLabel={translate('native.threadCount', { count: item.count })}>{item.count}</AppText> : null}
          </Press>
          <IconButton icon={MessageSquarePlus} size={17} label={`${translate('workbench.createThread')}: ${w.label}`} onPress={() => onNewThread(w.id)} />
          <IconButton icon={MoreHorizontal} size={17} label={`${translate('native.moreActions')}: ${w.label}`} onPress={e => workspaceMenu(w, tapAnchor(e))} />
        </View>
      );
    }
    if (item.type === 'more') return (
      // An expandable row starts with its chevron (§5), lined up with the thread titles.
      <Press onPress={() => setExpanded(e => ({ ...e, [item.workspace.id]: true }))} accessibilityRole="button" accessibilityState={{ expanded: false }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingLeft: 40, marginHorizontal: 6, borderRadius: t.radius.md }}>
        <ChevronDown size={small} color={t.c.accentStrong} />
        <AppText variant="subhead" tone="accent">{translate('native.showMoreCount', { count: item.hidden })}</AppText>
      </Press>
    );
    if (item.type === 'match') {
      const m = item.match;
      return (
        <Press onPress={() => onOpen(m.threadId)} style={{ flexDirection: 'row', gap: 10, paddingLeft: 18, paddingRight: 12, paddingVertical: 8, marginHorizontal: 6, borderRadius: t.radius.md }} accessibilityRole="button"
          accessibilityLabel={`${m.threadTitle}, ${isPromptRole(m.role) ? translate('native.yourPrompt') : translate('native.agentReply')}: ${m.text}`}>
          {/* Whose words matched: your prompt or the agent's reply. */}
          <View style={{ width: markSlot, paddingTop: 3, alignItems: 'center' }}>{isPromptRole(m.role) ? <User size={13} color={t.c.fgMuted} /> : <Bot size={13} color={t.c.fgMuted} />}</View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <AppText variant="subhead" weight="semibold" numberOfLines={1}>{m.threadTitle}</AppText>
            <Highlight variant="footnote" tone="muted" numberOfLines={2} text={aroundMatch(m.text, query)} query={query} />
          </View>
        </Press>
      );
    }
    const th = item.thread;
    const status = threadNavStatus(deviceKey, th, data.waiting[th.id] ?? 0, childRunning.has(th.id));
    const draft = draftPreview(threadKey(deviceKey, th.id));
    const selected = th.id === selectedThreadId;
    const children = childCount.get(th.id) ?? 0;
    const starred = !!referenceFor(deviceKey, th.id)?.favorite;
    // Like the Web's thread rows: the title alone; shortcuts and recent rows name their
    // workspace, and a draft replaces the second line. Read, idle threads are quieter.
    const subtitle = draft ? null : item.type === 'thread' && !item.key.startsWith('w:') ? item.workspace?.label ?? null : null;
    const quiet = status === 'idle';
    const weight = status === 'unread' ? 'bold' as const : quiet ? 'regular' as const : 'medium' as const;
    const titleColor = quiet ? t.c.fgSoft : t.c.fg;
    return (
      <Press onPress={() => onOpen(th.id)} onLongPress={() => threadMenu(th, item.workspace)} testID={`thread-${th.id}`}
        accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={[th.title, navigationStatusLabel(status), draft ? `${translate('native.draft')}: ${draft}` : subtitle, children ? translate('native.agentThreadCount', { count: children }) : null, starred ? translate('native.starred') : null].filter(Boolean).join(', ')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingVertical: 5, paddingLeft: 18, paddingRight: 12, marginHorizontal: 6, borderRadius: t.radius.md,
          backgroundColor: selected ? t.c.accentSoft : 'transparent' }}>
        {/* As the Web packs: Classic shows only the mark; Plum Pocket its round avatar and
            Terminal its 16 pt key-cap tag before the title. Beside an emblem an idle mark is
            hidden but keeps its slot, so titles stay aligned (§6). */}
        <View style={{ width: markSlot, alignItems: 'center', opacity: (t.plum || t.terminal) && status === 'idle' ? 0 : 1 }}
          accessibilityElementsHidden={(t.plum || t.terminal) && status === 'idle'}><StatusMark status={status} /></View>
        {t.plum || t.terminal ? <AgentAvatar agent={threadAgentKey(th) ?? th.provider} size={t.terminal ? rowTag : 26} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          {query.trim() ? <Highlight variant="callout" weight={weight} color={titleColor} numberOfLines={1} text={th.title} query={query} />
            : <AppText variant="callout" weight={weight} color={titleColor} numberOfLines={1}>{th.title}</AppText>}
          {draft ? <AppText variant="footnote" tone="accent" numberOfLines={1}>{`${translate('native.draft')}: ${draft}`}</AppText>
            : subtitle ? <AppText variant="footnote" tone="muted" numberOfLines={1}>{subtitle}</AppText> : null}
        </View>
        {/* Agent threads: the robot and the count in secondary text, the robot in the run colour while one runs (§7). */}
        {children ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }} accessible={false}>
            <Bot size={14} color={childRunning.has(th.id) ? t.c.running : t.c.fgSoft} />
            <AppText variant="caption" tone="soft">{children}</AppText>
          </View>
        ) : null}
        {starred ? <Star size={13} color={t.c.waiting} fill={t.c.waiting} /> : null}
        {/* §3: the object menu has a ⋯ button that is always visible on touch, besides long press. */}
        <IconButton icon={MoreHorizontal} size={17} tone="muted" label={`${translate('native.moreActions')}: ${th.title}`} onPress={e => threadMenu(th, item.workspace, tapAnchor(e))} style={{ marginRight: -6 }} />
      </Press>
    );
  };

  const live = data.live;
  const disconnected = useDelayed(live === 'offline' || live === 'retrying');
  const title = device?.name ?? translate('native.noDevice');
  const devicesRef = useRef<ComponentRef<typeof View>>(null);
  const openDevices = () => devicesRef.current?.measureInWindow((x, y, width, height) => onDevices({ x, y, width, height }));
  const account = accountStore.useValue(s => s);
  const avatarRef = useRef<ComponentRef<typeof View>>(null);
  // The Web's account menu: who is signed in, then Settings, Device management and Log out.
  const openAccountMenu = () => avatarRef.current?.measureInWindow((x, y, width, height) => showMenu({
    anchor: { x, y, width, height }, title: account.user?.username ?? undefined, subtitle: account.user?.email ?? undefined, items: [
      { label: translate('workbench.settings'), icon: Settings, onPress: onSettings },
      { label: translate('files.deviceManagement'), icon: MonitorSmartphone, onPress: () => onDevices() },
      { label: translate('auth.logOut'), icon: LogOut, destructive: true, onPress: async () => {
        if (await confirmAsync({ title: translate('auth.logOut'), message: translate('native.signOutBody'), confirmLabel: translate('auth.logOut'), destructive: true })) await signOut();
      } },
    ] }));
  return (
    <View style={{ flex: 1, backgroundColor: compact ? t.c.bg : t.c.chrome === t.c.bg ? t.c.panel : t.c.bg }}>
      <AppBar
        center={
          <View ref={devicesRef} collapsable={false} style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
            <Press onPress={openDevices} feedback="dim" accessibilityRole="button" accessibilityLabel={`${translate('native.switchDevice')}: ${title}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6, height: 40, maxWidth: '100%', borderRadius: t.radius.md }}>
              <DeviceStateMark online={device?.online ?? null} />
              <AppText variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>{title}</AppText>
              <ChevronsUpDown size={15} color={t.c.fgMuted} />
            </Press>
          </View>
        }
        trailing={<>
          <IconButton icon={Search} label={translate('chat.search')} onPress={() => { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 50); }} />
          {onPullRequests && !device?.shared ? <IconButton icon={GitPullRequest} label={translate('review.pullRequests')} onPress={onPullRequests} testID="pull-requests" /> : null}
          {!compact ? <IconButton icon={MessageSquarePlus} label={translate('workbench.createThread')} onPress={() => onNewThread()} testID="new-thread" /> : null}
          {/* A relay account is reached from its avatar, as on the Web; a local setup keeps the gear (§1). */}
          {account.phase === 'ready' && account.user ? (
            <AccountAvatar ref={avatarRef} name={account.user.username ?? account.user.email ?? ''} testID="account"
              label={translate('native.accountMenu', { name: account.user.username ?? account.user.email ?? '' })} onPress={openAccountMenu} />
          ) : <IconButton icon={Settings} label={translate('workbench.settings')} onPress={onSettings} testID="settings" />}
        </>} />
      {searchOpen || query ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 6, paddingLeft: 10, height: 42, borderRadius: t.radius.md, backgroundColor: t.c.surface, borderWidth: 1, borderColor: t.c.border }}>
          <Search size={16} color={t.c.fgMuted} />
          <TextInput ref={searchRef} value={query} onChangeText={setQuery} placeholder={translate('native.searchThreads')} placeholderTextColor={t.c.fgMuted} returnKeyType="search"
            accessibilityLabel={translate('chat.search')} autoCorrect={false} style={{ flex: 1, color: t.c.fg, fontFamily: t.font.regular, fontSize: 16, paddingHorizontal: 8 }} />
          <IconButton icon={X} size={16} label={translate('workbench.close')} onPress={() => { setQuery(''); setSearchOpen(false); }} />
        </View>
      ) : null}
      {/* With nothing loaded yet the empty state below says it once; the banner is for stale lists. */}
      {data.loadedAt && (disconnected || (data.error && data.status !== 'loading')) ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 6 }}>
          <Banner tone={disconnected ? 'offline' : 'warning'} text={data.blocked ? translate('native.deviceRefused') : translate('native.deviceUnreachable')}
            action={{ label: translate('common.retry'), onPress: () => wakeDevice(deviceKey) }} />
        </View>
      ) : null}
      {(data.status === 'loading' || data.status === 'idle') && !data.loadedAt && !data.error ? <SkeletonRows /> : data.status === 'error' && !data.loadedAt ? (
        <EmptyState icon={WifiOff} title={data.blocked ? translate('native.deviceRefused') : translate('native.deviceUnreachable')}
          body={device?.target.kind === 'direct' ? translate('native.directUnreachableHint', { host: device.target.baseUrl.replace(/^https?:\/\//, '') }) : translate('native.relayDeviceOfflineHint')}
          action={{ label: translate('common.retry'), onPress: () => wakeDevice(deviceKey) }}>
          {data.error ? <ErrorMark reason={data.error} onRetry={() => wakeDevice(deviceKey)} /> : null}
        </EmptyState>
      ) : !query && data.loadedAt && !data.workspaces.length ? (
        // Pull to refresh here too: a workspace added on the Web sends no event.
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} refreshControl={refresh}>
          <EmptyState icon={FolderPlus} title={translate('files.noWorkspacesYet')} body={translate('files.addAFolderOnThisDeviceConnect')}
            action={{ label: translate('files.addWorkspace'), icon: Plus, onPress: () => setAdding(true) }} />
        </ScrollView>
      ) : rows.length === 0 ? (
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} refreshControl={query ? undefined : refresh} keyboardShouldPersistTaps="handled">
          <EmptyState icon={MessageSquarePlus} title={query ? translate('native.noResults') : translate('native.noThreads')} body={query ? undefined : translate('native.noThreadsBody')}
            action={query ? undefined : { label: translate('workbench.createThread'), onPress: () => onNewThread() }} />
        </ScrollView>
      ) : (
        <LegendList data={rows} keyExtractor={r => r.key} renderItem={renderRow} getItemType={r => r.type} estimatedItemSize={54} recycleItems
          // Rows also read waiting counts, running agents, the selection, drafts and shortcuts.
          extraData={rowState}
          // Direction from where a drag started to where the list settled (LegendList sends few onScroll events).
          onScrollBeginDrag={onScrollDirection ? e => { lastY.current = e.nativeEvent.contentOffset.y; } : undefined}
          onScrollEndDrag={onScrollDirection ? e => settleDirection(e.nativeEvent.contentOffset.y) : undefined}
          onMomentumScrollEnd={onScrollDirection ? e => settleDirection(e.nativeEvent.contentOffset.y) : undefined}
          refreshControl={refresh}
          contentContainerStyle={{ paddingBottom: compact ? 110 : 24 }} keyboardShouldPersistTaps="handled"
          ListFooterComponent={query ? null : (
            <Press onPress={() => setAdding(true)} accessibilityRole="button" testID="add-workspace"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, marginTop: 10, marginHorizontal: 6, paddingHorizontal: 12, borderRadius: t.radius.md }}>
              <Plus size={16} color={t.c.accentStrong} />
              <AppText variant="subhead" tone="accent">{translate('files.addWorkspace')}</AppText>
            </Press>
          )} />
      )}
      <AddWorkspaceSheet deviceKey={deviceKey} visible={adding} onClose={() => setAdding(false)} />
      {renaming ? <RenameSheet visible onClose={() => setRenaming(null)} title={renaming.title}
        onSave={async title => { const updated = await deviceApi(device!).rename(renaming.id, title); upsertThread(deviceKey, updated?.id ? updated : { id: renaming.id, title }); }} /> : null}
    </View>
  );
}
