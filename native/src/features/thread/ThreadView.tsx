// One thread: bar, transcript, requests, queued prompts, working line and composer. The
// same view is a pushed page on a phone and the detail column on wider windows; the
// shell decides which (useLayout), this view never does.
import { cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowDown, ArrowUp, FolderTree, GitBranch, MoreHorizontal, Pencil, Star, Trash2, Copy as CopyIcon, X, Zap } from 'lucide-react-native';
import type { ModelOptionDto, ThreadDto } from '@pockymoe/shared';
import { AppBar } from '../../design/AppBar';
import { AppText } from '../../design/AppText';
import { Button, IconButton } from '../../design/Button';
import { Banner, EmptyState, Loading } from '../../design/States';
import { StatusMark } from '../../design/StatusMark';
import { AgentAvatar, composerPeekRise } from '../../design/AgentAvatar';
import { confirmAsync, showMenu, showToast, type Anchor } from '../../design/Overlay';
import { Press } from '../../design/Press';
import { useTheme } from '../../design/theme';
import { haptic } from '../../design/haptics';
import { translate } from '../../i18n';
import { deviceApi, devicesStore, findDevice } from '../../connection/devices';
import { addLocalPrompt, loadEarlier, loadThread, patchDetail, retainThread, threadStore, threadKey, updateLocalPrompt, useThreadEntry } from '../../state/threadDetail';
import { removeThread, upsertThread, useDeviceData, wakeDevice } from '../../state/deviceData';
import type { PromptAttachment } from '../../protocol/api';
import { buildTranscript, type TurnView } from './model';
import { Turn, WorkingLine, type TurnActions } from './Turn';
import { RequestCard } from './Requests';
import { addQuote, Composer, foldComposer, readDraft } from './Composer';
import { bytesToB64 } from '../../platform/idb/miniIdb';

import { READING_WIDTH } from './readingWidth';

// Thread images arrive sealed; keep the decoded ones for the session.
const imageCache = new Map<string, string>();
import type { ModelChoice } from './ModelPicker';
import { useNow } from './useNow';
import { useActivityAnnouncements } from './announce';
import { useKeyCommand } from '../../platform/keyCommands';
import { useDelayed } from '../../design/useDelayed';
import { visibleThread } from '../notifications/notifications';
import { TurnBell } from '../notifications/TurnBell';
import { markRead, toggleStar, useStarred } from '../threads/references';
import { RenameSheet } from '../threads/RenameSheet';
import { RewindSheet } from '../git/RewindSheet';
import { threadAgentKey } from '../../protocol/agentKey';

export interface ThreadViewProps {
  deviceKey: string;
  threadId: string;
  onBack?: () => void;
  /** The shell's inspector (Files, Git); a column or a sheet. */
  onInspector?: (pane: 'files' | 'git', paths?: string[], turnId?: string) => void;
  inspectorOpen?: 'files' | 'git' | null;
  /** Phone dock under the composer. */
  dock?: React.ReactNode;
  onDeleted?: () => void;
}

