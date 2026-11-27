// The Git inspector's secondary windows: branches, stashes, commit, working copies and a
// restore preview. Each is a Sheet (a bottom sheet on a phone, a dialog when wide) with
// Cancel first and one primary action (docs/ui-principles.md §4).
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { useFocusWhen } from '../diff/focus';
import { ActivityIndicator, TextInput, View } from 'react-native';
import { Archive, ArchiveRestore, Check, GitBranch, GitCommitHorizontal, Plus, Sparkles, Upload } from 'lucide-react-native';
import { fetchGitBranches, type GitBranches, type GitStatus, type WorkingCopy } from '@pockymoe/web/gitApi';
import { deviceRequest } from '../../protocol/webApiShim';
import { gitText as gt } from '@pockymoe/web/gitI18n';
import { AppText } from '../../design/AppText';
import { Button, IconButton } from '../../design/Button';
import { PathChip } from '../../design/Copy';
import { Row } from '../../design/List';
import { Sheet } from '../../design/Sheet';
import { confirmAsync } from '../../design/Overlay';
import { useTheme } from '../../design/theme';
import { formatDate, translate } from '../../i18n';
import { Badge, baseName, shortOid } from './GitParts';
import type { GitWrite } from './useGitWrite';
import { errorText } from './useGitWrite';

function Input({ value, onChange, label, placeholder, multiline, autoFocus, mono }: { value: string; onChange(v: string): void; label: string; placeholder?: string; multiline?: boolean; autoFocus?: boolean; mono?: boolean }) {
  const t = useTheme();
  const ref = useRef<ComponentRef<typeof TextInput>>(null);
  useFocusWhen(ref, !!autoFocus);
  return (
    <TextInput underlineColorAndroid="transparent" ref={ref} value={value} onChangeText={onChange} accessibilityLabel={label} placeholder={placeholder ?? label} placeholderTextColor={t.c.fgMuted} multiline={multiline}
      autoCapitalize="none" autoCorrect={!mono} selectionColor={t.c.primary} textAlignVertical={multiline ? 'top' : 'center'}
      style={{ minHeight: multiline ? 96 : 44, maxHeight: 200, borderWidth: 1, borderColor: t.c.borderStrong, borderRadius: t.radius.md, paddingHorizontal: 10, paddingVertical: multiline ? 10 : 8,
        color: t.c.fg, fontFamily: mono ? t.font.mono : t.font.regular, fontSize: 15, backgroundColor: t.c.panel }} />
  );
}

