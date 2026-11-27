// One pull request under review: a compact header with the actions the host allows, a
// notice when the head moved, then Conversation, Code, Commits, Checks and Guide. Every
// review and merge carries the head the reader loaded; drafts live on the Supervisor so
// phone and desktop share them. Same rules as the Web's PullRequestReview.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, ScrollView, TextInput, View } from 'react-native';
import {
  ChevronLeft, ExternalLink, FileCode2, GitCommitHorizontal, GitMerge, Link2, ListChecks, Map as MapIcon, MessageSquareText, MessagesSquare, MoreHorizontal, RefreshCw,
  Square, SquareCheck, type LucideProps,
} from 'lucide-react-native';
import { reviewAction, type DetailResponse, type Draft, type GuideState, type PullFile, type ReviewEvent } from '@pockymoe/web-git/pr/review/reviewApi';
import { checkCounts } from '@pockymoe/web-git/pr/review/listModel';
import { rt, type ReviewMessage } from '@pockymoe/web-git/pr/review/reviewText';
import { AppText } from '../../design/AppText';
import { Button, IconButton } from '../../design/Button';
import { Press } from '../../design/Press';
import { Banner, EmptyState, Loading } from '../../design/States';
import { Sheet } from '../../design/Sheet';
import { confirmAsync, showMenu, showToast, type MenuItem } from '../../design/Overlay';
import { useTheme } from '../../design/theme';
import { haptic } from '../../design/haptics';
import { translate } from '../../i18n';
import { Segmented } from '../thread/ModelPicker';
import { ChecksTab, CodeTab, CommitsTab, ConversationTab, GuideTab } from './ReviewTabs';
import { StackBar } from './StackBar';
import { Ago, ChecksMark, DecisionMark, PullStateMark, message } from './parts';

export type ReviewTab = 'conversation' | 'code' | 'commits' | 'checks' | 'guide';
const TABS: ReviewTab[] = ['conversation', 'code', 'commits', 'checks', 'guide'];
const TAB_LABEL: Record<ReviewTab, ReviewMessage> = { conversation: 'conversation', code: 'code', commits: 'commits', checks: 'checksTab', guide: 'guide' };
const TAB_ICON: Record<ReviewTab, React.ComponentType<LucideProps>> = { conversation: MessagesSquare, code: FileCode2, commits: GitCommitHorizontal, checks: ListChecks, guide: MapIcon };
const EVENT_LABEL: Record<ReviewEvent, ReviewMessage> = { comment: 'eventComment', approve: 'eventApprove', requestChanges: 'eventRequestChanges' };
const METHOD_LABEL: Record<string, ReviewMessage> = { squash: 'squash', merge: 'mergeCommit', rebase: 'rebase' };
const MERGE_STATE: Record<string, ReviewMessage> = { clean: 'mergeable', conflicts: 'conflicts', blocked: 'blocked', behind: 'behind', unstable: 'unstable' };
const POLL = 60_000;

/** Where an "Ask agent" question goes. */
export type AskTarget = { kind: 'thread'; threadId: string } | { kind: 'new'; workspaceId: string; title: string };
export interface PullRequestReviewProps {
  deviceKey: string;
  url: string;
  onBack?: () => void;
  /** A write changed the PR's row (state, merge, review). */
  onChanged?: () => void;
  /** The thread this review is shown in (the Git pane's PR view): Ask goes there first. */
  currentThreadId?: string | null;
  onAsk?: (target: AskTarget, prompt: string) => void;
  onOpenThread?: (threadId: string) => void;
  /** Another PR of the same stack. */
  onOpenPull?: (url: string) => void;
}

