// The composer's model picker, as the Web's (owner-approved design, docs/model-settings.md and
// docs/harness-switching.md): a rail of the agents this thread may move to, a search across
// every agent with a settings-free bar, a column header outside the scrolling list, rows with
// context and price from the device's pricing catalog, and one row of effort chips. Picking a
// model of another agent switches the thread (a running thread offers Stop and switch), with
// a note of what is handed over and a preview. Phones: a bottom sheet at 80% of the height;
// wide windows: a popover above the model key. Ordering, search, facts and the readable
// handoff come from the vendored modelPickerLogic.
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AgentBackendIdDto, ModelOptionDto, ThreadDto } from '@pockymoe/shared';
import { ArrowLeft, Check, Search, X } from 'lucide-react-native';
import { AppText } from '../../design/AppText';
import { Button, IconButton } from '../../design/Button';
import { CopyButton } from '../../design/Copy';
import { ErrorMark } from '../../design/ErrorMark';
import { Press } from '../../design/Press';
import { Sheet, WIDE_SHEET, useModalKey, useModalTop } from '../../design/Sheet';
import { AgentMark } from '../../design/AgentMark';
import { useTheme } from '../../design/theme';
import { haptic } from '../../design/haptics';
import { translate } from '../../i18n';
import { Segmented } from '../../design/Segmented';
import type { DeviceApi, HarnessPreview, ModelPricingCatalog } from '../../protocol/api';
import { agentEntryLabel, agentKeyName } from '../../protocol/agentKey';
import {
  adjacentPickerAgent, defaultPickerModel, formatContextWindow, formatModelPrice, formatUsdPerMillion, modelFactsFromCatalog, orderPickerAgents,
  readableHandoffText, searchPickerGroups, visiblePickerModels, type ModelFacts, type ModelPickerAgent, type PickerGroup,
} from '../../../vendor/pockymoe/thread-ui/components/composer/modelPicker/modelPickerLogic';
import { formatCompactTokens } from './modelFormat';
import { effortLabel } from './effort';
import { EffortSlider } from './EffortSlider';
import { moveCursor, scrollToShow, type CursorMove } from './pickerCursor';
import { KeyCommandsRoot, useKeyCommand } from '../../platform/keyCommands';

// The segmented control lives in the design system; re-exported for existing imports.
export { Segmented };
export { effortLabel };

export interface ModelChoice { model: string | null; effort: string | null }
export interface AgentChoice { provider: AgentBackendIdDto; agentId: string | null }
export interface Anchor { x: number; y: number; width: number; height: number }

type Load<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: string };
type PickRef = { agentId: string; model: string };
const message = (e: unknown) => String((e as Error)?.message ?? e);

/** The device's pricing catalog, read once per device and kept for the session. */
const catalogs = new Map<DeviceApi, Promise<ModelPricingCatalog | null>>();
function pricingOf(api: DeviceApi) {
  let entry = catalogs.get(api);
  if (!entry) { entry = api.modelPricing().catch(() => null); catalogs.set(api, entry); }
  return entry;
}
/** Another agent's models, reused for a minute (the Web's MODELS_FRESH_MS). */
const modelCache = new Map<string, { at: number; request: Promise<ModelOptionDto[]> }>();

export interface ModelPickerProps {
  visible: boolean; onClose: () => void; api: DeviceApi; threadId: string | null; agent: AgentChoice;
  value: ModelChoice; onChange: (v: ModelChoice) => void;
  /** The device's ACP agents (`api/agent-runtimes/acp/agents`). */
  agents?: ModelOptionDto[];
  /** The owner may move this thread to another agent. */
  canSwitch?: boolean;
  running?: boolean;
  /** The harness applies a model change from its next call (else from the next turn). */
  liveModelSwitch?: boolean;
  /** The thread's workspace, for agents whose models depend on it. */
  cwd?: string | null;
  /** The model key, for the popover on wide windows. */
  anchor?: Anchor | null;
  onSwitched?: (thread: ThreadDto) => void;
}

