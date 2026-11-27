// The tabs of a pull request under review: Conversation, Code, Commits, Checks, Guide.
// Same behaviour as the Web's review (docs/source-control.md "Pull requests page and
// review"): drafts stay on the Supervisor until submitted, Viewed files fold, threads and
// drafts sit under their lines, and guide excerpts take line comments too.
import { useMemo, useRef, useState, type ComponentRef } from 'react';
import { useFocusWhen } from '../diff/focus';
import { FlatList, Linking, ScrollView, TextInput, View } from 'react-native';
import {
  Check, ChevronDown, Info, ChevronLeft, ChevronRight, CircleCheck, CircleDashed, CircleMinus, CircleX, ExternalLink, FileDiff, Hourglass, MessageCircleQuestion,
  MessageSquare, MessageSquarePlus, RotateCcw, RotateCw, Square, SquareCheck, Trash2, TriangleAlert, X,
} from 'lucide-react-native';
import type { Check as CheckRun, DetailResponse, Draft, GuideState, GuideStop, PullDetail, PullFile, ReviewThread } from '@pockymoe/web-git/pr/review/reviewApi';
import { checkCounts } from '@pockymoe/web-git/pr/review/listModel';
import { rt, type ReviewMessage } from '@pockymoe/web-git/pr/review/reviewText';
import { AppText } from '../../design/AppText';
import { Button, IconButton } from '../../design/Button';
import { CopyButton, PathChip } from '../../design/Copy';
import { Press } from '../../design/Press';
import { EmptyState } from '../../design/States';
import { Sheet } from '../../design/Sheet';
import { showToast } from '../../design/Overlay';
import { useTheme } from '../../design/theme';
import { haptic } from '../../design/haptics';
import { translate } from '../../i18n';
import { DiffViewer, Stat, type DiffComment } from '../diff/DiffViewer';
import { parsePatch, rangeLabel, type Selection } from '../diff/model';
import { ChangeLetter, baseName, dirName } from '../git/GitParts';
import { Ago, Body } from './parts';

export type Act = (action: string, input?: Record<string, unknown>, options?: { files?: boolean }) => Promise<unknown>;
export type SaveDraft = (input: Partial<Draft> & { kind: Draft['kind'] }) => Promise<boolean>;
const sideOf = (value: 'left' | 'right' | null | undefined) => value === 'left' ? 'old' : 'new';
const CHANGE = { added: 'added', removed: 'deleted', renamed: 'renamed', copied: 'copied', modified: 'modified' } as const;
const openUrl = (url: string | null | undefined) => { if (url && /^https?:\/\//.test(url)) void Linking.openURL(url).catch(() => undefined); };

function TextBox({ value, onChange, label, placeholder, autoFocus, minHeight = 80 }: { value: string; onChange(v: string): void; label: string; placeholder?: string; autoFocus?: boolean; minHeight?: number }) {
  const t = useTheme();
  const ref = useRef<ComponentRef<typeof TextInput>>(null);
  useFocusWhen(ref, !!autoFocus);
  return <TextInput underlineColorAndroid="transparent" ref={ref} value={value} onChangeText={onChange} accessibilityLabel={label} placeholder={placeholder ?? label} placeholderTextColor={t.c.fgMuted} multiline
    selectionColor={t.c.primary} textAlignVertical="top"
    style={{ minHeight, maxHeight: 240, borderWidth: 1, borderColor: t.c.borderStrong, borderRadius: t.radius.md, padding: 10, color: t.c.fg, fontFamily: t.font.regular, fontSize: 15, backgroundColor: t.c.panel }} />;
}
function Tag({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'warning' | 'accent' }) {
  const t = useTheme();
  const color = tone === 'warning' ? t.c.warning : tone === 'accent' ? t.c.accentStrong : t.c.fgMuted;
  return <View style={{ paddingHorizontal: 6, height: 20, justifyContent: 'center', borderRadius: t.radius.pill, borderWidth: 1, borderColor: color }}><AppText variant="caption" color={color} style={{ lineHeight: 14 }}>{text}</AppText></View>;
}
export function Section({ title, count, children }: { title?: string; count?: number; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.c.border }}>
      {title ? <AppText variant="caption" tone="muted" accessibilityRole="header">{count !== undefined ? `${title} · ${count}` : title}</AppText> : null}
      {children}
    </View>
  );
}