/** Local and remote branches with ahead/behind; switch, or create one from HEAD. */
export function BranchSheet({ visible, onClose, threadId, deviceKey, copyId, status, write }: { visible: boolean; onClose(): void; threadId: string; deviceKey: string; copyId: string; status: GitStatus | null; write: GitWrite }) {
  const t = useTheme();
  const [branches, setBranches] = useState<GitBranches | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setBranches(null); setError(null); setQuery(''); setCreating(false);
    fetchGitBranches(threadId, copyId, deviceKey).then(setBranches, e => setError(errorText(e)));
  }, [visible, threadId, copyId, deviceKey]);
  const q = query.trim().toLowerCase();
  const shown = (branches?.branches ?? []).filter(b => !q || b.name.toLowerCase().includes(q));
  const local = shown.filter(b => !b.remote);
  // Remote branches worth switching to: real branches (not `origin` or `origin/HEAD`) that no local branch tracks yet.
  const tracked = new Set((branches?.branches ?? []).filter(b => !b.remote && b.upstream).map(b => b.upstream));
  const remote = shown.filter(b => b.remote && b.name.includes('/') && !b.name.endsWith('/HEAD') && !tracked.has(b.name));
  const exists = (branches?.branches ?? []).some(b => !b.remote && b.name === query.trim());
  const checkout = async (name: string) => { if (await write('git/checkout', { name })) onClose(); };
  const create = async () => {
    const name = query.trim();
    if (!name || !await write('git/branchCreate', { name })) return;
    if (await write('git/checkout', { name }, { quiet: true })) onClose();
  };
  const row = (b: GitBranches['branches'][number], i: number, list: unknown[]) => {
    const current = !b.remote && b.name === (branches?.current ?? status?.branch);
    const target = b.remote ? b.name.replace(/^[^/]+\//, '') : b.name;
    return (
      <Row key={`${b.remote ? 'r' : 'l'}:${b.name}`} title={b.name} subtitle={b.upstream ?? null} last={i === list.length - 1} selected={current}
        leading={<GitBranch size={17} color={current ? t.c.primary : t.c.fgSoft} />}
        trailing={<View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
          {b.ahead ? <Badge text={`↑${b.ahead}`} tone="accent" label={translate('review.toPush', { count: b.ahead })} /> : null}
          {b.behind ? <Badge text={`↓${b.behind}`} tone="warning" label={translate('review.toPull', { count: b.behind })} /> : null}
          {current ? <Check size={18} color={t.c.primary} /> : null}
        </View>}
        onPress={current ? undefined : () => void checkout(target)} accessibilityLabel={current ? `${b.name}, ${translate('review.currentBranch')}` : translate('review.switchTo', { name: b.name })} />
    );
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={gt('branch')} subtitle={status?.branch ?? translate('workbench.gitDetached')} tall scroll
      footer={<Button label={gt('cancel')} onPress={onClose} style={{ flex: 1, maxWidth: 220 }} />}>
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <View style={{ flex: 1 }}><Input value={query} onChange={setQuery} label={creating ? gt('branchName') : translate('review.findBranch')} mono autoFocus={creating} /></View>
          <IconButton icon={Plus} label={gt('createBranch')} active={creating} onPress={() => setCreating(v => !v)} />
        </View>
        {creating ? <Button label={translate('review.createAndSwitch', { name: query.trim() || '…' })} kind="primary" icon={GitBranch} disabled={!query.trim() || exists} onPress={() => void create()} /> : null}
        {error ? <AppText tone="danger" variant="footnote">{error}</AppText> : !branches ? <ActivityIndicator color={t.c.primary} style={{ margin: 20 }} /> : null}
        {local.length ? <View><AppText variant="caption" tone="muted" style={{ marginBottom: 4 }}>{translate('review.localBranches')}</AppText>
          <View style={{ borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.c.border, overflow: 'hidden', backgroundColor: t.c.panel }}>{local.map(row)}</View></View> : null}
        {remote.length ? <View><AppText variant="caption" tone="muted" style={{ marginBottom: 4 }}>{translate('review.remoteBranches')}</AppText>
          <View style={{ borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.c.border, overflow: 'hidden', backgroundColor: t.c.panel }}>{remote.map(row)}</View></View> : null}
        {branches && !shown.length ? <AppText tone="muted" center style={{ padding: 12 }}>{translate('review.noBranches')}</AppText> : null}
      </View>
    </Sheet>
  );
}