export function ModelPicker(props: ModelPickerProps) {
  const { visible, onClose, anchor } = props;
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const modalKey = useModalKey();
  const modalTop = useModalTop(visible && width >= WIDE_SHEET && !!anchor);
  if (!visible) return null;
  const wide = width >= WIDE_SHEET;
  if (!wide || !anchor) {
    return (
      <Sheet visible onClose={onClose} title={translate('chat.model')} tall fraction={0.8} scroll={false} testID="model-picker">
        <PickerBody {...props} />
      </Sheet>
    );
  }
  // A popover above the model key, its end on the key's end (the Web's align="end").
  const w = Math.min(560, width - 24);
  const h = Math.max(320, Math.min(600, anchor.y - insets.top - 20));
  const left = Math.max(12, Math.min(anchor.x + anchor.width - w, width - w - 12));
  const top = Math.max(insets.top + 8, anchor.y - h - 8);
  return (
    <Modal key={modalKey} transparent visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={{ position: 'absolute', inset: 0 }} onPress={onClose} accessibilityRole="button" accessibilityLabel={translate('chat.modelPickerClose')} />
      <View testID="model-picker" accessibilityViewIsModal={modalTop} style={{ position: 'absolute', left, top, width: w, height: Math.min(h, height - top - 12), backgroundColor: t.c.sheet,
        borderRadius: t.terminal ? 0 : t.radius.lg, borderWidth: 1, borderColor: t.c.borderStrong, overflow: 'hidden',
        shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 16 }}>
        <PickerBody {...props} />
      </View>
    </Modal>
  );
}