/** One review thread: where, the comments, then Reply and Resolve. */
export function ThreadCard({ thread, act, busy, compact = false }: { thread: ReviewThread; act: Act; busy: boolean; compact?: boolean }) {
  const t = useTheme();
  const [open, setOpen] = useState(!thread.resolved);
  const [reply, setReply] = useState<string | null>(null);
  const first = thread.comments[0];
  return (
    <View style={{ borderWidth: 1, borderColor: t.c.border, borderRadius: t.radius.md, backgroundColor: t.c.panel, overflow: 'hidden', opacity: thread.resolved ? 0.85 : 1 }}>
      <Press onPress={() => setOpen(v => !v)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, minHeight: 40 }}>
        {open ? <ChevronDown size={15} color={t.c.fgMuted} /> : <ChevronRight size={15} color={t.c.fgMuted} />}
        {!compact ? <View style={{ flexShrink: 1 }}><AppText variant="monoSmall" tone="soft" numberOfLines={1} ellipsizeMode="head">{thread.line ? `${thread.path}:${thread.startLine ? `${thread.startLine}–` : ''}${thread.line}` : thread.path}</AppText></View> : null}
        {thread.resolved ? <Tag text={rt('resolved')} /> : null}
        {thread.outdated ? <Tag text={rt('outdated')} tone="warning" /> : null}
        {!open && first ? <AppText variant="footnote" tone="muted" numberOfLines={1} style={{ flex: 1 }}>{`${first.author?.login ?? '—'}: ${first.body}`}</AppText> : <View style={{ flex: 1 }} />}
      </Press>
      {open ? (
        <View style={{ paddingHorizontal: 10, paddingBottom: 8, gap: 8 }}>
          {thread.comments.map(c => (
            <View key={c.id} style={{ gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <AppText variant="subhead" weight="semibold">{c.author?.login ?? '—'}</AppText>
                <Ago value={c.createdAt} />
                {c.url ? <IconButton icon={ExternalLink} size={13} label={rt('openHost')} onPress={() => openUrl(c.url)} style={{ width: 28, height: 28 }} /> : null}
              </View>
              <Body text={c.body} />
            </View>
          ))}
          {reply === null ? (
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {thread.canReply ? <Button label={rt('reply')} icon={MessageSquare} size="sm" onPress={() => setReply('')} /> : null}
              {thread.canResolve ? <Button label={thread.resolved ? rt('unresolve') : rt('resolve')} icon={thread.resolved ? RotateCcw : Check} size="sm" disabled={busy}
                onPress={() => void act('resolve', { threadId: thread.id, resolved: !thread.resolved })} /> : null}
            </View>
          ) : (
            <View style={{ gap: 6 }}>
              <TextBox value={reply} onChange={setReply} label={rt('reply')} placeholder={rt('replyPlaceholder')} autoFocus minHeight={60} />
              <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'flex-end' }}>
                <Button label={rt('cancel')} size="sm" onPress={() => setReply(null)} />
                <Button label={rt('reply')} size="sm" kind="primary" disabled={busy || !reply.trim()} onPress={() => void act('reply', { threadId: thread.id, body: reply }).then(ok => { if (ok) setReply(null); })} />
              </View>
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

export function DraftCard({ draft, shownHead, onDelete }: { draft: Draft; shownHead: string; onDelete(): void }) {
  const t = useTheme();
  return (
    <View style={{ borderWidth: 1, borderStyle: t.terminal ? 'solid' : 'dashed', borderColor: t.c.accentBorder, borderRadius: t.radius.md, backgroundColor: t.c.accentSoft, padding: 8, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Tag text={rt('pendingNote')} tone="accent" />
        {draft.kind === 'file' && draft.path ? <AppText variant="monoSmall" tone="soft" numberOfLines={1} style={{ flexShrink: 1 }}>{baseName(draft.path)}</AppText> : null}
        {draft.headSha && shownHead && draft.headSha !== shownHead ? <Tag text={rt('staleDraft')} tone="warning" /> : null}
        <View style={{ flex: 1 }} />
        <IconButton icon={Trash2} size={15} label={rt('discard')} onPress={onDelete} style={{ width: 32, height: 32 }} />
      </View>
      <AppText variant="callout">{draft.body}</AppText>
    </View>
  );
}

const REVIEW_VERB: Record<string, ReviewMessage> = { approved: 'reviewedApproved', changesRequested: 'reviewedChanges', commented: 'reviewedCommented', dismissed: 'reviewedDismissed' };
const REVIEWER_STATE: Record<string, ReviewMessage> = { requested: 'stateRequested', approved: 'approved', changesRequested: 'changesRequested', commented: 'stateCommented', dismissed: 'stateDismissed', pending: 'pending' };

export function ConversationTab({ data, act, busy }: { data: DetailResponse; act: Act; busy: boolean }) {
  const t = useTheme();
  const { detail } = data;
  const [comment, setComment] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const threads = detail.threads.filter(th => showResolved || !th.resolved);
  const resolvedCount = detail.threads.filter(th => th.resolved).length;
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Section>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><AppText variant="subhead" weight="semibold">{detail.author?.login ?? '—'}</AppText><Ago value={detail.createdAt} /></View>
        <Body text={detail.body} empty={rt('noDescription')} />
      </Section>
      <Section title={rt('reviewers')}>
        {detail.reviewers.map(r => (
          <View key={r.login} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 }}>
            <AppText variant="callout" weight="medium" style={{ flex: 1 }} numberOfLines={1}>{r.login}</AppText>
            <AppText variant="caption" color={r.state === 'approved' ? t.c.online : r.state === 'changesRequested' ? t.c.failed : t.c.fgMuted}>{rt(REVIEWER_STATE[r.state] ?? 'stateRequested')}</AppText>
            {detail.capabilities.reviewers && r.state === 'requested' ? <IconButton icon={X} size={15} label={rt('removeReviewer', { login: r.login })} disabled={busy} onPress={() => void act('reviewers', { remove: [r.login] })} style={{ width: 32, height: 32 }} /> : null}
          </View>
        ))}
        {!detail.reviewers.length ? <AppText variant="callout" tone="muted">{rt('noReviewers')}</AppText> : null}
        {detail.capabilities.reviewers ? (adding === null ? <Button label={rt('requestReview')} size="sm" kind="ghost" onPress={() => setAdding('')} style={{ alignSelf: 'flex-start' }} /> : (
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <TextInput underlineColorAndroid="transparent" value={adding} onChangeText={setAdding} autoFocus autoCapitalize="none" autoCorrect={false} placeholder={rt('reviewerLogin')} placeholderTextColor={t.c.fgMuted} accessibilityLabel={rt('reviewerLogin')}
              style={{ flex: 1, height: 40, borderWidth: 1, borderColor: t.c.borderStrong, borderRadius: t.radius.md, paddingHorizontal: 10, color: t.c.fg, fontFamily: t.font.mono, fontSize: 14 }} />
            <IconButton icon={X} label={rt('cancel')} onPress={() => setAdding(null)} />
            <Button label={rt('requestReview')} size="sm" kind="primary" disabled={busy || !adding.trim()} onPress={() => void act('reviewers', { add: adding.split(/[\s,]+/).filter(Boolean) }).then(ok => { if (ok) setAdding(null); })} />
          </View>
        )) : null}
      </Section>
      {detail.timeline.length ? (
        <Section title={rt('conversation')}>
          {detail.timeline.map(entry => (
            <View key={`${entry.kind}:${entry.id}`} style={{ gap: 2, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: entry.state === 'approved' ? t.c.online : entry.state === 'changesRequested' ? t.c.failed : t.c.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <AppText variant="subhead" weight="semibold">{entry.author?.login ?? '—'}</AppText>
                <AppText variant="caption" tone="muted">{entry.kind === 'review' ? rt(REVIEW_VERB[entry.state ?? ''] ?? 'reviewedCommented') : rt('commented')}</AppText>
                <Ago value={entry.createdAt} />
              </View>
              <Body text={entry.body} />
            </View>
          ))}
        </Section>
      ) : null}
      {detail.threads.length ? (
        <Section title={rt('threads')} count={detail.threads.length}>
          {resolvedCount ? <Press onPress={() => setShowResolved(v => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: showResolved }} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 }}>
            {showResolved ? <SquareCheck size={18} color={t.c.primary} /> : <Square size={18} color={t.c.fgMuted} />}
            <AppText variant="subhead">{`${rt('showResolved')} (${resolvedCount})`}</AppText>
          </Press> : null}
          {threads.map(th => <ThreadCard key={th.id} thread={th} act={act} busy={busy} />)}
        </Section>
      ) : null}
      <Section>
        <TextBox value={comment} onChange={setComment} label={rt('comment')} placeholder={rt('commentPlaceholder')} />
        <Button label={rt('postComment')} kind="primary" size="sm" disabled={busy || !comment.trim()} onPress={() => void act('comment', { body: comment }).then(ok => { if (ok) setComment(''); })} style={{ alignSelf: 'flex-end' }} />
      </Section>
    </ScrollView>
  );
}

export interface CodeTabProps {
  detail: PullDetail; files: { headSha: string; files: PullFile[]; viewedOnHost: boolean } | null; filesError: string | null; drafts: Draft[]; shownHead: string;
  act: Act; busy: boolean; saveDraft: SaveDraft; deleteDraft(id: string): void; setViewed(paths: string[], viewed: boolean): void; onAsk(context: string): void; onRetry(): void; focusPath?: string | null;
}

/** Changed files with the diff viewer: Viewed ticks fold a file (it reopens marked
    Changed after a push); selected lines and whole files become drafts. */
export function CodeTab({ detail, files, filesError, drafts, shownHead, act, busy, saveDraft, deleteDraft, setViewed, onAsk, onRetry, focusPath }: CodeTabProps) {
  const t = useTheme();
  const [path, setPath] = useState<string>(focusPath ?? '');
  const [fileComment, setFileComment] = useState<{ path: string; body: string } | null>(null);
  // Plain values: the React Compiler lifts `a?.b.c` into a dependency that reads `a.b`.
  const commentPath = fileComment ? fileComment.path : '';
  const commentBody = fileComment ? fileComment.body : '';
  const list = useMemo(() => files?.files ?? [], [files]);
  const viewedCount = list.filter(f => f.viewed === 'viewed').length;
  const chosen = path ? list.filter(f => f.path === path) : list;
  const patch = useMemo(() => chosen.map(f => f.patch ?? '').filter(Boolean).join('\n'), [chosen]);
  const parsed = useMemo(() => parsePatch(patch), [patch]);
  const viewed = useMemo(() => new Map(list.map(f => [f.path, f.viewed])), [list]);
  const lineDrafts = drafts.filter(d => d.kind === 'line');
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of [...detail.threads.filter(th => !th.resolved).map(th => th.path), ...drafts.filter(d => d.kind !== 'summary').map(d => d.path ?? '')]) map.set(item, (map.get(item) ?? 0) + 1);
    return map;
  }, [detail.threads, drafts]);
  const lineThreads = (file: string, side: 'old' | 'new', line: number) => detail.threads.filter(th => th.subject === 'line' && th.path === file && th.line === line && sideOf(th.side) === side);
  const lineMine = (file: string, side: 'old' | 'new', line: number) => lineDrafts.filter(d => d.path === file && d.line === line && sideOf(d.side) === side);
  const comment: DiffComment | null = detail.capabilities.lineComments ? {
    label: rt('addToReview'),
    onSubmit: (s: Selection, body: string) => saveDraft({ kind: 'line', path: s.path, side: s.side === 'old' ? 'left' : 'right', line: s.end, startLine: s.start === s.end ? null : s.start, body, headSha: shownHead }),
    secondary: { label: rt('askAgent'), run: (s, body) => onAsk(`${s.path}:${s.start}-${s.end}\n\`\`\`\n${s.text}\n\`\`\`\n\n${body}`) },
  } : null;
  if (!files) return filesError ? <EmptyState title={rt('failed')} body={filesError} action={{ label: rt('tryAgain'), onPress: onRetry }} /> : <EmptyState title={rt('loading')} />;
  const fileLevel = chosen.flatMap(f => [
    ...detail.threads.filter(th => th.subject === 'file' && th.path === f.path).map(th => <ThreadCard key={th.id} thread={th} act={act} busy={busy} />),
    ...drafts.filter(d => d.kind === 'file' && d.path === f.path).map(d => <DraftCard key={d.id} draft={d} shownHead={shownHead} onDelete={() => deleteDraft(d.id)} />),
  ]);
  const header = (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 36 }}>
        <AppText variant="caption" tone="muted" style={{ flex: 1 }}>{`${list.length === 1 ? rt('oneFile') : rt('files', { n: list.length })} · ${rt('viewedCount', { viewed: viewedCount, total: list.length })}`}</AppText>
        {files.viewedOnHost ? null : <IconButton icon={Info} size={15} tone="muted" label={rt('viewedLocal')} onPress={() => showToast(rt('viewedLocal'))} style={{ width: 32, height: 32 }} />}
        {path ? <Button label={rt('all')} icon={FileDiff} size="sm" kind="ghost" onPress={() => setPath('')} /> : null}
      </View>
      {list.map(f => {
        const isViewed = f.viewed === 'viewed';
        const n = counts.get(f.path) ?? 0;
        return (
          <View key={f.path} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: path === f.path ? t.c.accentSoft : 'transparent', opacity: isViewed && path !== f.path ? 0.7 : 1 }}>
            <IconButton icon={isViewed ? SquareCheck : Square} size={18} tone={isViewed ? 'primary' : 'muted'} label={`${rt('viewed')}: ${f.path}`} active={false}
              onPress={() => { haptic.selection(); setViewed([f.path], !isViewed); }} />
            <Press onPress={() => setPath(path === f.path ? '' : f.path)} accessibilityRole="button" accessibilityState={{ selected: path === f.path }} accessibilityLabel={f.path}
              style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingRight: 8 }}>
              <ChangeLetter change={CHANGE[f.status as keyof typeof CHANGE] ?? 'modified'} />
              <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                <AppText variant="callout" numberOfLines={1} ellipsizeMode="middle" style={{ flexShrink: 0, maxWidth: '70%' }}>{baseName(f.path)}</AppText>
                <AppText variant="caption" tone="muted" numberOfLines={1} ellipsizeMode="head" style={{ flexShrink: 1 }}>{dirName(f.path)}</AppText>
              </View>
              {f.viewed === 'changed' ? <Tag text={rt('changedSince')} tone="warning" /> : null}
              {n ? <Tag text={String(n)} tone="accent" /> : null}
              <Stat additions={f.additions} deletions={f.deletions} />
            </Press>
          </View>
        );
      })}
      <View style={{ height: 6, borderBottomWidth: 1, borderBottomColor: t.c.border }} />
      {fileLevel.length ? <View style={{ gap: 8, padding: 10 }}>{fileLevel}</View> : null}
      {chosen.filter(f => !f.patch).map(f => (
        <View key={`np:${f.path}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6 }}>
          <View style={{ flex: 1, minWidth: 0 }}><PathChip path={f.path} /></View>
          <Button label={rt('openOnHost')} size="sm" kind="ghost" icon={ExternalLink} onPress={() => openUrl(detail.url)} />
        </View>
      ))}
    </View>
  );
  return (
    <View style={{ flex: 1 }}>
      <DiffViewer key={path} patch={patch} parsed={parsed} single={!!path} onOpenFile={p => setPath(p)} header={header} comment={comment}
        defaultClosed={p => viewed.get(p) === 'viewed'} copyValue={null}
        annotated={(file, side, line) => lineThreads(file, side, line).length > 0 || lineMine(file, side, line).length > 0}
        annotation={(file, side, line) => <>{lineThreads(file, side, line).map(th => <ThreadCard key={th.id} thread={th} act={act} busy={busy} compact />)}
          {lineMine(file, side, line).map(d => <DraftCard key={d.id} draft={d} shownHead={shownHead} onDelete={() => deleteDraft(d.id)} />)}</>}
        fileAccessory={file => <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {viewed.get(file.path) === 'changed' ? <Tag text={rt('changedSince')} tone="warning" /> : null}
          {detail.capabilities.fileComments || detail.capabilities.lineComments ? <IconButton icon={MessageSquarePlus} size={16} label={`${rt('fileComment')}: ${file.path}`} onPress={() => setFileComment({ path: file.path, body: '' })} style={{ width: 36, height: 36 }} /> : null}
          <IconButton icon={viewed.get(file.path) === 'viewed' ? SquareCheck : Square} size={16} tone={viewed.get(file.path) === 'viewed' ? 'primary' : 'muted'} label={`${rt('viewed')}: ${file.path}`}
            onPress={() => setViewed([file.path], viewed.get(file.path) !== 'viewed')} style={{ width: 36, height: 36 }} />
        </View>}
        empty={list.length ? null : <AppText tone="muted" center style={{ padding: 20 }}>{rt('noPatch')}</AppText>} testID="pr-code" />
      <Sheet visible={!!fileComment} onClose={() => setFileComment(null)} title={rt('fileComment')} subtitle={commentPath || null}
        footer={<><Button label={rt('cancel')} onPress={() => setFileComment(null)} style={{ flex: 1, maxWidth: 220 }} />
          <Button label={rt('addToReview')} kind="primary" disabled={!commentBody.trim()} style={{ flex: 1, maxWidth: 220 }}
            onPress={() => void saveDraft({ kind: 'file', path: commentPath, body: commentBody, headSha: shownHead }).then(ok => { if (ok) setFileComment(null); })} /></>}>
        {fileComment ? <TextBox value={fileComment.body} onChange={body => setFileComment({ ...fileComment, body })} label={rt('comment')} autoFocus /> : null}
      </Sheet>
    </View>
  );
}

export function CommitsTab({ detail }: { detail: PullDetail }) {
  const t = useTheme();
  if (!detail.commits.length) return <EmptyState title={rt('noCommits')} />;
  return (
    <FlatList data={[...detail.commits].reverse()} keyExtractor={c => c.sha} contentContainerStyle={{ paddingBottom: 30 }}
      renderItem={({ item: c }) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.c.border }}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <AppText variant="callout" numberOfLines={2}>{c.message.split('\n')[0]}</AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <AppText variant="monoSmall" tone="muted">{c.sha.slice(0, 7)}</AppText>
              <CopyButton value={c.sha} label={translate('workbench.gitCopyCommit')} size={13} />
              <AppText variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>{c.login ?? c.author}</AppText>
              <Ago value={c.date} />
            </View>
          </View>
          {c.url ? <IconButton icon={ExternalLink} size={16} label={rt('openHost')} onPress={() => openUrl(c.url)} /> : null}
        </View>
      )} />
  );
}

const CHECK_ICON = { passed: CircleCheck, failed: CircleX, pending: CircleDashed, skipped: CircleMinus, neutral: CircleMinus, cancelled: CircleMinus } as const;
const CHECK_LABEL: Record<CheckRun['state'], ReviewMessage> = { passed: 'passing', failed: 'failing', pending: 'pending', skipped: 'checksAll', neutral: 'checksAll', cancelled: 'failing' };
function duration(check: CheckRun) {
  if (!check.startedAt || !check.completedAt) return null;
  const s = Math.round((Date.parse(check.completedAt) - Date.parse(check.startedAt)) / 1000);
  if (!Number.isFinite(s) || s < 0) return null;
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
export function ChecksTab({ detail, act, busy }: { detail: PullDetail; act: Act; busy: boolean }) {
  const t = useTheme();
  const counts = checkCounts(detail.checkRuns);
  const reruns = [...new Set(detail.checkRuns.map(c => c.rerun).filter((x): x is string => !!x))];
  const order: Record<string, number> = { failed: 0, cancelled: 1, pending: 2, passed: 3, neutral: 4, skipped: 5 };
  const sorted = [...detail.checkRuns].sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9) || a.name.localeCompare(b.name));
  const color = (s: CheckRun['state']) => s === 'passed' ? t.c.online : s === 'failed' || s === 'cancelled' ? t.c.failed : s === 'pending' ? t.c.waiting : t.c.fgMuted;
  return (
    <FlatList data={sorted} keyExtractor={c => c.id} contentContainerStyle={{ paddingBottom: 30 }}
      ListHeaderComponent={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, flexWrap: 'wrap' }}>
        <AppText variant="subhead" style={{ flex: 1 }}>{detail.checkRuns.length ? rt('checksSummary', counts) : rt('noChecks')}</AppText>
        {detail.capabilities.rerun ? reruns.map((token, i) => <Button key={token} label={`${rt('rerun')}${reruns.length > 1 ? ` ${i + 1}` : ''}`} icon={RotateCw} size="sm" disabled={busy} onPress={() => void act('rerun', { token })} />) : null}
      </View>}
      renderItem={({ item: c }) => {
        const Icon = CHECK_ICON[c.state];
        return (
          <Press onPress={c.url ? () => openUrl(c.url) : undefined} disabled={!c.url} accessibilityRole={c.url ? 'link' : undefined} accessibilityLabel={`${c.name}, ${rt(CHECK_LABEL[c.state])}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, minHeight: 46, paddingVertical: 6, borderTopWidth: 1, borderTopColor: t.c.border }}>
            <Icon size={17} color={color(c.state)} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <AppText variant="callout" numberOfLines={1}>{c.name}</AppText>
              {c.description ? <AppText variant="caption" tone="muted" numberOfLines={2}>{c.description}</AppText> : null}
            </View>
            {duration(c) ? <AppText variant="caption" tone="muted">{duration(c)}</AppText> : null}
            {c.url ? <ExternalLink size={15} color={t.c.fgMuted} /> : null}
          </Press>
        );
      }} />
  );
}