interface Stash { oid: string; name: string; subject: string; createdAt: string }
/** Stash the working copy (with untracked files), or pop one entry. */
export function StashSheet({ visible, onClose, threadId, deviceKey, copyId, write }: { visible: boolean; onClose(): void; threadId: string; deviceKey: string; copyId: string; write: GitWrite }) {
  const t = useTheme();
  const [stashes, setStashes] = useState<Stash[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const load = () => deviceRequest<{ stashes: Stash[] }>(deviceKey, `api/threads/${encodeURIComponent(threadId)}/git/stashes?${new URLSearchParams({ workingCopyId: copyId })}`, {}, threadId)
    .then(r => setStashes(r.stashes), e => setError(errorText(e)));
  useEffect(() => { if (visible) { setStashes(null); setError(null); setMessage(''); void load(); } }, [visible, copyId]); // eslint-disable-line react-hooks/exhaustive-deps
  const push = async () => { if (await write('git/stashPush', message.trim() ? { message: message.trim() } : {})) onClose(); };
  const pop = async (index: number, stash: Stash) => {
    if (!await confirmAsync({ title: gt('stashPop'), message: stash.subject, confirmLabel: gt('stashPop') })) return;
    if (await write('git/stashPop', { index })) onClose();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={translate('review.stashes')}
      footer={<><Button label={gt('cancel')} onPress={onClose} style={{ flex: 1, maxWidth: 220 }} /><Button label={gt('stashPush')} icon={Archive} kind="primary" onPress={() => void push()} style={{ flex: 1, maxWidth: 220 }} /></>}>
      <View style={{ gap: 10 }}>
        <Input value={message} onChange={setMessage} label={translate('review.stashMessage')} />
        {error ? <AppText tone="danger" variant="footnote">{error}</AppText> : !stashes ? <ActivityIndicator color={t.c.primary} /> : !stashes.length ? <AppText tone="muted" variant="footnote">{translate('review.noStashes')}</AppText> : (
          <View style={{ borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.c.border, overflow: 'hidden', backgroundColor: t.c.panel }}>
            {stashes.map((s, i) => <Row key={s.oid} title={s.subject} subtitle={`${s.name} · ${formatDate(s.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}`} last={i === stashes.length - 1}
              leading={<ArchiveRestore size={17} color={t.c.fgSoft} />} onPress={() => void pop(i, s)} accessibilityLabel={`${gt('stashPop')}: ${s.subject}`} />)}
          </View>
        )}
      </View>
    </Sheet>
  );
}

/** Commit what is staged (or everything, when nothing is), with a generated message,
    amend, and an optional push afterwards. */
export function CommitSheet({ visible, onClose, status, write }: { visible: boolean; onClose(): void; status: GitStatus; write: GitWrite }) {
  const t = useTheme();
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pushAfter, setPushAfter] = useState(false);
  const staged = status.files.filter(f => f.indexStatus !== ' ' && f.indexStatus !== '?').length;
  useEffect(() => { if (visible) setAmend(false); }, [visible]);
  const generate = async () => {
    setGenerating(true);
    try { const r = await write<{ message?: string }>('git/commitMessage', { all: !staged }, { quiet: true }); if (r?.message) setMessage(r.message); }
    finally { setGenerating(false); }
  };
  const commit = async (push: boolean) => {
    const done = await write('git/commit', { message: message.trim(), amend, all: !staged });
    if (!done) return;
    setMessage('');
    if (push) await write('git/push', { setUpstream: !status.upstream, ...(amend && status.upstream ? { forceWithLease: true } : {}) });
    onClose();
  };
  const count = staged || status.files.length;
  return (
    <Sheet visible={visible} onClose={onClose} title={amend ? gt('amend') : gt('commit')} subtitle={staged ? translate('review.stagedFiles', { count: staged }) : translate('review.allFiles', { count })}
      footer={<>
        <Button label={gt('cancel')} onPress={onClose} style={{ flex: 1, maxWidth: 220 }} />
        <Button label={pushAfter ? translate('review.commitAndPush') : staged ? gt('commit') : gt('commitAll')} icon={pushAfter ? Upload : GitCommitHorizontal} kind="primary"
          disabled={!message.trim() || generating} onPress={() => void commit(pushAfter)} style={{ flex: 1, maxWidth: 220 }} testID="commit-submit" />
      </>}>
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}><Input value={message} onChange={setMessage} label={gt('commitMessage')} multiline autoFocus /></View>
          <View style={{ gap: 4 }}>
            {generating ? <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.c.primary} /></View>
              : <IconButton icon={Sparkles} label={gt('generate')} tone="primary" onPress={() => void generate()} testID="commit-generate" />}
          </View>
        </View>
        {generating ? <AppText variant="footnote" tone="muted">{translate('review.generating')}</AppText> : null}
        <View style={{ borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.c.border, overflow: 'hidden' }}>
        <Row title={translate('review.pushAfter')} subtitle={status.upstream ?? translate('review.pushUpstream')}
          trailing={<View style={{ width: 22, height: 22, borderRadius: t.radius.xs, borderWidth: 1.5, borderColor: pushAfter ? t.c.primary : t.c.borderStrong, backgroundColor: pushAfter ? t.c.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{pushAfter ? <Check size={15} color={t.c.primaryFg} /> : null}</View>}
          onPress={() => setPushAfter(v => !v)} accessibilityLabel={translate('review.pushAfter')} />
        <Row title={gt('amend')} subtitle={amend && status.upstream ? translate('review.amendPushed') : null} last
          trailing={<View style={{ width: 22, height: 22, borderRadius: t.radius.xs, borderWidth: 1.5, borderColor: amend ? t.c.primary : t.c.borderStrong, backgroundColor: amend ? t.c.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{amend ? <Check size={15} color={t.c.primaryFg} /> : null}</View>}
          onPress={() => setAmend(v => !v)} accessibilityLabel={gt('amend')} />
        </View>
      </View>
    </Sheet>
  );
}

/** The thread's working copies: branch, directory, primary, where it came from. */
export function CopiesSheet({ visible, onClose, copies, primaryId, selected, onSelect }: { visible: boolean; onClose(): void; copies: WorkingCopy[]; primaryId: string | null; selected: string; onSelect(id: string): void }) {
  const t = useTheme();
  const source = { created: 'workbench.gitSourceCreated', adopted: 'workbench.gitSourceAdopted', observed: 'workbench.gitSourceObserved', configured: 'workbench.gitSourceConfigured' } as const;
  return (
    <Sheet visible={visible} onClose={onClose} title={translate('workbench.gitWorkingCopy')} subtitle={translate('workbench.gitViewOnly')}>
      <View style={{ borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.c.border, overflow: 'hidden', backgroundColor: t.c.panel }}>
        {copies.map((copy, i) => (
          <Row key={copy.id} title={copy.branch ?? translate('workbench.gitDetached')} last={i === copies.length - 1} selected={copy.id === selected}
            subtitle={[baseName(copy.path), copy.id === primaryId ? gt('primaryShort') : null, copy.source !== 'configured' ? translate(source[copy.source]) : null].filter(Boolean).join(' · ')}
            leading={<GitBranch size={17} color={copy.id === selected ? t.c.primary : t.c.fgSoft} />} trailing={copy.id === selected ? <Check size={18} color={t.c.primary} /> : null}
            onPress={() => { onSelect(copy.id); onClose(); }} />
        ))}
      </View>
    </Sheet>
  );
}

/** Working copy details: absolute path, role, origin, the agent's latest operation. */
export function DetailsSheet({ visible, onClose, copy, primary, many, observed }: { visible: boolean; onClose(): void; copy: WorkingCopy; primary: boolean; many: boolean; observed?: { cwd: string; observedAt: string } | undefined }) {
  const source = { created: 'workbench.gitSourceCreated', adopted: 'workbench.gitSourceAdopted', observed: 'workbench.gitSourceObserved', configured: 'workbench.gitSourceConfigured' } as const;
  return (
    <Sheet visible={visible} onClose={onClose} title={gt('details')} subtitle={copy.branch ?? translate('workbench.gitDetached')}>
      <View style={{ gap: 12 }}>
        <View style={{ gap: 4 }}><AppText variant="caption" tone="muted">{gt('path')}</AppText><PathChip path={copy.path} /></View>
        {many || copy.source !== 'configured' ? <View style={{ gap: 4 }}>
          <AppText variant="caption" tone="muted">{gt('kind')}</AppText>
          <AppText variant="callout">{[many ? (primary ? translate('workbench.gitPrimary') : translate('workbench.gitViewing')) : null, copy.source !== 'configured' ? translate(source[copy.source]) : null].filter(Boolean).join(' · ')}</AppText>
        </View> : null}
        {copy.head ? <View style={{ gap: 4 }}><AppText variant="caption" tone="muted">HEAD</AppText><PathChip path={copy.head} /></View> : null}
        {observed ? <View style={{ gap: 4 }}>
          <AppText variant="caption" tone="muted">{gt('recent')}</AppText>
          <PathChip path={observed.cwd} />
          <AppText variant="footnote" tone="muted">{formatDate(observed.observedAt)}</AppText>
        </View> : null}
        {many ? <AppText variant="footnote" tone="muted">{translate('workbench.gitViewOnly')}</AppText> : null}
      </View>
    </Sheet>
  );
}

/** What a restore would change, before it does. */
export function RestoreSheet({ visible, onClose, title, files, busy, onConfirm, confirmLabel }: { visible: boolean; onClose(): void; title: string; files: string[] | null; busy: boolean; onConfirm(): void; confirmLabel: string }) {
  const t = useTheme();
  const sorted = useMemo(() => [...(files ?? [])].sort(), [files]);
  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle={files ? translate('review.filesWillChange', { count: files.length }) : null} dismissable={!busy}
      footer={<><Button label={gt('cancel')} onPress={onClose} style={{ flex: 1, maxWidth: 220 }} /><Button label={confirmLabel} kind="danger" busy={busy} disabled={!files?.length} onPress={onConfirm} style={{ flex: 1, maxWidth: 220 }} testID="restore-confirm" /></>}>
      {!files ? <ActivityIndicator color={t.c.primary} style={{ margin: 16 }} /> : !files.length ? <AppText tone="muted">{gt('noFiles')}</AppText> : (
        <View style={{ gap: 6 }}>
          {sorted.slice(0, 200).map(path => <PathChip key={path} path={path} />)}
          {sorted.length > 200 ? <AppText variant="footnote" tone="muted">{translate('native.showMoreCount', { count: sorted.length - 200 })}</AppText> : null}
          <AppText variant="footnote" tone="muted" style={{ marginTop: 4 }}>{translate('review.restoreUndoable')}</AppText>
        </View>
      )}
    </Sheet>
  );
}
export { shortOid };
