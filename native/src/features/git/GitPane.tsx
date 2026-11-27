// The thread's Git inspector (docs/git.md), as the Web's Git panel is, sized for a thumb:
// one line says where (branch, HEAD, ahead/behind, sync, ⋯), one row of chips picks the
// view (Turn, PR, Unstaged, Staged, Compare, Commits), then the file list sits above the
// scope's combined diff in one scroll. A file opens alone with Back and previous/next.
// Owners stage, unstage and discard files and hunks, commit (generated message, amend,
// commit and push), switch and create branches, fetch/pull/push and stash; a turn's files
// restore to before or after it with a preview and Undo. Shares only read. It refreshes
// when opened, on Git/turn events and on pull-to-refresh; it never polls.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, TextInput, View } from 'react-native';
import {
  Archive, ArrowDownToLine, ArrowUpFromLine, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, GitBranch, GitCommitHorizontal, GitPullRequest,
  History, Info, MapPin, MoreHorizontal, Redo2, RefreshCw, RotateCcw, Sparkles, Undo2,
} from 'lucide-react-native';
import {
  fetchCheckpoints, fetchThreadGitCommits, fetchThreadGitDiff, fetchThreadGitStatus, fetchThreadWorkingContext,
  type GitCommit, type GitCommits, type GitDiff, type GitDiffArea, type GitStatus, type ThreadWorkingContext, type TurnCheckpoint,
} from '@pockymoe/web/gitApi';
import { gitText as gt } from '@pockymoe/web/gitI18n';
import { ApiError } from '../../protocol/webApiShim';
import { AppText } from '../../design/AppText';
import { Button, IconButton } from '../../design/Button';
import { CopyButton, PathChip } from '../../design/Copy';
import { Press } from '../../design/Press';
import { Banner, EmptyState } from '../../design/States';
import { confirmAsync, showMenu, showToast, type MenuItem } from '../../design/Overlay';
import { useTheme } from '../../design/theme';
import { haptic } from '../../design/haptics';
import { formatDate, formatNumber, translate } from '../../i18n';
import { onDeviceEvent } from '../../state/deviceData';
import { DiffViewer, Stat, type DiffComment } from '../diff/DiffViewer';
import { parsePatch, rangeLabel, totals, type PatchFile } from '../diff/model';
import { diffPrefs } from '../diff/prefs';
import { Badge, baseName, fileChange, FileRow, shortOid, ViewChips, type ChipOption, type ListedFile } from './GitParts';
import { BranchSheet, CommitSheet, CopiesSheet, DetailsSheet, RestoreSheet, StashSheet } from './GitSheets';
import { errorText, useGitWrite } from './useGitWrite';

export type GitView = 'turn' | 'pr' | 'worktree' | 'index' | 'branch' | 'commits';
export interface GitPaneProps {
  deviceKey: string;
  threadId: string;
  /** Owner access: writes, checkpoints and PRs. Shares read only. */
  canWrite: boolean;
  running: boolean;
  /** A turn's changes chip opened this pane on that turn. */
  initialTurnId?: string | null;
  initialView?: GitView | null;
  /** Lines selected in a diff become a review chip in the thread's composer. */
  onReviewQuote?: (quote: { path: string; startLine: number; endLine: number; text: string; comment: string }) => boolean;
  /** Text for the thread's composer (resolve conflicts, ask about lines). */
  onAsk?: (prompt: string) => void;
  /** Opens a path in the Files pane. */
  onOpenPath?: (path: string) => void;
  /** The PR view (linked PRs, review) — supplied by the PR feature. */
  renderPullRequests?: (props: { workingCopyId: string }) => React.ReactNode;
}

const PAGE = 30;
const SOURCE_AREA: Partial<Record<GitView, GitDiffArea>> = { worktree: 'worktree', index: 'index', branch: 'branch', turn: 'turn' };