const ATTENTION: Record<string, ReviewMessage> = { tradeoff: 'attentionTradeoff', contract: 'attentionContract', product: 'attentionProduct', risk: 'attentionRisk', accessibility: 'attentionAccessibility' };
/** The review guide: numbered stops, one at a time; excerpt lines take drafts and questions. */
export function GuideTab({ detail, guide, shownHead, act, busy, saveDraft, onAsk, onOpenFile, drafts, canWrite }: {
  detail: PullDetail; guide: GuideState; shownHead: string; act: Act; busy: boolean; drafts: Draft[]; saveDraft: SaveDraft; onAsk(context: string): void; onOpenFile(path: string): void; canWrite: boolean;
}) {
  const t = useTheme();
  const stops = guide.guide?.stops ?? [];
  const [index, setIndex] = useState(0);
  const [read, setRead] = useState<Set<number>>(() => new Set([0]));
  const stop: GuideStop | undefined = stops[Math.min(index, stops.length - 1)];
  const go = (next: number) => { haptic.selection(); setIndex(next); setRead(v => new Set(v).add(next)); };
  const running = guide.run?.state === 'running';
  const failed = guide.run?.state === 'failed' ? guide.run : null;
  const pending = drafts.filter(d => d.kind === 'line');
  if (!guide.guide) {
    return running ? <EmptyState icon={Hourglass} title={rt('guideRunning')} />
      : <EmptyState icon={failed ? TriangleAlert : MessageCircleQuestion} title={failed ? rt('guideFailed') : rt('guideEmpty')} body={failed ? failed.detail : rt('guideHint')}
        action={canWrite ? { label: failed ? rt('tryAgain') : rt('writeGuide'), onPress: () => void act('guide') } : undefined} />;
  }
  const comment = (excerptSide: 'new' | 'old'): DiffComment | null => detail.capabilities.lineComments ? {
    label: rt('addToReview'),
    onSubmit: (s, body) => saveDraft({ kind: 'line', path: s.path, side: s.side === 'old' ? 'left' : 'right', line: s.end, startLine: s.start === s.end ? null : s.start, body, headSha: shownHead }),
    secondary: { label: rt('askAgent'), run: (s, body) => onAsk(`${rt('guide')} · ${stop?.title ?? ''}\n${s.path}:${rangeLabel(s)}\n\`\`\`\n${s.text}\n\`\`\`\n\n${body}`) },
  } : (void excerptSide, null);
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
      {guide.stale || running || failed ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, margin: 10, padding: 10, borderRadius: t.radius.md, backgroundColor: t.c.warningBg, borderWidth: 1, borderColor: t.c.border }}>
          {running ? <Hourglass size={15} color={t.c.warning} /> : <TriangleAlert size={15} color={t.c.warning} />}
          <AppText variant="subhead" color={t.c.warning} style={{ flex: 1 }}>{running ? rt('guideRunning') : failed ? `${rt('guideFailed')}: ${failed.detail}` : rt('guideStale')}</AppText>
          {!running && canWrite ? <Button label={rt('rewriteGuide')} size="sm" kind="ghost" disabled={busy} onPress={() => void act('guide')} /> : null}
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 10, paddingVertical: 8 }}>
        {stops.map((item, n) => {
          const on = n === index;
          return (
            <Press key={n} onPress={() => go(n)} feedback="dim" accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${rt('stopOf', { i: n + 1, n: stops.length })}: ${item.title}${item.attention ? `, ${rt('lookClosely')}` : ''}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 10, maxWidth: 220, borderRadius: t.radius.pill, borderWidth: 1,
                borderColor: on ? t.c.primary : t.c.border, backgroundColor: on ? t.c.accentSoft : read.has(n) ? t.c.surface : t.c.panel }}>
              <AppText variant="caption" weight="semibold" color={on ? t.c.accentStrong : t.c.fgSoft}>{n + 1}</AppText>
              <AppText variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>{item.title}</AppText>
              {item.attention ? <TriangleAlert size={12} color={t.c.warning} /> : null}
            </Press>
          );
        })}
      </ScrollView>
      <AppText variant="caption" tone="muted" style={{ paddingHorizontal: 12 }}>{rt('read', { read: read.size, n: stops.length })}</AppText>
      {stop ? (
        <View style={{ padding: 12, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <AppText variant="caption" tone="muted" style={{ flex: 1 }}>{rt('stopOf', { i: index + 1, n: stops.length })}</AppText>
            <IconButton icon={ChevronLeft} label={rt('previousStop')} disabled={index === 0} onPress={() => go(index - 1)} />
            <IconButton icon={ChevronRight} label={rt('nextStop')} disabled={index >= stops.length - 1} onPress={() => go(index + 1)} />
          </View>
          <AppText variant="headline">{stop.title}</AppText>
          {stop.summary ? <Body text={stop.summary} /> : null}
          {stop.attention ? (
            <View style={{ gap: 4, padding: 10, borderRadius: t.radius.md, backgroundColor: t.c.warningBg, borderLeftWidth: 3, borderLeftColor: t.c.warning }}>
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><TriangleAlert size={14} color={t.c.warning} /><AppText variant="subhead" weight="semibold" color={t.c.warning}>{rt(ATTENTION[stop.attention.kind] ?? 'lookClosely')}</AppText></View>
              <AppText variant="callout">{stop.attention.note}</AppText>
            </View>
          ) : null}
          {stop.excerpts.map(ex => (
            <View key={`${ex.path}:${ex.start}`} style={{ borderWidth: 1, borderColor: t.c.border, borderRadius: t.radius.md, overflow: 'hidden' }}>
              <Press onPress={() => onOpenFile(ex.path)} accessibilityRole="button" accessibilityLabel={`${rt('openInCode')}: ${ex.path}`} style={{ paddingHorizontal: 10, paddingVertical: 8, backgroundColor: t.c.surface, gap: 2 }}>
                <AppText variant="monoSmall" tone="accent" numberOfLines={1} ellipsizeMode="head">{`${ex.path}:${ex.start}–${ex.end}`}</AppText>
                {ex.caption ? <AppText variant="caption" tone="muted">{ex.caption}</AppText> : null}
              </Press>
              <DiffViewer inline toolbar={false} single hideFileHeading patch={ex.patch} comment={comment(ex.side)}
                annotated={(path, side, line) => stop.notes.some(n => n.path === path && n.line === line && (side === 'new') === (ex.side === 'new')) || pending.some(d => d.path === path && d.line === line && sideOf(d.side) === side)}
                annotation={(path, side, line) => <>
                  {stop.notes.filter(n => n.path === path && n.line === line && (side === 'new') === (ex.side === 'new')).map(n => (
                    <View key={n.title} style={{ padding: 8, borderRadius: t.radius.sm, backgroundColor: t.c.infoBg, gap: 2 }}><AppText variant="subhead" weight="semibold" color={t.c.info}>{n.title}</AppText><AppText variant="callout">{n.body}</AppText></View>
                  ))}
                  {pending.filter(d => d.path === path && d.line === line && sideOf(d.side) === side).map(d => <DraftCard key={d.id} draft={d} shownHead={shownHead} onDelete={() => undefined} />)}
                </>} />
            </View>
          ))}
          {stop.files.length ? (
            <View style={{ gap: 6 }}>
              <AppText variant="caption" tone="muted">{stop.excerpts.length ? rt('alsoInStop') : rt('files', { n: stop.files.length })}</AppText>
              {stop.files.map(f => (
                <Press key={f.path} onPress={() => onOpenFile(f.path)} accessibilityRole="button" accessibilityLabel={`${rt('openInCode')}: ${f.path}`} style={{ gap: 2, paddingVertical: 4 }}>
                  <AppText variant="monoSmall" tone="accent" numberOfLines={1} ellipsizeMode="head">{f.path}</AppText>
                  {f.note ? <AppText variant="footnote" tone="muted">{f.note}</AppText> : null}
                </Press>
              ))}
            </View>
          ) : null}
          {stop.questions.length ? <View style={{ gap: 4 }}><AppText variant="caption" tone="muted">{rt('questions')}</AppText>{stop.questions.map(q => <AppText key={q} variant="callout">{`• ${q}`}</AppText>)}</View> : null}
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            <Button label={rt('askAboutStop')} icon={MessageCircleQuestion} size="sm" onPress={() => onAsk(`${rt('guide')} · ${stop.title}\n\n${stop.summary}`)} />
            {index < stops.length - 1 ? <Button label={`${rt('nextStop')}: ${stops[index + 1]!.title}`} kind="primary" size="sm" onPress={() => go(index + 1)} style={{ flexShrink: 1 }} /> : null}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}