function PickerBody({ onClose, api, threadId, agent, value, onChange, agents: agentOptions, canSwitch, running = false, liveModelSwitch, cwd, onSwitched }: ModelPickerProps) {
  const t = useTheme();
  const currentAgentId = agent.agentId ?? '';
  // Switching: the owner's ACP thread, with another ready agent to move to.
  const pickerAgents = useMemo<ModelPickerAgent[]>(() => {
    if (!canSwitch || !threadId || agent.provider !== 'acp' || !currentAgentId) return [];
    const ready = (agentOptions ?? []).filter(a => !a.hidden && ((a.acpAgent?.availability ?? 'ready') === 'ready' || a.model === currentAgentId));
    return orderPickerAgents(ready.map(a => ({ id: a.model || a.id, name: agentEntryLabel(a) || a.model })), currentAgentId);
  }, [agentOptions, canSwitch, threadId, agent.provider, currentAgentId]);
  const switching = pickerAgents.length > 1 && pickerAgents.some(a => a.id === currentAgentId);
  const showRail = switching;

  const [view, setView] = useState(currentAgentId);
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState<Load<ModelOptionDto[]>>({ status: 'loading' });
  const [loads, setLoads] = useState<Record<string, Load<ModelOptionDto[]>>>({});
  const [previews, setPreviews] = useState<Record<string, Load<HarnessPreview>>>({});
  const [pending, setPending] = useState<PickRef | null>(null);
  const [busy, setBusy] = useState<PickRef | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [targetEffort, setTargetEffort] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ModelPricingCatalog | null>(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  // The current agent's models: the thread's own list, or the runtime's for a new thread.
  const loadCurrent = useCallback(() => {
    setCurrent({ status: 'loading' });
    (threadId ? api.threadModels(threadId) : api.runtimeModels(agent.provider, agent.agentId, cwd))
      .then(data => { if (live.current) setCurrent({ status: 'ready', data }); }, e => { if (live.current) setCurrent({ status: 'error', error: message(e) }); });
  }, [api, threadId, agent.provider, agent.agentId, cwd]);
  useEffect(loadCurrent, [loadCurrent]);
  useEffect(() => { void pricingOf(api).then(c => { if (live.current) setCatalog(c); }); }, [api]);
  // Whether a model change reaches a running turn from its next call (native Codex) or next turn.
  const [liveSwitch, setLiveSwitch] = useState(!!liveModelSwitch);
  useEffect(() => {
    if (!threadId || liveModelSwitch !== undefined) return;
    api.threadCapabilities(threadId).then(c => { if (live.current) setLiveSwitch(!!c?.effectiveCapabilities?.controls?.liveModelSwitch); }, () => undefined);
  }, [api, threadId, liveModelSwitch]);

  const asked = useRef(new Set<string>());
  const load = useCallback((agentId: string, force = false) => {
    if (!switching || agentId === currentAgentId) return;
    const key = `models\u0000${agentId}`;
    if (asked.current.has(key) && !force) return;
    asked.current.add(key);
    setLoads(c => ({ ...c, [agentId]: { status: 'loading' } }));
    const cacheKey = `${agentId}\u0000${cwd ?? ''}`;
    const cached = modelCache.get(cacheKey);
    const request = cached && Date.now() - cached.at < 60_000 && !force ? cached.request : api.runtimeModels('acp', agentId, cwd);
    if (request !== cached?.request) { modelCache.set(cacheKey, { at: Date.now(), request }); request.catch(() => modelCache.delete(cacheKey)); }
    request.then(data => { if (live.current) setLoads(n => ({ ...n, [agentId]: { status: 'ready', data } })); },
      e => { asked.current.delete(key); if (live.current) setLoads(n => ({ ...n, [agentId]: { status: 'error', error: message(e) } })); });
  }, [switching, currentAgentId, api, cwd]);

  const searching = query.trim().length > 0;
  const currentModels = current.status === 'ready' ? visiblePickerModels(current.data, value.model) : [];
  const modelsOf = (agentId: string): Load<ModelOptionDto[]> | undefined => {
    if (!switching || agentId === currentAgentId) return current.status === 'ready' ? { status: 'ready', data: currentModels } : current;
    const l = loads[agentId];
    return l?.status === 'ready' ? { status: 'ready', data: visiblePickerModels(l.data) } : l;
  };
  useEffect(() => { if (view) load(view); }, [view, load]);
  useEffect(() => { if (searching) for (const a of pickerAgents) load(a.id); }, [searching, pickerAgents, load]);

  const viewModels = modelsOf(view);
  const previewTarget = view !== currentAgentId && viewModels?.status === 'ready' ? (pending?.agentId === view ? pending.model : defaultPickerModel(viewModels.data)?.model ?? null) : null;
  const countHistory = useCallback((agentId: string, model: string | null, force = false) => {
    if (!switching || !threadId) return;
    const key = `history\u0000${agentId}\u0000${model ?? ''}`;
    if (asked.current.has(key) && !force) return;
    asked.current.add(key);
    setPreviews(c => (c[agentId]?.status === 'ready' && !force ? c : { ...c, [agentId]: { status: 'loading' } }));
    api.harnessPreview(threadId, { provider: 'acp', agentId, model }).then(
      data => { if (live.current) setPreviews(n => ({ ...n, [agentId]: { status: 'ready', data } })); },
      e => { asked.current.delete(key); if (live.current) setPreviews(n => ({ ...n, [agentId]: { status: 'error', error: message(e) } })); });
  }, [switching, threadId, api]);
  useEffect(() => { if (view !== currentAgentId && viewModels?.status === 'ready') countHistory(view, previewTarget); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, currentAgentId, viewModels?.status, previewTarget, countHistory]);
  // A turn that ends on its own leaves nothing to stop: a pick then switches directly.
  useEffect(() => { if (!running) setPending(null); }, [running]);

  // The agent's display name, as the Web heads the list ("OpenAI Codex", "ACP · Claude").
  const agentName = (id: string) => pickerAgents.find(a => a.id === id)?.name
    ?? (() => { const entry = (agentOptions ?? []).find(a => (a.model || a.id) === id); return entry ? agentEntryLabel(entry) : agentKeyName(id); })();
  const changeView = (id: string) => {
    if (id !== view) { setPending(null); setTargetEffort(null); }
    setView(id); setShowPreview(false); setSwitchError(null);
  };
  const effortFor = (option: ModelOptionDto) =>
    targetEffort && option.supportedReasoningEfforts.some(e => e.reasoningEffort === targetEffort) ? targetEffort : option.defaultReasoningEffort ?? null;
  const switchTo = async (agentId: string, option: ModelOptionDto, stop: boolean) => {
    if (!threadId || busy) return;
    setBusy({ agentId, model: option.model }); setSwitchError(null);
    try {
      // As the Web: stop the turn, then release, which waits for it to settle before the switch.
      if (stop) { await api.interrupt(threadId); await api.release(threadId, { interrupt: true }); }
      const switched = await api.harnessSwitch(threadId, { provider: 'acp', agentId, model: option.model, reasoningEffort: effortFor(option) });
      haptic.success();
      if (switched?.id) onSwitched?.(switched);
      if (live.current) onClose();
    } catch (e) { if (live.current) setSwitchError(message(e)); }
    finally { if (live.current) setBusy(null); }
  };
  const pick = (agentId: string, option: ModelOptionDto) => {
    if (!switching || agentId === currentAgentId) {
      setPending(null);
      if (option.model !== value.model) { haptic.selection(); onChange({ model: option.model, effort: option.defaultReasoningEffort ?? null }); }
      return;
    }
    if (agentId !== view) changeView(agentId);
    setSwitchError(null);
    if (searching) setQuery('');
    if (running) { setPending({ agentId, model: option.model }); return; }
    void switchTo(agentId, option, false);
  };

  const factsOf = (option: ModelOptionDto): ModelFacts | null => (catalog ? modelFactsFromCatalog(catalog, option) : null);
  const groups: PickerGroup[] = searching
    ? searchPickerGroups((showRail ? pickerAgents : [{ id: currentAgentId, name: '' }]).flatMap(a => {
      const l = modelsOf(a.id); return l?.status === 'ready' ? [{ agent: a, models: l.data }] : [];
    }), query)
    : [];
  const shownModels = searching ? groups.flatMap(g => g.models) : viewModels?.status === 'ready' ? viewModels.data : [];
  const showFacts = shownModels.some(o => factsOf(o));
  const searchLoading = searching && (showRail ? pickerAgents : []).some(a => modelsOf(a.id)?.status === 'loading');

  // The chosen row in view: scroll the list to it once it has laid out.
  const listRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const listHeight = useRef(0);
  const listScroll = useRef(0);
  const revealed = useRef('');
  // Keyboard (the Web's menu keys): ↑/↓/Home/End move a cursor over the rows, Enter or Space
  // picks it, ←/→ change agents while the search is empty. Shown only once a key was used.
  const rows = searching ? groups.flatMap(g => g.models.map(o => ({ agentId: g.agent.id, option: o })))
    : viewModels?.status === 'ready' ? viewModels.data.map(o => ({ agentId: view, option: o })) : [];
  const rowKey = (agentId: string, option: ModelOptionDto) => `${agentId}\u0000${option.id}`;
  const rowKeys = rows.map(r => rowKey(r.agentId, r.option));
  const checkedKey = rows.find(r => (r.agentId === currentAgentId || !switching ? r.option.model === value.model : false)
    || (pending?.agentId === r.agentId && pending.model === r.option.model));
  const [cursor, setCursor] = useState<string | null>(null);
  const rowFrames = useRef(new Map<string, { y: number; height: number }>());
  const groupTops = useRef(new Map<string, number>());
  const moveTo = (move: CursorMove) => {
    if (showPreview) return false;
    const next = moveCursor(rowKeys, cursor && rowKeys.includes(cursor) ? cursor : null, move, checkedKey ? rowKey(checkedKey.agentId, checkedKey.option) : null);
    if (!next) return;
    setCursor(next);
    const frame = rowFrames.current.get(next);
    const y = frame ? scrollToShow(frame, listScroll.current, listHeight.current) : null;
    if (y != null) listRef.current?.scrollTo({ y, animated: false });
  };
  const cursorRow = cursor ? rows.find(r => rowKey(r.agentId, r.option) === cursor) : undefined;
  const chooseCursor = () => {
    const target = cursorRow ?? (searching ? rows[0] : undefined);
    if (!target || showPreview) return false;
    pick(target.agentId, target.option);
  };
  useKeyCommand('up', () => moveTo('up'));
  useKeyCommand('down', () => moveTo('down'));
  useKeyCommand('home', () => moveTo('home'));
  useKeyCommand('end', () => moveTo('end'));
  useKeyCommand('enter', chooseCursor);
  const railKeys = showRail && !searching && !showPreview;
  const stepAgent = (direction: 1 | -1) => { setCursor(null); changeView(adjacentPickerAgent(pickerAgents, view, direction)); };
  useKeyCommand('left', () => stepAgent(-1), railKeys);
  useKeyCommand('right', () => stepAgent(1), railKeys);
  const reveal = (key: string, y: number, rowHeight: number) => {
    if (revealed.current === key) return;
    revealed.current = key;
    requestAnimationFrame(() => listRef.current?.scrollTo({ y: Math.max(0, y - (listHeight.current - rowHeight) / 2), animated: false }));
  };

  const factColumns = (context: string | null, price: string | null, head = false) => showFacts ? (
    <>
      <AppText variant={head ? 'caption' : 'footnote'} tone={head ? 'muted' : 'soft'} numberOfLines={1} style={{ width: 62, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{context ?? ''}</AppText>
      <AppText variant={head ? 'caption' : 'footnote'} tone={head ? 'muted' : 'soft'} numberOfLines={1} style={{ width: 104, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{price ?? ''}</AppText>
    </>
  ) : null;

  const row = (agentId: string, option: ModelOptionDto) => {
    const facts = factsOf(option);
    const isCurrent = agentId === currentAgentId || !switching ? option.model === value.model : false;
    const isPending = pending?.agentId === agentId && pending.model === option.model;
    const isBusy = busy?.agentId === agentId && busy.model === option.model;
    const crossAgent = switching && agentId !== currentAgentId;
    const name = option.displayName || option.model;
    const label = crossAgent ? translate('chat.modelPickerSwitchTo', { agent: agentName(agentId), model: name }) : name;
    const checked = isCurrent || isPending;
    const key = rowKey(agentId, option);
    const onCursor = cursor === key;
    return (
      <Press key={key} onPress={() => pick(agentId, option)} disabled={crossAgent ? !!busy : false} feedback="dim" testID={`model-row-${option.model}`}
        onLayout={e => {
          const { y, height } = e.nativeEvent.layout;
          rowFrames.current.set(key, { y: y + (searching ? groupTops.current.get(agentId) ?? 0 : 0), height });
          if (checked && !searching) reveal(`${view}\u0000${option.model}`, y, height);
        }}
        accessibilityRole="radio" accessibilityState={{ checked }} accessibilityLabel={[label, describeFacts(facts)].filter(Boolean).join(', ')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingLeft: 12, paddingRight: 8, borderRadius: t.radius.md, backgroundColor: checked ? t.c.accentSoft : 'transparent',
          borderWidth: 2, borderColor: onCursor ? t.c.primary : 'transparent' }}>
        <AppText variant="callout" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>{name}</AppText>
        {factColumns(formatContextWindow(facts?.contextWindow), formatModelPrice(facts))}
        <View style={{ width: 20, alignItems: 'center' }}>
          {isBusy ? <ActivityIndicator size="small" color={t.c.primary} /> : checked ? <Check size={17} color={t.c.accentStrong} /> : null}
        </View>
      </Press>
    );
  };

  const head = (a: ModelPickerAgent | null) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.c.border }}
      accessibilityLiveRegion={a && !searching ? 'polite' : undefined}>
      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {a ? <AgentMark agent={a.id} size={18} /> : null}
        <AppText variant="footnote" weight="semibold" tone="soft" numberOfLines={1} style={{ flexShrink: 1 }}>{a?.name ?? translate('chat.model')}</AppText>
      </View>
      {factColumns(translate('chat.modelPickerContext'), translate('chat.modelPickerPrice'), true)}
      <View style={{ width: 20 }} />
    </View>
  );
  const status = (text: string, extra?: ReactNode) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, padding: 16 }}><AppText variant="callout" tone="muted">{text}</AppText>{extra}</View>
  );

  const viewAgent = pickerAgents.find(a => a.id === view) ?? (agent.agentId ? { id: agent.agentId, name: agentName(agent.agentId) } : null);
  const crossView = switching && view !== currentAgentId && !searching;
  const preview = previews[view];

  let list: ReactNode;
  if (searching) {
    list = groups.length ? groups.map(g => (
      <View key={g.agent.id} accessibilityLabel={g.agent.name || translate('chat.model')} onLayout={e => { groupTops.current.set(g.agent.id, e.nativeEvent.layout.y); }}>
        {showRail ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 }}>
            <AgentMark agent={g.agent.id} size={16} /><AppText variant="caption" tone="muted" weight="semibold">{g.agent.name}</AppText>
          </View>
        ) : null}
        {g.models.map(o => row(g.agent.id, o))}
      </View>
    )) : status(searchLoading ? translate('chat.modelPickerLoading') : translate('chat.modelPickerEmpty'));
  } else if (viewModels?.status === 'error') {
    list = status(translate('chat.modelPickerLoadFailed'), <ErrorMark reason={viewModels.error} onRetry={() => (view === currentAgentId ? loadCurrent() : load(view, true))} />);
  } else if (viewModels?.status === 'ready') {
    list = viewModels.data.length ? viewModels.data.map(o => row(view, o)) : status(translate('chat.modelPickerEmpty'));
  } else {
    list = <View style={{ padding: 16 }}><ActivityIndicator color={t.c.primary} accessibilityLabel={translate('chat.modelPickerLoading')} /></View>;
  }

  const pendingModels = pending ? modelsOf(pending.agentId) : undefined;
  const pendingOption = pending && pendingModels?.status === 'ready' ? pendingModels.data.find(o => o.model === pending.model) : undefined;
  const handoffNote = crossView ? (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 12 }}>
        {preview?.status === 'ready' ? (
          <AppText variant="callout" style={{ flexShrink: 1 }}>
            {(preview.data.resumesSession
              ? preview.data.turns > 0 ? translate('chat.modelPickerResume', { count: preview.data.turns }) : translate('chat.modelPickerResumeCurrent')
              : preview.data.turns > 0 ? translate('chat.modelPickerHandoff', { count: preview.data.turns }) : translate('chat.modelPickerNoHistory'))
              + (preview.data.turns > 0 && preview.data.estimatedTokens > 0 ? ` · ≈${formatCompactTokens(preview.data.estimatedTokens)} tokens` : '')}
          </AppText>
        ) : preview?.status === 'error' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <AppText variant="callout" tone="muted">{translate('chat.modelPickerHandoffFailed')}</AppText>
            <ErrorMark reason={preview.error} onRetry={() => countHistory(view, previewTarget, true)} />
          </View>
        ) : <AppText variant="callout" tone="muted">{translate('chat.modelPickerHandoffChecking')}</AppText>}
        {preview?.status === 'ready' && preview.data.text && preview.data.turns > 0 ? (
          <Press onPress={() => setShowPreview(true)} feedback="dim" accessibilityRole="link" style={{ minHeight: 32, justifyContent: 'center' }} testID="handoff-preview">
            <AppText variant="callout" weight="semibold" tone="accent" style={{ textDecorationLine: 'underline' }}>{translate('chat.modelPickerPreview')}</AppText>
          </Press>
        ) : null}
      </View>
      <AppText variant="footnote" tone="muted">{running ? `${translate('chat.modelPickerStopsTurn')} · ` : ''}{translate('chat.modelPickerResets')}</AppText>
      {switchError ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <AppText variant="footnote" tone="danger">{translate('chat.modelPickerSwitchFailed')}</AppText><ErrorMark reason={switchError} />
        </View>
      ) : null}
    </View>
  ) : null;
  const stopButton = crossView && pending && pendingOption && running ? (
    <Button kind="primary" busy={!!busy} onPress={() => void switchTo(pending.agentId, pendingOption, true)} testID="stop-and-switch"
      label={`${translate('chat.modelPickerStopAndSwitch')} · ${agentName(pending.agentId)} · ${pendingOption.displayName || pendingOption.model}`} />
  ) : null;
  const targetOption = crossView && viewModels?.status === 'ready' ? (pendingOption ?? defaultPickerModel(viewModels.data)) : undefined;
  const currentOption = currentModels.find(o => o.model === value.model) ?? (current.status === 'ready' ? current.data.find(o => o.model === value.model) : undefined);
  const effort = searching ? null : crossView ? (
    targetOption?.supportedReasoningEfforts.length ? (
      <EffortSlider key={`${view}\u0000${targetOption.model}`} efforts={targetOption.supportedReasoningEfforts} value={effortFor(targetOption)}
        defaultEffort={targetOption.defaultReasoningEffort} disabled={!!busy} onChange={setTargetEffort} />
    ) : null
  ) : currentOption?.supportedReasoningEfforts.length ? (
    <EffortSlider key={value.model ?? ''} efforts={currentOption.supportedReasoningEfforts} value={value.effort} defaultEffort={currentOption.defaultReasoningEffort}
      onChange={next => onChange({ model: value.model ?? currentOption.model, effort: next })} />
  ) : null;
  const applies = running && !crossView && threadId ? (
    <AppText variant="footnote" tone="muted">{translate(liveSwitch ? 'chat.modelSwitchNextCall' : 'chat.modelSwitchNextTurn')}</AppText>
  ) : null;

  const column = showPreview && preview?.status === 'ready' ? (
    <View style={{ flex: 1, minWidth: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: t.c.border }}>
        <IconButton icon={ArrowLeft} label={translate('chat.modelPickerBack')} onPress={() => setShowPreview(false)} />
        <AppText variant="subhead" weight="semibold" numberOfLines={1} style={{ flex: 1 }}>{translate('chat.modelPickerPreviewTitle', { agent: agentName(view) })}</AppText>
        <CopyButton value={preview.data.text} label={translate('chat.copyAll')} />
      </View>
      {/* Readable Git state for people; Copy all and the agent keep the exact text. */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
        <AppText variant="monoSmall" selectable>{readableHandoffText(preview.data.text)}</AppText>
      </ScrollView>
    </View>
  ) : (
    <View style={{ flex: 1, minWidth: 0 }}>
      <View style={{ paddingHorizontal: 8, paddingTop: 8, paddingBottom: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 10, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.c.borderStrong, backgroundColor: t.c.panel }}>
          <Search size={16} color={t.c.fgMuted} />
          <TextInput value={query} onChangeText={setQuery} placeholder={translate('chat.modelPickerSearch')} placeholderTextColor={t.c.fgMuted}
            accessibilityLabel={translate('chat.modelPickerSearch')} autoCapitalize="none" autoCorrect={false} returnKeyType="search" testID="model-search"
            onSubmitEditing={() => { chooseCursor(); }} submitBehavior="blurAndSubmit"
            style={{ flex: 1, color: t.c.fg, fontFamily: t.font.regular, fontSize: 16, paddingVertical: 0 }} />
          {query ? <IconButton icon={X} size={16} label={translate('workbench.threadMapClearSearch')} onPress={() => setQuery('')} /> : null}
        </View>
      </View>
      {/* Outside the scrolling list, so it never covers a row. */}
      {searching ? (showFacts ? head(null) : null) : head(viewAgent)}
      <ScrollView ref={listRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 4 }} keyboardShouldPersistTaps="handled"
        onLayout={e => { listHeight.current = e.nativeEvent.layout.height; }} scrollEventThrottle={32}
        onScroll={e => { listScroll.current = e.nativeEvent.contentOffset.y; }}>
        {list}
      </ScrollView>
    </View>
  );

  const rail = showRail ? (
    <ScrollView style={{ flexGrow: 0, width: 60, backgroundColor: t.c.surface, borderRightWidth: 1, borderRightColor: t.c.border }}
      contentContainerStyle={{ alignItems: 'center', paddingVertical: 8, gap: 6 }} accessibilityLabel={translate('chat.modelPickerAgents')}>
      {pickerAgents.map(a => {
        const inView = view === a.id && !searching;
        return (
          <Press key={a.id} onPress={() => { setQuery(''); changeView(a.id); }} feedback="dim" testID={`picker-agent-${a.id}`}
            accessibilityRole="button" accessibilityState={{ selected: inView }}
            accessibilityLabel={a.id === currentAgentId ? `${a.name} · ${translate('chat.modelPickerCurrent')}` : a.name}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: t.radius.md,
              borderWidth: inView ? 1 : 0, borderColor: t.c.borderStrong, backgroundColor: inView ? t.c.sheet : 'transparent' }}>
            {inView ? <View style={{ position: 'absolute', left: -8, top: 8, bottom: 8, width: 3, borderRadius: 2, backgroundColor: t.c.primary }} /> : null}
            <AgentMark agent={a.id} size={28} />
            {a.id === currentAgentId ? <View style={{ position: 'absolute', right: 3, bottom: 3, width: 9, height: 9, borderRadius: 5, backgroundColor: t.c.primary, borderWidth: 1.5, borderColor: t.c.sheet }} /> : null}
          </Press>
        );
      })}
    </ScrollView>
  ) : null;

  return (
    <KeyCommandsRoot scope>
      <View style={{ flex: 1, flexDirection: 'row', borderTopWidth: 1, borderTopColor: t.c.border }}>
        {rail}
        {column}
      </View>
      {!showPreview && (handoffNote || effort || applies || stopButton) ? (
        <View style={{ gap: 10, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4, borderTopWidth: 1, borderTopColor: t.c.border }}>
          {handoffNote}
          {effort}
          {stopButton}
          {applies}
        </View>
      ) : null}
    </KeyCommandsRoot>
  );
}

function describeFacts(facts: ModelFacts | null) {
  if (!facts) return '';
  const context = formatContextWindow(facts.contextWindow);
  const input = formatUsdPerMillion(facts.inputUsdPerMillion);
  const output = formatUsdPerMillion(facts.outputUsdPerMillion);
  return [
    context ? translate('chat.modelPickerContextValue', { value: context }) : '',
    input || output ? translate('chat.modelPickerPriceValue', { input: input ?? '–', output: output ?? '–' }) : '',
  ].filter(Boolean).join(', ');
}