export function PullRequestReview({ deviceKey, url, onBack, onChanged, currentThreadId, onAsk, onOpenThread, onOpenPull }: PullRequestReviewProps) {
  const t = useTheme();
  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<ReviewTab>('conversation');
  const [files, setFiles] = useState<{ headSha: string; files: PullFile[]; viewedOnHost: boolean } | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [guide, setGuide] = useState<GuideState>({ guide: null, stale: false, run: null });
  const [shownHead, setShownHead] = useState('');
  const [latestHead, setLatestHead] = useState('');
  const [dialog, setDialog] = useState<null | 'review' | 'merge' | 'ask'>(null);
  const [ask, setAsk] = useState('');
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const filesWanted = useRef(false);

  const load = useCallback(async (moveHead: boolean) => {
    setLoading(true);
    try {
      const next = await reviewAction<DetailResponse>(deviceKey, 'detail', url);
      setData(next); setDrafts(next.drafts); setGuide(next.guide); setError(null);
      setShownHead(current => !current || moveHead ? next.detail.headSha : current);
      setLatestHead(next.detail.headSha);
      return next;
    } catch (e) { setError(message(e)); return null; } finally { setLoading(false); }
  }, [deviceKey, url]);
  const loadFiles = useCallback(async () => {
    filesWanted.current = true;
    try { setFiles(await reviewAction(deviceKey, 'files', url)); setFilesError(null); } catch (e) { setFilesError(message(e)); }
  }, [deviceKey, url]);
  useEffect(() => { setData(null); setFiles(null); setShownHead(''); filesWanted.current = false; void load(true); }, [load]);
  useEffect(() => { if ((tab === 'code' || tab === 'guide') && !filesWanted.current) void loadFiles(); }, [tab, loadFiles]);
  // New commits during a review: a cheap head poll while the app is in front, and on return.
  useEffect(() => {
    if (!data || data.detail.state !== 'open') return;
    const check = () => { if (AppState.currentState === 'active') void reviewAction<{ headSha: string }>(deviceKey, 'head', url).then(v => setLatestHead(v.headSha)).catch(() => undefined); };
    const timer = setInterval(check, POLL);
    const sub = AppState.addEventListener('change', state => { if (state === 'active') check(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [data, deviceKey, url]);
  // Another device may have changed the drafts: reread them on return to the app.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => { if (state === 'active') void reviewAction<{ drafts: Draft[] }>(deviceKey, 'drafts', url).then(v => setDrafts(v.drafts)).catch(() => undefined); });
    return () => sub.remove();
  }, [deviceKey, url]);
  const running = guide.run?.state === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { void reviewAction<GuideState>(deviceKey, 'guideShow', url, { headSha: shownHead }).then(setGuide).catch(() => undefined); }, 5000);
    return () => clearInterval(timer);
  }, [running, deviceKey, url, shownHead]);

  const act = useCallback(async (action: string, input: Record<string, unknown> = {}, options: { files?: boolean } = {}) => {
    setBusy(true); setActionError(null);
    try {
      const result = await reviewAction<Record<string, unknown>>(deviceKey, action, url, input);
      if (action === 'guide') setGuide(result as unknown as GuideState);
      else if (action !== 'viewed') { await load(false); onChanged?.(); }
      if (options.files) void loadFiles();
      if (action !== 'viewed' && action !== 'guide') haptic.success();
      return result ?? true;
    } catch (e) {
      const text = message(e);
      setActionError(text); haptic.warning();
      if (/head moved/i.test(text)) void reviewAction<{ headSha: string }>(deviceKey, 'head', url).then(v => setLatestHead(v.headSha)).catch(() => undefined);
      return false;
    } finally { setBusy(false); }
  }, [deviceKey, url, load, loadFiles, onChanged]);
  const saveDraft = useCallback(async (input: Partial<Draft> & { kind: Draft['kind'] }) => {
    try { const r = await reviewAction<{ drafts: Draft[] }>(deviceKey, 'draftSave', url, input); setDrafts(r.drafts); return true; }
    catch (e) { setActionError(message(e)); return false; }
  }, [deviceKey, url]);
  const deleteDraft = useCallback((id: string) => {
    void reviewAction<{ drafts: Draft[] }>(deviceKey, 'draftDelete', url, { id }).then(r => setDrafts(r.drafts)).catch(e => setActionError(message(e)));
  }, [deviceKey, url]);
  const setViewed = useCallback((paths: string[], viewed: boolean) => {
    const revisions = Object.fromEntries((files?.files ?? []).filter(f => paths.includes(f.path)).map(f => [f.path, f.digest]));
    setFiles(current => current && { ...current, files: current.files.map(f => paths.includes(f.path) ? { ...f, viewed: viewed ? 'viewed' : 'unviewed' } : f) });
    void reviewAction(deviceKey, 'viewed', url, { paths, viewed, revisions }).catch(e => { setActionError(message(e)); void loadFiles(); });
  }, [deviceKey, url, files, loadFiles]);
  const loadNew = async () => { const next = await load(true); if (next && filesWanted.current) void loadFiles(); };
  const openAsk = (context: string) => { setAsk(context); setDialog('ask'); };

  if (!data) {
    return (
      <View style={{ flex: 1 }}>
        {onBack ? <View style={{ flexDirection: 'row', paddingHorizontal: 4 }}><IconButton icon={ChevronLeft} label={rt('back')} onPress={onBack} /></View> : null}
        {error ? <EmptyState title={rt('failed')} body={error} action={{ label: rt('tryAgain'), onPress: () => void load(true) }} /> : <Loading label={rt('loading')} />}
      </View>
    );
  }
  const { detail } = data;
  const caps = detail.capabilities;
  const open = detail.state === 'open';
  const moved = open && !!latestHead && !!shownHead && latestHead !== shownHead;
  const pendingCount = drafts.filter(d => d.kind !== 'summary').length;
  const counts = checkCounts(detail.checkRuns);
  const linked = data.linkedThreads.filter(th => th.id !== currentThreadId);
  const menuItems: MenuItem[] = [
    { label: rt('openHost'), icon: ExternalLink, onPress: () => void Linking.openURL(detail.url).catch(() => undefined) },
    { label: rt('copyLink'), icon: Link2, copy: detail.url },
    ...(data.workspace && onOpenThread ? [{ label: rt('workOn'), onPress: () => void act('workOn').then(r => { const th = (r as { thread?: { id: string } })?.thread; if (th) { showToast(rt('workOnStarted'), 'success'); onOpenThread(th.id); } }) }] : []),
    ...(onOpenThread ? linked.slice(0, 5).map(th => ({ label: `${rt('openThread')}: ${th.title}`, onPress: () => onOpenThread(th.id) })) : []),
    ...(open && detail.draft && caps.ready ? [{ label: rt('ready'), onPress: () => void act('state', { state: 'ready' }) }] : []),
    ...(open && !detail.draft && caps.convertToDraft ? [{ label: rt('toDraft'), onPress: () => void act('state', { state: 'draft' }) }] : []),
    ...(open && detail.autoMerge && caps.autoMerge ? [{ label: rt('autoMergeOff'), onPress: () => void act('autoMerge', { enable: false }) }] : []),
    ...(data.workspace ? [{ label: guide.guide ? rt('rewriteGuide') : rt('writeGuide'), icon: MapIcon, disabled: running, onPress: () => { setTab('guide'); void act('guide'); } }] : []),
    ...(open && caps.close ? [{ label: rt('close'), destructive: true, onPress: async () => { if (await confirmAsync({ title: rt('closeConfirm', { n: detail.number }), message: rt('closeBody'), confirmLabel: rt('close'), destructive: true })) void act('state', { state: 'close' }); } }] : []),
    ...(detail.state === 'closed' && caps.reopen ? [{ label: rt('reopen'), onPress: () => void act('state', { state: 'reopen' }) }] : []),
    ...(detail.state === 'merged' && caps.revert ? [{ label: rt('revert'), destructive: true, onPress: async () => {
      if (!await confirmAsync({ title: rt('revertConfirm', { n: detail.number }), message: rt('revertBody'), confirmLabel: rt('revert') })) return;
      const r = await act('revert') as { url?: string } | false; if (r && r.url) setNotice(`${rt('revertOpened')}: ${r.url}`);
    } }] : []),
  ];
  const tabs = TABS.filter(item => item !== 'guide' || data.workspace || guide.guide);
  const tabCount = (item: ReviewTab) => item === 'code' ? detail.changedFiles : item === 'commits' ? detail.commits.length : item === 'checks' ? counts.failed : item === 'conversation' ? detail.threads.filter(th => !th.resolved).length : 0;

  return (
    <View style={{ flex: 1 }} testID="pr-review">
      <View style={{ paddingHorizontal: 4, paddingTop: 4, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4 }}>
          {onBack ? <IconButton icon={ChevronLeft} label={rt('back')} onPress={onBack} testID="pr-back" /> : null}
          <View style={{ paddingTop: 10, paddingLeft: onBack ? 0 : 8 }}><PullStateMark state={detail.state} draft={detail.draft} /></View>
          <View style={{ flex: 1, minWidth: 0, paddingTop: 7, paddingLeft: 4 }}>
            <AppText variant="headline" numberOfLines={3} accessibilityRole="header">{detail.title}<AppText variant="headline" tone="muted">{` #${detail.number}`}</AppText></AppText>
          </View>
          <IconButton icon={RefreshCw} label={rt('refresh')} disabled={loading} onPress={() => { void load(false); if (filesWanted.current) void loadFiles(); }} />
          <IconButton icon={MoreHorizontal} label={rt('more')} onPress={() => showMenu({ title: `#${detail.number}`, items: menuItems })} testID="pr-more" />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingLeft: onBack ? 44 : 12, paddingRight: 8 }}>
          <AppText variant="caption" tone="muted" numberOfLines={1}>{`${detail.repository.owner}/${detail.repository.name}`}</AppText>
          {detail.author ? <AppText variant="caption" tone="soft" numberOfLines={1}>{detail.author.login}</AppText> : null}
          <AppText variant="monoSmall" tone="muted" numberOfLines={1} style={{ fontSize: 11, flexShrink: 1 }} ellipsizeMode="middle">{`${detail.headRef} → ${detail.baseRef}`}</AppText>
          <Ago value={detail.updatedAt} />
          <ChecksMark checks={detail.checks} /><DecisionMark decision={detail.reviewDecision} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 6 }}>
          {caps.submit.length ? <Button label={pendingCount ? `${rt('reviewButton')} · ${pendingCount}` : rt('reviewButton')} icon={MessageSquareText} size="sm" kind={pendingCount ? 'primary' : 'secondary'} onPress={() => setDialog('review')}
            accessibilityHint={pendingCount ? (pendingCount === 1 ? rt('pendingOne') : rt('pendingComments', { n: pendingCount })) : undefined} testID="pr-review-button" /> : null}
          {open && (caps.merge || caps.autoMerge) ? (detail.autoMerge
            ? <AppText variant="caption" tone="accent">{rt('autoMergeArmed')}</AppText>
            : <Button label={rt('merge')} icon={GitMerge} size="sm" onPress={() => setDialog('merge')} testID="pr-merge-button" />) : null}
          <View style={{ flex: 1 }} />
          {detail.mergeState && open && MERGE_STATE[detail.mergeState] ? <AppText variant="caption" color={detail.mergeState === 'clean' ? t.c.online : t.c.warning} numberOfLines={1}>{rt(MERGE_STATE[detail.mergeState]!)}</AppText> : null}
        </View>
        {data.stack ? <StackBar stack={data.stack} detail={detail} busy={busy} canRebase={!!data.workspace?.id}
          onOpen={layer => onOpenPull ? onOpenPull(layer.url) : void Linking.openURL(layer.url).catch(() => undefined)}
          onAct={async (action, input) => { const result = await act(action, input, { files: true }); if (result) setNotice(rt('stackDone')); return result; }} /> : null}
        {moved ? <Banner tone="warning" text={translate('review.newCommitsShort', { sha: shownHead.slice(0, 7) })} action={{ label: translate('review.load'), onPress: () => void loadNew() }} /> : null}
        {actionError ? <Banner tone="danger" text={`${rt('failed')}: ${actionError}`} action={{ label: translate('workbench.close'), onPress: () => setActionError(null) }} /> : notice ? <Banner tone="info" text={notice} action={{ label: translate('workbench.close'), onPress: () => setNotice(null) }} /> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" style={{ flexGrow: 0, borderBottomWidth: 1, borderBottomColor: t.c.border }} contentContainerStyle={{ paddingHorizontal: 6, gap: 2 }}>
        {tabs.map(item => {
          const Icon = TAB_ICON[item];
          const on = tab === item;
          const n = tabCount(item);
          return (
            <Press key={item} onPress={() => { haptic.selection(); setTab(item); }} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={n ? `${rt(TAB_LABEL[item])}, ${n}` : rt(TAB_LABEL[item])}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 42, paddingHorizontal: 10, borderBottomWidth: 2, borderBottomColor: on ? t.c.primary : 'transparent' }} testID={`pr-tab-${item}`}>
              <Icon size={16} color={on ? t.c.primary : t.c.fgSoft} />
              {on ? <AppText variant="subhead" weight="semibold" color={t.c.fg}>{rt(TAB_LABEL[item])}</AppText> : null}
              {n ? <AppText variant="caption" color={item === 'checks' ? t.c.failed : t.c.fgMuted}>{n}</AppText> : null}
            </Press>
          );
        })}
      </ScrollView>
      <View style={{ flex: 1 }}>
        {/* Text reads in a column on wide windows; Code keeps the width for split diffs. */}
        {tab === 'conversation' ? <Column><ConversationTab data={data} act={act} busy={busy} /></Column> : null}
        {tab === 'code' ? <CodeTab key={focusPath ?? ''} detail={detail} files={files} filesError={filesError} drafts={drafts} shownHead={shownHead} act={act} busy={busy}
          saveDraft={saveDraft} deleteDraft={deleteDraft} setViewed={setViewed} onAsk={openAsk} onRetry={() => void loadFiles()} focusPath={focusPath} /> : null}
        {tab === 'commits' ? <Column><CommitsTab detail={detail} /></Column> : null}
        {tab === 'checks' ? <Column><ChecksTab detail={detail} act={act} busy={busy} /></Column> : null}
        {tab === 'guide' ? <Column><GuideTab detail={detail} guide={guide} shownHead={shownHead} act={act} busy={busy} drafts={drafts} saveDraft={saveDraft} onAsk={openAsk} canWrite={!!data.workspace}
          onOpenFile={path => { setFocusPath(path); setTab('code'); }} /></Column> : null}
      </View>
      <SubmitSheet visible={dialog === 'review'} drafts={drafts} events={caps.submit} head={shownHead} moved={moved} busy={busy} host={detail.repository.kind}
        onSummary={body => void saveDraft({ kind: 'summary', body })} onLoadNew={() => void loadNew()} onClose={() => setDialog(null)}
        onDiscardAll={() => void reviewAction<{ drafts: Draft[] }>(deviceKey, 'draftDelete', url, { all: true }).then(r => setDrafts(r.drafts))}
        onSubmit={async (event, body) => { const ok = await act('submit', { event, body, expectedHead: shownHead }); if (ok) setDialog(null); return !!ok; }} />
      <MergeSheet visible={dialog === 'merge'} data={data} head={shownHead} moved={moved} busy={busy} deviceKey={deviceKey} onClose={() => setDialog(null)} onLoadNew={() => void loadNew()}
        onMerge={async (input, auto) => { const ok = await act(auto ? 'autoMerge' : 'merge', { ...input, expectedHead: shownHead, enable: true }); if (ok) setDialog(null); }} />
      <AskSheet visible={dialog === 'ask'} context={ask} data={data} currentThreadId={currentThreadId ?? null} onClose={() => setDialog(null)}
        onSend={(target, prompt) => { setDialog(null); onAsk?.(target, prompt); }} canSend={!!onAsk} />
    </View>
  );
}