export function ThreadView({ deviceKey, threadId, onBack, onInspector, inspectorOpen, dock, onDeleted }: ThreadViewProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const entry = useThreadEntry(deviceKey, threadId);
  const deviceData = useDeviceData(deviceKey);
  const device = devicesStore.useValue(() => findDevice(deviceKey));
  const api = device ? deviceApi(device) : null;
  const listRef = useRef<LegendListRef>(null);
  const [atEnd, setAtEnd] = useState(true);
  // The list's last scroll geometry: a shrinking transcript (an answered request, a folded
  // queue) can reach the end without a scroll event.
  const scrollGeometry = useRef({ offset: 0, viewport: 0 });
  const [renaming, setRenaming] = useState(false);
  const [steersOpen, setSteersOpen] = useState(false);
  const [rewindTurn, setRewindTurn] = useState<string | null>(null);
  const [agents, setAgents] = useState<ModelOptionDto[]>([]);
  const starred = useStarred(deviceKey, threadId);
  useEffect(() => retainThread(deviceKey, threadId), [deviceKey, threadId]);
  useEffect(() => { visibleThread.key = `${deviceKey}::${threadId}`; return () => { if (visibleThread.key === `${deviceKey}::${threadId}`) visibleThread.key = null; }; }, [deviceKey, threadId]);

  const detail = entry.detail;
  const thread: ThreadDto | null = detail?.thread ?? deviceData.threads.find(th => th.id === threadId) ?? null;
  const running = thread?.status === 'running' || !!thread?.activeTurnId;
  const now = useNow(running ? 1000 : null);
  const turns = useMemo(() => buildTranscript(detail, entry.local), [detail, entry.local]);
  const activeTurn = turns.findLast(v => v.running && !v.local);
  useActivityAnnouncements(`${deviceKey}::${threadId}`, detail && thread ? {
    running, lastTurnStatus: detail.turns.at(-1)?.status ?? null, requestIds: detail.pendingRequests.map(r => r.id),
  } : null);
  const [model, setModel] = useState<ModelChoice>({ model: null, effort: null });
  useEffect(() => { if (thread) setModel({ model: thread.model, effort: thread.reasoningEffort }); }, [thread?.model, thread?.reasoningEffort]);
  useEffect(() => { if (api) api.runtimeAgents('acp').then(setAgents, () => setAgents([])); }, [api]);
  useEffect(() => { if (thread?.lastTurnCompletedAt && !running) markRead(deviceKey, thread, detail?.workspace.label ?? ''); }, [thread?.lastTurnCompletedAt, running]);

  useKeyCommand('git', () => { if (!onInspector) return false; onInspector('git'); }, !!onInspector);
  useKeyCommand('files', () => { if (!onInspector) return false; onInspector('files'); }, !!onInspector);
  const actions = useMemo<TurnActions>(() => ({
    loadItemDetail: async itemId => { const d = await api!.itemDetail(threadId, itemId); return d.text; },
    loadTurnItems: async turnId => {
      const full = await api!.turnDetail(threadId, turnId);
      patchDetail(deviceKey, threadId, d => ({ ...d, turns: d.turns.map(tn => tn.id === turnId ? { ...tn, ...full, hasDeferredItems: false } : tn) }));
    },
    openFiles: (paths, turnId) => onInspector?.('git', paths, turnId),
    retryLocal: id => { const p = threadStore.get()[threadKey(deviceKey, threadId)]?.local.find(l => l.clientRequestId === id); if (p) void send(p.text, p.attachments, id); },
    discardLocal: id => updateLocalPrompt(deviceKey, threadId, id, null),
    quote: (item, turnId, from) => { addQuote(threadKey(deviceKey, threadId), { id: `${turnId}/${item.id}`, text: item.text, from, turnId, itemId: item.id }); showToast(translate('native.quoted')); },
    loadImage: async path => {
      const cached = imageCache.get(`${deviceKey}:${path}`); if (cached) return cached;
      const { bytes, type } = await api!.imageBytes(threadId, path);
      const uri = `data:${type};base64,${bytesToB64(bytes)}`;
      imageCache.set(`${deviceKey}:${path}`, uri); return uri;
    },
    ...(device && !device.shared ? { editFromHere: (turnId: string) => setRewindTurn(turnId) } : {}),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [api, deviceKey, threadId, onInspector, device?.shared]);

  const send = useCallback(async (text: string, attachments: PromptAttachment[], retryId?: string) => {
    if (!api) return false;
    const clientRequestId = retryId ?? globalThis.crypto.randomUUID();
    if (!running) addLocalPrompt(deviceKey, threadId, { clientRequestId, text, createdAt: new Date().toISOString(), state: 'sending', attachments });
    else updateLocalPrompt(deviceKey, threadId, clientRequestId, null);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    try {
      const updated = await api.prompt(threadId, { prompt: text, clientRequestId,
        ...(model.model && model.model !== thread?.model ? { model: model.model } : {}),
        ...(model.effort && model.effort !== thread?.reasoningEffort ? { reasoningEffort: model.effort } : {}) }, attachments);
      if (updated?.id) upsertThread(deviceKey, updated);
      if (running) void loadThread(deviceKey, threadId);
      return true;
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      if (running) { showToast(message, 'error'); return false; }
      updateLocalPrompt(deviceKey, threadId, clientRequestId, { state: 'failed', error: message });
      return true;
    }
  }, [api, deviceKey, threadId, running, model, thread?.model, thread?.reasoningEffort]);

  const stop = useCallback(async () => {
    if (!api) return;
    try { await api.interrupt(threadId, activeTurn ? { turnId: activeTurn.turn.id } : {}); } catch (e) { showToast(String((e as Error)?.message ?? e), 'error'); }
  }, [api, threadId, activeTurn]);

  const onModel = useCallback(async (next: ModelChoice) => {
    setModel(next);
    if (!api || running) return;
    try { const updated = await api.updateSettings(threadId, { ...(next.model ? { model: next.model } : {}), reasoningEffort: next.effort }); if (updated?.id) upsertThread(deviceKey, updated); }
    catch (e) { showToast(String((e as Error)?.message ?? e), 'error'); }
  }, [api, running, threadId, deviceKey]);

  const menu = (anchor?: Anchor) => showMenu({ anchor, title: thread?.title, items: [
    { label: starred ? translate('workbench.unstarThread') : translate('workbench.starThread'), icon: Star, onPress: () => thread && toggleStar(deviceKey, thread, detail?.workspace.label ?? '') },
    // The Web's thread menu words: Copy harness session ID, Rename thread.
    ...(thread?.providerSessionId ? [{ label: translate('workbench.copyHarnessSessionID'), icon: CopyIcon, copy: thread.providerSessionId }] : [{ label: translate('native.copyThreadId'), icon: CopyIcon, copy: threadId }]),
    { label: translate('workbench.renameThread'), icon: Pencil, onPress: () => setRenaming(true) },
    { label: translate('native.files'), icon: FolderTree, onPress: () => onInspector?.('files') },
    { label: translate('native.git'), icon: GitBranch, onPress: () => onInspector?.('git') },
    { label: translate('native.deleteThread'), icon: Trash2, destructive: true, onPress: async () => {
      if (!await confirmAsync({ title: translate('native.deleteThreadTitle'), message: thread?.title, confirmLabel: translate('native.delete'), destructive: true })) return;
      try { await api!.deleteThread(threadId); removeThread(deviceKey, threadId); onDeleted?.(); } catch (e) { showToast(String((e as Error)?.message ?? e), 'error'); }
    } },
  ] });

  // A prompt this app is still sending shows once, as its own bubble.
  const visibleSteers = (detail?.pendingSteers ?? []).filter(st => !entry.local.some(l => l.clientRequestId === st.clientRequestId));
  const live = deviceData.live;
  const offline = useDelayed(live === 'offline' || live === 'retrying');
  const agentId = (thread ? threadAgentKey(thread) : null) ?? thread?.provider ?? null;
  const subtitle = [detail?.workspace.label, thread?.model].filter(Boolean).join(' · ');
  const moreRef = useRef<ComponentRef<typeof View>>(null);
  const openMenu = () => moreRef.current?.measureInWindow((x, y, width, height) => menu({ x, y, width, height }));

  // A readable column on wide windows, as the Web and T3 do; phones use the full width.
  const column = { width: '100%' as const, maxWidth: READING_WIDTH, alignSelf: 'center' as const };
  const renderItem = useCallback(({ item }: { item: TurnView }) => <View style={column}><Turn view={item} actions={actions} now={now} agent={null} /></View>, [actions, now]);

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: t.c.bg }} keyboardVerticalOffset={0}>
      <AppBar onBack={onBack} title={thread?.title ?? translate('native.loading')} subtitle={subtitle || null}
        titleAccessory={thread ? <StatusMark status={running ? 'running' : thread.status === 'failed' ? 'failed' : thread.status === 'interrupted' ? 'interrupted' : 'idle'} size={10} /> : null}
        leading={!onBack ? <View style={{ paddingLeft: 8 }}><AgentAvatar agent={agentId} size={24} /></View> : undefined}
        trailing={<>
          {onInspector && !dock ? <IconButton icon={GitBranch} label={translate('native.git')} active={inspectorOpen === 'git'} onPress={() => onInspector('git')} /> : null}
          {onInspector && !dock ? <IconButton icon={FolderTree} label={translate('native.files')} active={inspectorOpen === 'files'} onPress={() => onInspector('files')} /> : null}
          <View ref={moreRef} collapsable={false}><IconButton icon={MoreHorizontal} label={translate('native.more')} onPress={openMenu} testID="thread-menu" /></View>
        </>} />
      {offline ? <View style={{ paddingHorizontal: 10, paddingTop: 6 }}><Banner tone="offline" text={translate('native.deviceUnreachable')} action={{ label: translate('common.retry'), onPress: () => wakeDevice(deviceKey) }} /></View> : null}
      <View style={{ flex: 1 }}>
        {entry.status === 'loading' && !detail ? <Loading /> : entry.status === 'error' && !detail ? (
          <EmptyState icon={Zap} title={translate('native.threadUnavailable')} body={entry.error ?? undefined} action={{ label: translate('common.retry'), onPress: () => void loadThread(deviceKey, threadId) }} />
        ) : turns.length === 0 ? (
          <EmptyState title={translate('native.emptyThread')} body={translate('native.emptyThreadBody')} />
        ) : (
          <LegendList ref={listRef} data={turns} keyExtractor={v => v.key} renderItem={renderItem} extraData={now} onTouchStart={() => foldComposer()}
            estimatedItemSize={220} recycleItems={false} initialScrollAtEnd maintainScrollAtEnd alignItemsAtEnd
            maintainVisibleContentPosition onStartReachedThreshold={0.4}
            onStartReached={() => { if (entry.hasEarlier) void loadEarlier(deviceKey, threadId); }}
            onScroll={e => { const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent; scrollGeometry.current = { offset: contentOffset.y, viewport: layoutMeasurement.height }; setAtEnd(contentSize.height - contentOffset.y - layoutMeasurement.height < 80); }}
            onContentSizeChange={(_w: number, h: number) => { const g = scrollGeometry.current; if (g.viewport && h - g.offset - g.viewport < 80) setAtEnd(true); }}
            ListHeaderComponent={entry.hasEarlier ? <View style={column}><EarlierTurns count={Math.max(0, (detail?.totalTurnCount ?? 0) - (detail?.turns.length ?? 0))} loading={entry.loadingEarlier} onPress={() => void loadEarlier(deviceKey, threadId)} /></View> : <View style={{ height: 8 }} />}
            ListFooterComponent={activeTurn ? <View style={column}><WorkingLine view={activeTurn} now={now} trailing={<TurnBell deviceKey={deviceKey} threadId={threadId} turnId={activeTurn.turn.id} />} /></View> : <View style={{ height: 12 }} />}
            contentContainerStyle={{ paddingBottom: 8 + composerPeekRise(agentId, t.plum) }} keyboardShouldPersistTaps="handled" />
        )}
        {!atEnd ? <IconButton icon={ArrowDown} label={translate('native.jumpToLatest')} onPress={() => listRef.current?.scrollToEnd({ animated: true })}
          style={{ position: 'absolute', right: 14, bottom: 10, backgroundColor: t.c.panel, borderWidth: 1, borderColor: t.c.borderStrong, borderRadius: 20 }} /> : null}
      </View>
      <View style={column}>
      {detail?.pendingRequests.map(request => (
        <RequestCard key={request.id} request={request} onAnswer={async body => { await api!.respond(threadId, request.id, body); patchDetail(deviceKey, threadId, d => ({ ...d, pendingRequests: d.pendingRequests.filter(r => r.id !== request.id) })); }} />
      ))}
      {visibleSteers.length ? (
        <View style={{ marginHorizontal: 10, marginBottom: 4, gap: 4 }}>
          {(steersOpen ? visibleSteers : visibleSteers.slice(0, 2)).map(steer => (
            <View key={steer.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, borderRadius: t.radius.md, backgroundColor: t.c.surface, borderWidth: 1, borderColor: t.c.border }}>
              <AppText variant="caption" tone="muted">{translate('native.queued')}</AppText>
              <AppText variant="subhead" numberOfLines={1} style={{ flex: 1 }}>{steer.prompt ?? ''}</AppText>
              {steer.delivery !== 'steer' ? <Button label={translate('native.steerNow')} size="sm" kind="ghost" onPress={() => void api!.steerNow(threadId, steer.id).then(() => loadThread(deviceKey, threadId), e => showToast(String(e?.message ?? e), 'error'))} /> : null}
              <IconButton icon={X} label={translate('native.removeQueued')} size={16} onPress={() => void api!.cancelSteer(threadId, steer.id).then(() => loadThread(deviceKey, threadId))} />
            </View>
          ))}
          {visibleSteers.length > 2 ? (
            <Press onPress={() => setSteersOpen(v => !v)} accessibilityRole="button" accessibilityState={{ expanded: steersOpen }} style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6 }}>
              <AppText variant="subhead" tone="accent">{steersOpen ? translate('native.showLess') : translate('native.moreQueued', { count: visibleSteers.length - 2 })}</AppText>
            </Press>
          ) : null}
        </View>
      ) : null}
      </View>
      {api && thread ? (
        // The Web's fused panel on phones: the composer and the dock on one chrome strip.
        <View style={[column, dock ? { borderTopWidth: 1, borderTopColor: t.c.border, backgroundColor: t.c.chrome, paddingTop: 8 } : { paddingTop: 6 }, { paddingBottom: dock ? 0 : Math.max(insets.bottom, 8) }]}>
          <Composer contextUsage={thread.contextUsage} onCompact={async () => { const updated = await api.compact(threadId); if (updated?.id) upsertThread(deviceKey, updated); }}
            draftKey={threadKey(deviceKey, threadId)} api={api} threadId={threadId} agent={{ provider: thread.provider, agentId: threadAgentKey(thread) }} agents={agents}
            canSwitch={!device?.shared} cwd={detail?.workspace.absPath ?? null} onSwitched={updated => upsertThread(deviceKey, updated)}
            model={model} onModel={m => void onModel(m)} running={running} onSend={(text, attachments) => send(text, attachments)} onStop={() => void stop()}
            dock={dock && isValidElement<{ onMore?: () => void }>(dock) ? cloneElement(dock, { onMore: () => menu() }) : dock} />
          {dock ? <View style={{ height: Math.max(insets.bottom, 6) }} /> : null}
        </View>
      ) : null}
      <RewindSheet visible={!!rewindTurn} onClose={() => setRewindTurn(null)} deviceKey={deviceKey} threadId={threadId} turnId={rewindTurn} running={running} queued={detail?.pendingSteers.length ?? 0} />
      {thread ? <RenameSheet visible={renaming} onClose={() => setRenaming(false)} title={thread.title} onSave={async title => { const updated = await api!.rename(threadId, title); upsertThread(deviceKey, updated ?? { id: threadId, title }); patchDetail(deviceKey, threadId, d => ({ ...d, thread: { ...d.thread, title } })); }} /> : null}
    </KeyboardAvoidingView>
  );
}
void readDraft; void haptic;