export function GitPane({ deviceKey, threadId, canWrite, running, initialTurnId, initialView, onReviewQuote, onAsk, onOpenPath, renderPullRequests }: GitPaneProps) {
  const t = useTheme();
  const whitespace = diffPrefs.useValue(s => s.whitespace);
  const [context, setContext] = useState<ThreadWorkingContext | null>(null);
  const [selected, setSelected] = useState('');
  const [view, setView] = useState<GitView>(initialView ?? (initialTurnId ? 'turn' : 'worktree'));
  const [path, setPath] = useState('');
  const [commit, setCommit] = useState<GitCommit | null>(null);
  const [baseDraft, setBaseDraft] = useState('HEAD');
  const [base, setBase] = useState('HEAD');
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [scopeFiles, setScopeFiles] = useState<{ scope: string; files: PatchFile[] } | null>(null);
  const [commits, setCommits] = useState<GitCommits | null>(null);
  const [offset, setOffset] = useState(0);
  const [turns, setTurns] = useState<TurnCheckpoint[]>([]);
  const [turnId, setTurnId] = useState(initialTurnId ?? '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [revision, setRevision] = useState(0);
  const [sheet, setSheet] = useState<null | 'branch' | 'stash' | 'commit' | 'copies' | 'details'>(null);
  const [restore, setRestore] = useState<{ phase: 'start' | 'end'; files: string[] | null } | null>(null);
  const [undoId, setUndoId] = useState<string | null>(null);
  const showFailure = useRef(true);
  const refresh = useCallback(() => { showFailure.current = true; setRevision(v => v + 1); }, []);
  useEffect(() => { if (initialTurnId) { setTurnId(initialTurnId); setView('turn'); setPath(''); } }, [initialTurnId]);
  useEffect(() => { if (initialView) setView(initialView); }, [initialView]);

  // Where: the thread's working copies.
  useEffect(() => {
    let live = true; setError(null);
    fetchThreadWorkingContext(threadId, deviceKey).then(value => {
      if (!live) return;
      setContext(value);
      setSelected(current => value.workingCopies.some(c => c.id === current) ? current : value.primaryWorkingCopyId ?? value.workingCopies[0]?.id ?? '');
      if (!value.workingCopies.length) setLoading(false);
    }, e => { if (live) { if (showFailure.current) setError(e); setLoading(false); } });
    return () => { live = false; };
  }, [threadId, deviceKey, revision]);
  useEffect(() => {
    let live = true;
    fetchCheckpoints(threadId, deviceKey).then(v => { if (!live) return; setTurns(v.turns); setTurnId(current => current || v.turns.at(-1)?.turnId || ''); }, () => undefined);
    return () => { live = false; };
  }, [threadId, deviceKey, revision]);
  // Git writes, restores and finished turns announce themselves; a burst refreshes once.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = onDeviceEvent(deviceKey, event => {
      if (event.threadId !== threadId) return;
      const reason = event.type === 'thread.updated' ? (event.payload as { reason?: string }).reason : undefined;
      if (event.type !== 'thread.turn.completed' && reason !== 'gitChanged' && reason !== 'checkpointsChanged' && reason !== 'historyRewound') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { showFailure.current = false; setRevision(v => v + 1); }, 400);
    });
    return () => { off(); if (timer) clearTimeout(timer); };
  }, [deviceKey, threadId]);

  const contextReady = !!context;
  const area: GitDiffArea | null = view === 'commits' ? (commit ? 'commit' : null) : SOURCE_AREA[view] ?? null;
  const diffBase = area === 'commit' ? commit?.oid ?? '' : base;
  const areaScope = JSON.stringify([selected, area, area === 'branch' || area === 'commit' ? diffBase : area === 'turn' ? turnId : '', whitespace]);
  useEffect(() => {
    if (!context || !selected || view === 'pr' || (area === 'turn' && !turnId)) { if (context && (!selected || area === 'turn')) setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    const scope = JSON.stringify([selected, area, path, diffBase, offset, turnId, whitespace]);
    if (showFailure.current) { setError(null); }
    if (!area) {
      fetchThreadGitCommits(threadId, selected, offset, deviceKey, controller.signal).then(v => { if (!controller.signal.aborted) setCommits(v); },
        e => { if (!controller.signal.aborted && showFailure.current) setError(e); }).finally(() => { if (!controller.signal.aborted) { setLoading(false); showFailure.current = false; } });
      return () => controller.abort();
    }
    Promise.all([
      fetchThreadGitStatus(threadId, selected, deviceKey, controller.signal),
      fetchThreadGitDiff(threadId, selected, { area, ...(whitespace ? { ignoreWhitespace: true } : {}), ...(area === 'turn' ? { turnId } : {}), ...(path ? { path } : {}), ...(area === 'branch' || area === 'commit' ? { base: diffBase } : {}) }, deviceKey, controller.signal),
    ]).then(([nextStatus, nextDiff]) => {
      if (controller.signal.aborted) return;
      setStatus(nextStatus); setDiff(nextDiff);
      if (!path) setScopeFiles({ scope: areaScope, files: parsePatch(nextDiff.patch).files });
    }, e => { if (!controller.signal.aborted && showFailure.current) setError(e); })
      .finally(() => { if (!controller.signal.aborted) { setLoading(false); showFailure.current = false; } });
    void scope;
    return () => controller.abort();
    // areaScope derives from the listed values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, deviceKey, selected, contextReady, area, path, diffBase, offset, turnId, whitespace, view, revision]);

  const onWritten = useCallback((next?: GitStatus) => { if (next) setStatus(next); refresh(); }, [refresh]);
  const { write, busy } = useGitWrite(threadId, selected || null, deviceKey, running, onWritten);

  const copy = context?.workingCopies.find(c => c.id === selected);
  const many = (context?.workingCopies.length ?? 0) > 1;
  const latest = context?.observations.filter(o => !o.agentId).sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
  const observedOutside = latest && latest.workingCopyId !== context?.primaryWorkingCopyId ? latest : undefined;
  const observedCopy = observedOutside && context?.workingCopies.find(c => c.id === observedOutside.workingCopyId);
  const known = scopeFiles?.scope === areaScope ? scopeFiles.files : null;
  const stats = useMemo(() => new Map((known ?? []).map(f => [f.path, f])), [known]);
  const unstaged = status?.files.filter(f => f.worktreeStatus !== ' ') ?? [];
  const staged = status?.files.filter(f => f.indexStatus !== ' ' && f.indexStatus !== '?') ?? [];
  const listed: ListedFile[] = (area === 'worktree' ? unstaged.map(f => ({ path: f.path, originalPath: f.originalPath, change: fileChange(f.worktreeStatus === '?' ? '?' : f.worktreeStatus, f.indexStatus) }))
    : area === 'index' ? staged.map(f => ({ path: f.path, originalPath: f.originalPath, change: fileChange(f.indexStatus, f.worktreeStatus) }))
    : (known ?? []).map(f => ({ path: f.path, originalPath: f.oldPath, change: f.created ? 'added' as const : f.removed ? 'deleted' as const : f.oldPath ? 'renamed' as const : 'modified' as const })))
    .map(f => { const s = stats.get(f.path); return s ? { ...f, additions: s.additions, deletions: s.deletions, binary: s.binary } : f; });
  const listReady = area === 'worktree' || area === 'index' ? !!status : !!known;
  const sum = totals(known ?? []);
  const current = path ? listed.findIndex(f => f.path === path) : -1;
  const selectView = (next: GitView) => { setView(next); setCommit(null); setPath(''); setDiff(null); };
  const selectCopy = (id: string) => { setSelected(id); setStatus(null); setDiff(null); setCommit(null); setOffset(0); setPath(''); };
  const openFile = (next: string) => { haptic.selection(); setPath(next); setDiff(null); };

  const unavailable = error instanceof ApiError && [403, 404, 501].includes(error.statusCode);
  const errorMessage = error instanceof ApiError && error.statusCode === 403 ? translate('workbench.gitAccessUnavailable') : unavailable ? translate('workbench.gitUnavailable') : translate('workbench.gitLoadFailed');

  const pull = (mode: 'ffOnly' | 'rebase' | 'merge') => void write('git/pull', { mode });
  const push = async (force = false) => {
    if (force && !await confirmAsync({ title: translate('review.forcePush'), message: translate('review.forcePushBody', { upstream: status?.upstream ?? '' }), confirmLabel: translate('review.forcePush'), destructive: true })) return;
    await write('git/push', { setUpstream: !status?.upstream, ...(force ? { forceWithLease: true } : {}) });
  };
  const moreMenu = () => {
    const items: MenuItem[] = [
      { label: gt('fetch'), icon: Download, onPress: () => void write('git/fetch') },
      { label: `${gt('pull')}…`, icon: ArrowDownToLine, hint: status?.behind ? translate('review.toPull', { count: status.behind }) : undefined, onPress: () => setTimeout(() => showMenu({ title: gt('pull'), items: [
        { label: translate('review.pullFfOnly'), onPress: () => pull('ffOnly') },
        { label: translate('review.pullRebase'), onPress: () => pull('rebase') },
        { label: translate('review.pullMerge'), onPress: () => pull('merge') },
      ] }), 250) },
      { label: status?.upstream ? gt('push') : translate('review.pushUpstream'), icon: ArrowUpFromLine, onPress: () => void push(false) },
      ...(status?.upstream ? [{ label: translate('review.forcePush'), icon: ArrowUpFromLine, destructive: true, onPress: () => void push(true) }] : []),
      { label: translate('review.stashes'), icon: Archive, hint: status?.stashCount ? translate('review.stashCount', { count: status.stashCount }) : undefined, onPress: () => setSheet('stash') },
      { label: gt('branch'), icon: GitBranch, onPress: () => setSheet('branch') },
      { label: gt('details'), icon: Info, onPress: () => setSheet('details') },
      { label: translate('workbench.gitRefresh'), icon: RefreshCw, onPress: refresh },
    ];
    showMenu({ title: status?.branch ?? copy?.branch ?? 'Git', items: canWrite ? items : items.slice(-2) });
  };
  // One sync control in thumb reach: push when ahead, pull when behind, else fetch.
  const sync = !canWrite || !status ? null : status.behind ? { icon: ArrowDownToLine, label: `${gt('pull')} ↓${status.behind}`, run: () => pull('ffOnly') }
    : status.ahead || (!status.upstream && status.branch) ? { icon: ArrowUpFromLine, label: status.upstream ? `${gt('push')} ↑${status.ahead}` : translate('review.pushUpstream'), run: () => void push(false) }
    : { icon: Download, label: gt('fetch'), run: () => void write('git/fetch') };

  const fileMenu = (file: ListedFile) => showMenu({ title: file.path, items: [
    ...(canWrite && area === 'worktree' ? [{ label: gt('stage'), onPress: () => void write('git/stage', { paths: [file.path] }) },
      { label: gt('discard'), destructive: true, onPress: () => void write('git/discard', { paths: [file.path] }) }] : []),
    ...(canWrite && area === 'index' ? [{ label: gt('unstage'), onPress: () => void write('git/unstage', { paths: [file.path] }) }] : []),
    ...(onOpenPath && file.change !== 'deleted' ? [{ label: translate('review.openInFiles'), onPress: () => onOpenPath(file.path) }] : []),
    { label: translate('common.copyPath'), copy: file.path },
  ] });

  const comment: DiffComment | null = onReviewQuote ? {
    label: translate('review.addToPrompt'),
    onSubmit: (s, text) => { const ok = onReviewQuote({ path: s.path, startLine: s.start, endLine: s.end, text: s.text, comment: text }); if (ok) showToast(translate('review.quoteAdded'), 'success'); return ok; },
    ...(onAsk ? { secondary: { label: translate('review.askAgent'), run: (s, text) => onAsk(`${s.path}:${rangeLabel(s)}\n\`\`\`\n${s.text}\n\`\`\`\n\n${text}`) } } : {}),
  } : null;
  const hunkActions = canWrite && diff && !whitespace && !diff.truncated && (area === 'worktree' || area === 'index')
    ? { actions: area === 'index' ? ['unstage' as const] : ['stage' as const, 'discard' as const], busy: !!busy, run: (action: 'stage' | 'unstage' | 'discard', patch: string) => void write(`git/${action}`, { patch }) }
    : null;

  // ——— Pieces of the header ———
  const where = copy || error ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 6, paddingRight: 2, minHeight: 48 }}>
      {copy ? (
        <Press onPress={() => many ? setSheet('copies') : canWrite ? setSheet('branch') : setSheet('details')} feedback="dim" accessibilityRole="button"
          accessibilityLabel={`${gt('branch')}: ${status?.branch ?? copy.branch ?? translate('workbench.gitDetached')}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, height: 36, borderRadius: t.radius.md, backgroundColor: t.c.surface, flexShrink: 1 }}>
          <GitBranch size={15} color={t.c.fgSoft} />
          <AppText variant="subhead" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>{status?.branch ?? copy.branch ?? translate('workbench.gitDetached')}</AppText>
          {many ? <AppText variant="caption" tone="muted" numberOfLines={1}>{baseName(copy.path)}</AppText> : null}
          <ChevronDown size={14} color={t.c.fgMuted} />
        </Press>
      ) : null}
      {status?.ahead ? <Badge text={`↑${status.ahead}`} tone="accent" label={translate('review.toPush', { count: status.ahead })} /> : null}
      {status?.behind ? <Badge text={`↓${status.behind}`} tone="warning" label={translate('review.toPull', { count: status.behind })} /> : null}
      {copy && (status?.head ?? copy.head) ? <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <AppText variant="monoSmall" tone="muted">{shortOid((status?.head ?? copy.head)!)}</AppText>
        <CopyButton value={(status?.head ?? copy.head)!} label={gt('copyHead')} size={14} />
      </View> : null}
      <View style={{ flex: 1 }} />
      {loading ? <ActivityIndicator size="small" color={t.c.fgMuted} accessibilityLabel={translate('workbench.gitLoading')} /> : null}
      {sync ? <IconButton icon={sync.icon} label={sync.label} onPress={sync.run} disabled={!!busy} testID="git-sync" /> : null}
      <IconButton icon={MoreHorizontal} label={translate('review.moreActions')} onPress={moreMenu} testID="git-more" />
    </View>
  ) : null;

  const notes = (
    <View style={{ gap: 6, paddingHorizontal: 10 }}>
      {error && (context || status) ? <Banner tone="danger" text={errorMessage} action={{ label: translate('common.retry'), onPress: refresh }} /> : null}
      {copy && observedOutside ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, minHeight: 36, borderRadius: t.radius.md, backgroundColor: t.c.surface }}>
          <MapPin size={14} color={t.c.fgSoft} />
          <AppText variant="footnote" tone="soft" style={{ flex: 1 }} numberOfLines={2}>{observedCopy ? observedCopy.id === selected ? gt('recentHere') : gt('recentIn', { name: observedCopy.branch ?? baseName(observedCopy.path) }) : gt('recentElsewhere')}</AppText>
          {observedCopy && observedCopy.id !== selected ? <Button label={gt('viewObserved')} size="sm" kind="ghost" onPress={() => selectCopy(observedCopy.id)} /> : null}
        </View>
      ) : null}
      {status?.operation ? <Banner tone="warning" text={translate('review.operation', { name: status.operation })} /> : null}
      {status?.conflicted?.length ? (
        <View style={{ gap: 6, padding: 10, borderRadius: t.radius.md, backgroundColor: t.c.dangerBg, borderWidth: 1, borderColor: t.c.dangerBorder }}>
          <AppText variant="subhead" weight="semibold" tone="danger">{`${gt('conflicts')} · ${status.conflicted.length}`}</AppText>
          {status.conflicted.slice(0, 6).map(p => <PathChip key={p} path={p} />)}
          {onAsk ? <Button label={gt('resolve')} size="sm" kind="primary" icon={Sparkles} onPress={() => onAsk(`${gt('resolve')}:\n${status.conflicted!.join('\n')}`)} /> : null}
        </View>
      ) : null}
      {undoId ? <Banner tone="info" text={gt('restored')} icon={RotateCcw} action={{ label: gt('undo'), onPress: () => void write<{ status?: GitStatus }>('checkpoints/undo', { undoId }).then(r => { if (r) setUndoId(null); }) }} /> : null}
    </View>
  );

  const chips: ChipOption<GitView>[] = [
    { value: 'turn', label: gt('turn'), icon: History },
    ...(renderPullRequests ? [{ value: 'pr' as const, label: 'PR', icon: GitPullRequest }] : []),
    { value: 'worktree', label: translate('workbench.gitUnstaged'), count: status ? unstaged.length : null },
    { value: 'index', label: translate('workbench.gitStaged'), count: status ? staged.length : null },
    { value: 'branch', label: translate('workbench.gitCompare') },
    { value: 'commits', label: translate('workbench.gitCommits'), icon: GitCommitHorizontal },
  ];
  const scopeEmpty = area === 'worktree' ? (status?.files.length ? gt('noUnstaged') : gt('clean')) : area === 'index' ? gt('noStaged') : area === 'branch' ? gt('noDifference', { base }) : gt('noFiles');

  const turnPicker = view === 'turn' ? (
    <TurnPicker turns={turns} turnId={turnId} copyId={selected} canWrite={canWrite && !running} busy={!!busy}
      onTurn={id => { setTurnId(id); setPath(''); setDiff(null); }}
      onRestore={async phase => {
        setRestore({ phase, files: null });
        const preview = await write<{ files?: (string | { path: string })[]; patch?: string }>('checkpoints/preview', { turnId, phase }, { quiet: true });
        if (!preview) { setRestore(null); return; }
        setRestore({ phase, files: (preview.files ?? parsePatch(preview.patch ?? '').files).map(f => typeof f === 'string' ? f : f.path) });
      }} />
  ) : null;
  const compareBar = view === 'branch' ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingBottom: 6 }}>
      <AppText variant="caption" tone="muted">{gt('base')}</AppText>
      <TextInput underlineColorAndroid="transparent" value={baseDraft} onChangeText={setBaseDraft} accessibilityLabel={translate('workbench.gitBase')} autoCapitalize="none" autoCorrect={false} spellCheck={false}
        onSubmitEditing={() => { setBase(baseDraft.trim() || 'HEAD'); setPath(''); }} returnKeyType="go" selectionColor={t.c.primary}
        style={{ flex: 1, height: 38, borderWidth: 1, borderColor: t.c.borderStrong, borderRadius: t.radius.md, paddingHorizontal: 10, color: t.c.fg, fontFamily: t.font.mono, fontSize: 14 }} />
      <Button label={gt('apply')} size="sm" onPress={() => { setBase(baseDraft.trim() || 'HEAD'); setPath(''); }} />
    </View>
  ) : null;
  const commitBar = commit ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, minHeight: 44 }}>
      <IconButton icon={ChevronLeft} label={gt('backToCommits')} onPress={() => { setCommit(null); setPath(''); }} />
      <AppText variant="monoSmall" tone="muted">{shortOid(commit.oid)}</AppText>
      <CopyButton value={commit.oid} label={translate('workbench.gitCopyCommit')} size={14} />
      <AppText variant="subhead" numberOfLines={1} style={{ flex: 1 }}>{commit.subject}</AppText>
    </View>
  ) : null;
  const fileNav = path ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4, minHeight: 44, borderTopWidth: 1, borderTopColor: t.c.border }}>
      <IconButton icon={ChevronLeft} label={gt('backToFiles')} onPress={() => { setPath(''); setDiff(null); }} testID="git-back-files" />
      <View style={{ flex: 1, minWidth: 0 }}><PathChip path={path} /></View>
      {current >= 0 ? <>
        <IconButton icon={ChevronUp} label={gt('previousFile')} disabled={current <= 0} onPress={() => openFile(listed[current - 1]!.path)} />
        <IconButton icon={ChevronDown} label={gt('nextFile')} disabled={current >= listed.length - 1} onPress={() => openFile(listed[current + 1]!.path)} />
      </> : null}
    </View>
  ) : null;
  const fileList = !path && area && listReady ? (
    <View>
      {listed.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 32 }}>
          <AppText variant="caption" tone="muted">{gt(listed.length === 1 ? 'oneFile' : 'files', { n: formatNumber(listed.length) })}</AppText>
          {known ? <Stat additions={sum.additions} deletions={sum.deletions} /> : null}
          <View style={{ flex: 1 }} />
          {canWrite && area === 'worktree' && listed.length > 1 ? <Button label={translate('review.stageAll')} size="sm" kind="ghost" disabled={!!busy} onPress={() => void write('git/stage', { paths: listed.map(f => f.path) })} /> : null}
          {canWrite && area === 'index' && listed.length > 1 ? <Button label={translate('review.unstageAll')} size="sm" kind="ghost" disabled={!!busy} onPress={() => void write('git/unstage', { paths: listed.map(f => f.path) })} /> : null}
        </View>
      ) : null}
      {listed.map(file => (
        <FileRow key={file.path} file={file} onOpen={() => openFile(file.path)} onLongPress={() => fileMenu(file)}
          action={canWrite && (area === 'worktree' || area === 'index') ? { kind: area === 'index' ? 'unstage' : 'stage', busy: !!busy, run: () => void write(area === 'index' ? 'git/unstage' : 'git/stage', { paths: [file.path] }) } : null} />
      ))}
      {!listed.length ? <AppText variant="callout" tone="muted" center style={{ padding: 18 }}>{scopeEmpty}</AppText> : null}
      {status?.truncated ? <AppText variant="footnote" tone="muted" style={{ paddingHorizontal: 12 }}>{translate('workbench.gitTruncated')}</AppText> : null}
      {listed.length ? <View style={{ height: 8, borderBottomWidth: 1, borderBottomColor: t.c.border }} /> : null}
    </View>
  ) : null;

  const header = (
    <View>
      {where}
      {notes}
      {copy ? <ViewChips value={view} options={chips} onChange={selectView} label={translate('workbench.gitScope')} /> : null}
      {turnPicker}
      {compareBar}
      {commitBar}
      {fileList}
      {fileNav}
      {diff?.truncated ? <AppText variant="footnote" tone="muted" style={{ paddingHorizontal: 12, paddingVertical: 4 }}>{translate('workbench.gitTruncated')}</AppText> : null}
    </View>
  );

  // ——— Whole-pane states ———
  if (error && !context) return <EmptyState icon={GitBranch} title={errorMessage} body={unavailable ? undefined : errorText(error)} action={{ label: translate('common.retry'), onPress: refresh }} />;
  if (!context) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.c.primary} accessibilityLabel={translate('workbench.gitLoading')} /></View>;
  if (!context.workingCopies.length) return <EmptyState icon={GitBranch} title={translate('workbench.gitNoRepository')} />;

  const sheets = copy ? <>
    <BranchSheet visible={sheet === 'branch'} onClose={() => setSheet(null)} threadId={threadId} deviceKey={deviceKey} copyId={selected} status={status} write={write} />
    <StashSheet visible={sheet === 'stash'} onClose={() => setSheet(null)} threadId={threadId} deviceKey={deviceKey} copyId={selected} write={write} />
    {status ? <CommitSheet visible={sheet === 'commit'} onClose={() => setSheet(null)} status={status} write={write} /> : null}
    <CopiesSheet visible={sheet === 'copies'} onClose={() => setSheet(null)} copies={context.workingCopies} primaryId={context.primaryWorkingCopyId} selected={selected} onSelect={selectCopy} />
    <DetailsSheet visible={sheet === 'details'} onClose={() => setSheet(null)} copy={copy} primary={copy.id === context.primaryWorkingCopyId} many={many} observed={observedOutside} />
    <RestoreSheet visible={!!restore} onClose={() => setRestore(null)} busy={busy === 'checkpoints/restore'} files={restore?.files ?? null}
      title={restore?.phase === 'start' ? gt('restoreBefore') : gt('restoreAfter')} confirmLabel={restore?.phase === 'start' ? gt('restoreBefore') : gt('restoreAfter')}
      onConfirm={() => void write<{ undoId?: string }>('checkpoints/restore', { turnId, phase: restore!.phase }).then(r => { if (r) { setRestore(null); if (r.undoId) setUndoId(r.undoId); } })} />
  </> : null;
  const commitFooter = canWrite && status && status.files.length && (view === 'worktree' || view === 'index') ? (
    <View style={{ flexDirection: 'row', gap: 8, padding: 8, borderTopWidth: 1, borderTopColor: t.c.border, backgroundColor: t.c.panel }}>
      <Button label={staged.length ? translate('review.commitStaged', { count: staged.length }) : translate('review.commitAll', { count: status.files.length })}
        icon={GitCommitHorizontal} kind="primary" onPress={() => setSheet('commit')} disabled={!!busy} style={{ flex: 1 }} testID="git-commit" />
    </View>
  ) : null;

  if (view === 'pr' && renderPullRequests) {
    return <View style={{ flex: 1 }}>{where}{notes}<ViewChips value={view} options={chips} onChange={selectView} label={translate('workbench.gitScope')} />
      <View style={{ flex: 1 }}>{renderPullRequests({ workingCopyId: selected })}</View>{sheets}</View>;
  }
  if (view === 'commits' && !commit) {
    return (
      <View style={{ flex: 1 }}>
        <FlatList data={commits?.commits ?? []} keyExtractor={c => c.oid} ListHeaderComponent={header}
          onRefresh={refresh} refreshing={false}
          renderItem={({ item }) => (
            <Press onPress={() => { setCommit(item); setPath(''); setDiff(null); }} accessibilityRole="button" accessibilityLabel={translate('workbench.gitOpenCommit', { subject: item.subject })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: t.c.border }}>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <AppText variant="callout" numberOfLines={2}>{item.subject}</AppText>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <AppText variant="monoSmall" tone="muted">{shortOid(item.oid)}</AppText>
                  <AppText variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>{item.author}</AppText>
                  <AppText variant="caption" tone="muted">{formatDate(item.authoredAt, { month: 'short', day: 'numeric' })}</AppText>
                </View>
              </View>
              <ChevronRight size={16} color={t.c.fgMuted} />
            </Press>
          )}
          ListEmptyComponent={commits ? <AppText tone="muted" center style={{ padding: 20 }}>{translate('workbench.gitNoCommits')}</AppText> : <ActivityIndicator color={t.c.primary} style={{ margin: 20 }} />}
          ListFooterComponent={offset > 0 || commits?.hasMore ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 8 }}>
              <IconButton icon={ChevronLeft} label={translate('workbench.gitPrevious')} disabled={loading || offset === 0} onPress={() => setOffset(v => Math.max(0, v - PAGE))} />
              <AppText variant="caption" tone="muted">{gt('page', { n: formatNumber(offset / PAGE + 1) })}</AppText>
              <IconButton icon={ChevronRight} label={translate('workbench.gitNext')} disabled={loading || !commits?.hasMore} onPress={() => setOffset(v => v + PAGE)} />
            </View>
          ) : undefined} />
        {sheets}
      </View>
    );
  }
  const patch = diff?.patch ?? '';
  const waitingForDiff = !diff && !!area && !(area === 'turn' && !turnId);
  return (
    <View style={{ flex: 1 }}>
      <DiffViewer key={`${selected}:${area}:${path}`} patch={patch} single={!!path} hideFileHeading={!!path} onOpenFile={openFile} header={header}
        hunkActions={hunkActions} comment={comment} onRefresh={refresh} refreshing={false}
        empty={waitingForDiff ? <ActivityIndicator color={t.c.primary} style={{ margin: 24 }} /> : area === 'turn' && !turns.length ? <AppText tone="muted" center style={{ padding: 20 }}>{gt('noCheckpoints')}</AppText>
          : path ? <AppText tone="muted" center style={{ padding: 20 }}>{['untracked', 'added'].includes(listed[current]?.change ?? '') ? gt('emptyFile') : gt('noDiff')}</AppText> : null}
        testID="git-diff" />
      {commitFooter}
      {sheets}
    </View>
  );
}

/** A time in as few words as it needs: the hour today, the day this year, else the date. */
export function compactTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  return formatDate(date, date.toDateString() === now.toDateString() ? { hour: 'numeric', minute: '2-digit' }
    : date.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Turns with checkpoints, newest first, and restore before / after the chosen one. */
function TurnPicker({ turns, turnId, copyId, canWrite, busy, onTurn, onRestore }: { turns: TurnCheckpoint[]; turnId: string; copyId: string; canWrite: boolean; busy: boolean; onTurn(id: string): void; onRestore(phase: 'start' | 'end'): void }) {
  const t = useTheme();
  const list = useMemo(() => [...turns].reverse(), [turns]);
  const chosen = turns.find(turn => turn.turnId === turnId);
  const counts = chosen?.workingCopies.find(c => c.workingCopyId === copyId) ?? chosen?.workingCopies[0];
  if (!turns.length) return null;
  return (
    <View style={{ gap: 6, paddingBottom: 6 }}>
      <FlatList horizontal data={list} keyExtractor={turn => turn.turnId} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 10 }}
        initialNumToRender={12} renderItem={({ item }) => {
          const c = item.workingCopies.find(w => w.workingCopyId === copyId) ?? item.workingCopies[0];
          const on = item.turnId === turnId;
          return (
            <Press onPress={() => { haptic.selection(); onTurn(item.turnId); }} feedback="dim" accessibilityRole="tab" accessibilityState={{ selected: on }}
              accessibilityLabel={`${translate('review.turnN', { n: item.turnIndex })}, ${c?.available ? translate('chat.logEdits', { count: c.files }) : c?.reason ?? ''}`}
              style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: t.radius.md, borderWidth: 1, borderColor: on ? t.c.primary : t.c.border, backgroundColor: on ? t.c.accentSoft : t.c.surface, minWidth: 74 }}>
              <AppText variant="caption" weight="semibold" color={on ? t.c.accentStrong : t.c.fg}>{translate('review.turnN', { n: item.turnIndex })}</AppText>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {c?.available && c.files ? <><AppText variant="caption" tone="muted">{formatNumber(c.files)}</AppText><Stat additions={c.additions} deletions={c.deletions} /></> : <AppText variant="caption" tone="muted">{c?.available ? translate('review.noEdits') : '—'}</AppText>}
              </View>
            </Press>
          );
        }} />
      {chosen ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 36 }}>
          <AppText variant="caption" tone="muted" style={{ flex: 1 }} numberOfLines={1}>{compactTime(chosen.startedAt)}</AppText>
          {canWrite && counts?.available && counts.files ? (
            <Button label={translate('review.restore')} size="sm" icon={Undo2} disabled={busy} testID="restore"
              onPress={() => showMenu({ title: translate('review.turnN', { n: chosen.turnIndex }), items: [
                { label: gt('restoreBefore'), icon: Undo2, hint: translate('review.restoreBeforeHint'), onPress: () => onRestore('start') },
                { label: gt('restoreAfter'), icon: Redo2, hint: translate('review.restoreAfterHint'), onPress: () => onRestore('end') },
              ] })} />
          ) : null}
        </View>
      ) : null}
      {counts && !counts.available && counts.reason ? <AppText variant="footnote" tone="muted" style={{ paddingHorizontal: 12 }}>{counts.reason}</AppText> : null}
    </View>
  );
}