/** A reading column (about 820 dp) centered on wide windows. */
function Column({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, width: '100%', maxWidth: 820, alignSelf: 'center' }}>{children}</View>;
}

function Check({ on, label, onPress, disabled }: { on: boolean; label: string; onPress(): void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Press onPress={onPress} disabled={disabled} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: !!disabled }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
      {on ? <SquareCheck size={20} color={t.c.primary} /> : <Square size={20} color={t.c.fgMuted} />}
      <AppText variant="callout" style={{ flex: 1 }}>{label}</AppText>
    </Press>
  );
}
function Box({ value, onChange, label, onBlur }: { value: string; onChange(v: string): void; label: string; onBlur?: () => void }) {
  const t = useTheme();
  return <TextInput underlineColorAndroid="transparent" value={value} onChangeText={onChange} onBlur={onBlur} accessibilityLabel={label} placeholder={label} placeholderTextColor={t.c.fgMuted} multiline textAlignVertical="top" selectionColor={t.c.primary}
    style={{ minHeight: 96, maxHeight: 220, borderWidth: 1, borderColor: t.c.borderStrong, borderRadius: t.radius.md, padding: 10, color: t.c.fg, fontFamily: t.font.regular, fontSize: 15, backgroundColor: t.c.panel }} />;
}

function SubmitSheet({ visible, drafts, events, head, moved, busy, host, onSummary, onDiscardAll, onSubmit, onClose, onLoadNew }: {
  visible: boolean; drafts: Draft[]; events: ReviewEvent[]; head: string; moved: boolean; busy: boolean; host: string;
  onSummary(body: string): void; onDiscardAll(): void; onSubmit(event: ReviewEvent, body: string): Promise<boolean>; onClose(): void; onLoadNew(): void;
}) {
  const saved = drafts.find(d => d.kind === 'summary')?.body ?? '';
  const [body, setBody] = useState(saved);
  const [event, setEvent] = useState<ReviewEvent>(events.includes('comment') ? 'comment' : events[0] ?? 'comment');
  useEffect(() => { if (visible) setBody(saved); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = drafts.filter(d => d.kind !== 'summary');
  const needsBody = event === 'requestChanges' && host === 'forgejo';
  const ready = event === 'approve' || !!body.trim() || (!needsBody && pending.length > 0);
  // The summary is a draft too: kept on the device while the sheet is closed.
  const persist = () => { if (body !== saved) onSummary(body); };
  const close = () => { persist(); onClose(); };
  return (
    <Sheet visible={visible} onClose={close} title={rt('submitReview')} subtitle={rt('reviewHead', { sha: head.slice(0, 7) })} dismissable={!busy}
      footer={<><Button label={rt('cancel')} onPress={close} style={{ flex: 1, maxWidth: 220 }} />
        <Button label={rt('submitReview')} kind="primary" busy={busy} disabled={!ready || (needsBody && !body.trim())} onPress={() => { persist(); void onSubmit(event, body); }} style={{ flex: 1, maxWidth: 220 }} testID="pr-submit" /></>}>
      <View style={{ gap: 12 }}>
        <Segmented label={rt('reviewButton')} value={event} onChange={setEvent} options={events.map(e => ({ value: e, label: rt(EVENT_LABEL[e]) }))} />
        <Box value={body} onChange={setBody} onBlur={persist} label={needsBody ? rt('summaryRequired') : rt('summaryOptional')} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <AppText variant="footnote" tone="muted" style={{ flex: 1 }}>{pending.length ? (pending.length === 1 ? rt('pendingOne') : rt('pendingComments', { n: pending.length })) : rt('noPending')}</AppText>
          {pending.length ? <Button label={rt('discardAll')} size="sm" kind="ghost" onPress={async () => { if (await confirmAsync({ title: rt('discardConfirm', { n: pending.length }), message: rt('pendingNote'), confirmLabel: rt('discard'), destructive: true })) onDiscardAll(); }} /> : null}
        </View>
        {moved ? <Banner tone="warning" text={rt('newCommits', { sha: head.slice(0, 7) })} action={{ label: rt('loadNew'), onPress: onLoadNew }} /> : null}
      </View>
    </Sheet>
  );
}

function MergeSheet({ visible, data, head, moved, busy, deviceKey, onClose, onMerge, onLoadNew }: {
  visible: boolean; data: DetailResponse; head: string; moved: boolean; busy: boolean; deviceKey: string;
  onClose(): void; onMerge(input: { method: string; removeAgentCredits: boolean }, auto: boolean): Promise<void>; onLoadNew(): void;
}) {
  const t = useTheme();
  const { detail } = data;
  const [method, setMethod] = useState(detail.mergeMethods[0] ?? 'squash');
  const [auto, setAuto] = useState(false);
  const [strip, setStrip] = useState(data.removeAgentCredits);
  const [preview, setPreview] = useState<{ title: string; body: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const canStrip = detail.capabilities.removeCredits && method !== 'rebase';
  const checksPassing = detail.checks === 'passed' || detail.checks === 'none';
  const canAuto = detail.capabilities.autoMerge && !checksPassing;
  useEffect(() => {
    if (!visible || !strip || !canStrip) { setPreview(null); return; }
    let alive = true; setPreview(null); setPreviewError(null);
    reviewAction<{ title: string; body: string }>(deviceKey, 'mergeMessage', detail.url, { method }).then(v => { if (alive) setPreview(v); }, e => { if (alive) setPreviewError(message(e)); });
    return () => { alive = false; };
  }, [visible, strip, canStrip, method, deviceKey, detail.url]);
  return (
    <Sheet visible={visible} onClose={onClose} title={rt('mergeTitle', { n: detail.number })} subtitle={rt('mergeHead', { sha: head.slice(0, 7) })} dismissable={!busy}
      footer={<>
        <Button label={rt('cancel')} onPress={onClose} style={{ flex: 1, maxWidth: 220 }} />
        {canAuto && (auto || !detail.capabilities.merge)
          ? <Button label={rt('autoMerge')} kind="primary" icon={GitMerge} busy={busy} disabled={moved} onPress={() => void onMerge({ method, removeAgentCredits: strip && canStrip }, true)} style={{ flex: 1, maxWidth: 220 }} testID="pr-merge-confirm" />
          : detail.capabilities.merge ? <Button label={rt('merge')} kind="danger" icon={GitMerge} busy={busy} disabled={moved || detail.mergeable === false} onPress={() => void onMerge({ method, removeAgentCredits: strip && canStrip }, false)} style={{ flex: 1, maxWidth: 220 }} testID="pr-merge-confirm" /> : null}
      </>}>
      <View style={{ gap: 10 }}>
        {detail.mergeMethods.length > 1 ? <View style={{ gap: 6 }}><AppText variant="caption" tone="muted">{rt('mergeMethod')}</AppText>
          <Segmented label={rt('mergeMethod')} value={method} onChange={setMethod} options={detail.mergeMethods.map(m => ({ value: m, label: rt(METHOD_LABEL[m] ?? 'mergeCommit') }))} /></View> : null}
        {canAuto && detail.capabilities.merge ? <Check on={auto} label={rt('autoMergeOn')} onPress={() => setAuto(v => !v)} /> : null}
        {detail.capabilities.removeCredits ? <Check on={strip && canStrip} disabled={!canStrip} label={rt('removeCredits')} onPress={() => setStrip(v => !v)} /> : null}
        {canStrip && strip ? <AppText variant="footnote" tone="muted">{rt('removeCreditsHint')}</AppText> : detail.capabilities.removeCredits ? <AppText variant="footnote" tone="muted">{rt('removeCreditsRebase')}</AppText> : null}
        {strip && canStrip ? (preview ? (
          <View accessibilityLabel={rt('mergeMessage')} style={{ gap: 4, padding: 10, borderRadius: t.radius.md, backgroundColor: t.c.code, borderWidth: 1, borderColor: t.c.border }}>
            <AppText variant="subhead" weight="semibold">{preview.title}</AppText>
            {preview.body ? <AppText variant="monoSmall" tone="soft" numberOfLines={12}>{preview.body}</AppText> : null}
          </View>
        ) : previewError ? <AppText variant="footnote" tone="danger">{previewError}</AppText> : <AppText variant="footnote" tone="muted">{rt('loading')}</AppText>) : null}
        {detail.mergeState && MERGE_STATE[detail.mergeState] ? <AppText variant="subhead" color={detail.mergeState === 'clean' ? t.c.online : t.c.warning}>{rt(MERGE_STATE[detail.mergeState]!)}</AppText> : null}
        {moved ? <Banner tone="warning" text={rt('newCommits', { sha: head.slice(0, 7) })} action={{ label: rt('loadNew'), onPress: onLoadNew }} /> : null}
      </View>
    </Sheet>
  );
}

function AskSheet({ visible, context, data, currentThreadId, onClose, onSend, canSend }: { visible: boolean; context: string; data: DetailResponse; currentThreadId: string | null; onClose(): void; onSend(target: AskTarget, prompt: string): void; canSend: boolean }) {
  const split = context.includes('\n\n') ? context.lastIndexOf('\n\n') : -1;
  const quoted = split >= 0 ? context.slice(0, split) : context;
  const [question, setQuestion] = useState('');
  const options = [
    ...(currentThreadId ? [{ value: currentThreadId, label: translate('review.thisThread') }] : []),
    ...data.linkedThreads.filter(th => th.id !== currentThreadId).map(th => ({ value: th.id, label: th.title })),
    ...(data.workspace?.id ? [{ value: 'new', label: rt('askNew') }] : []),
  ];
  const [target, setTarget] = useState(options[0]?.value ?? 'new');
  useEffect(() => { if (visible) { setQuestion(split >= 0 ? context.slice(split + 2) : ''); setTarget(options[0]?.value ?? 'new'); } }, [visible, context]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = useTheme();
  const prompt = `${data.detail.url}\n${quoted}\n\n${question}`.trim();
  const send = () => onSend(target === 'new' ? { kind: 'new', workspaceId: data.workspace!.id!, title: `PR #${data.detail.number}` } : { kind: 'thread', threadId: target }, prompt);
  return (
    <Sheet visible={visible} onClose={onClose} title={rt('askTitle')}
      footer={<><Button label={rt('cancel')} onPress={onClose} style={{ flex: 1, maxWidth: 220 }} />
        <Button label={rt('askSend')} kind="primary" disabled={!canSend || !question.trim() || !options.length} onPress={send} style={{ flex: 1, maxWidth: 220 }} /></>}>
      <View style={{ gap: 10 }}>
        {quoted ? <View style={{ maxHeight: 140, padding: 8, borderRadius: t.radius.md, backgroundColor: t.c.code, borderWidth: 1, borderColor: t.c.border }}><AppText variant="monoSmall" tone="soft" numberOfLines={8}>{quoted}</AppText></View> : null}
        <Box value={question} onChange={setQuestion} label={rt('askQuestion')} />
        {options.length > 1 ? <View style={{ gap: 6 }}><AppText variant="caption" tone="muted">{rt('askTarget')}</AppText><Segmented label={rt('askTarget')} value={target} onChange={setTarget} options={options} /></View> : null}
      </View>
    </Sheet>
  );
}