/** "↑ 2 earlier turns" between two rules (the Web's timeline head). */
function EarlierTurns({ count, loading, onPress }: { count: number; loading: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, paddingHorizontal: 9, paddingBottom: 2 }}>
      {t.plum ? null : <View style={{ flex: 1, height: 1, backgroundColor: t.c.border }} />}
      <Press onPress={onPress} disabled={loading} feedback="dim" accessibilityRole="button"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: t.plum ? 44 : 36, paddingHorizontal: t.plum ? 14 : 12, borderRadius: t.terminal ? 0 : 999,
          borderWidth: t.plum ? 1.5 : 1, borderStyle: t.plum ? 'dashed' : 'solid', borderColor: t.c.border, backgroundColor: t.plum ? (t.mode === 'dark' ? '#21142a' : '#fffdf8') : t.c.panel, marginHorizontal: t.plum ? 'auto' : 0 }}>
        {loading ? <ActivityIndicator size="small" color={t.c.fgMuted} /> : <ArrowUp size={14} color={t.c.fgSoft} />}
        <AppText variant="caption" tone="soft" weight={t.plum ? 'bold' : 'regular'} style={{ fontSize: 12 }}>
          {count ? translate('chat.earlierTurns', { count }) : translate('native.earlierTurns')}</AppText>
      </Press>
      {t.plum ? null : <View style={{ flex: 1, height: 1, backgroundColor: t.c.border }} />}
    </View>
  );
}
