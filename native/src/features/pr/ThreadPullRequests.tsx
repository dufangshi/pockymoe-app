// The Git pane's PR view for one thread: its linked pull requests and issues (review,
// open on the host, unlink), linking by URL, and a new PR from the working copy's branch
// with a generated title and body. Opening a PR shows its review in place, with Back.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, TextInput, View } from 'react-native';
import { CircleDot, ExternalLink, GitPullRequest, GitPullRequestCreate, Link2, ListFilter, MessageSquareText, Sparkles, Square, SquareCheck, Unlink } from 'lucide-react-native';
import { sourceAction, sourceRoot, type ItemLink } from '@pockymoe/web-git/pr/api';
import { prText as pt } from '@pockymoe/web-git/pr/text';
import { rt } from '@pockymoe/web-git/pr/review/reviewText';
import { fetchThreadGitStatus } from '@pockymoe/web/gitApi';
import { request } from '../../protocol/webApiShim';
import { AppText } from '../../design/AppText';
import { Button, IconButton } from '../../design/Button';
import { Press } from '../../design/Press';
import { Banner } from '../../design/States';
import { Sheet } from '../../design/Sheet';
import { confirmAsync, showToast } from '../../design/Overlay';
import { useTheme } from '../../design/theme';
import { haptic } from '../../design/haptics';
import { translate } from '../../i18n';
import { PullRequestReview, type AskTarget } from './PullRequestReview';
import { message } from './parts';
import { usePrNavigation } from '../../layout/routing';

export function ThreadPullRequests({ deviceKey, threadId, workingCopyId, running, onAsk }: { deviceKey: string; threadId: string; workingCopyId: string; running: boolean; onAsk?: (prompt: string) => void }) {
  const t = useTheme();
  const nav = usePrNavigation();
  const [links, setLinks] = useState<ItemLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const reload = useCallback(async () => {
    try { const r = await request<{ links: ItemLink[] }>(`${sourceRoot(deviceKey)}/threads/${encodeURIComponent(threadId)}/pull-requests`); setLinks(r.links); setError(null); }
    catch (e) { setError(message(e)); }
  }, [deviceKey, threadId]);
  useEffect(() => { void reload(); }, [reload]);
  const run = async <T,>(action: string, input: Record<string, unknown> = {}): Promise<T | null> => {
    setBusy(true); setError(null);
    try { const r = await sourceAction<T>(threadId, action, { workingCopyId, ...input }, deviceKey); await reload(); return r; }
    catch (e) {
      if (String(e).includes('confirmRunning') && await confirmAsync({ title: pt('create'), message: pt('runningConfirm'), confirmLabel: pt('create') })) {
        try { const r = await sourceAction<T>(threadId, action, { workingCopyId, ...input, confirmRunning: true }, deviceKey); await reload(); return r; } catch (again) { setError(message(again)); return null; }
      }
      setError(message(e)); haptic.warning(); return null;
    } finally { setBusy(false); }
  };
  const ask = (target: AskTarget, prompt: string) => {
    if (target.kind === 'thread' && target.threadId === threadId) onAsk?.(prompt);
    else if (target.kind === 'thread') nav.openThread(deviceKey, target.threadId, prompt);
    else nav.newThread(deviceKey, target.workspaceId, prompt);
  };
  if (reviewing) {
    return <PullRequestReview deviceKey={deviceKey} url={reviewing} onBack={() => setReviewing(null)} currentThreadId={threadId} onAsk={ask}
      onOpenThread={id => nav.openThread(deviceKey, id)} onChanged={() => void reload()} onOpenPull={setReviewing} />;
  }
  return (
    <View style={{ flex: 1 }}>
      <FlatList data={links ?? []} keyExtractor={l => l.url} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 30 }}
        ListHeaderComponent={<View style={{ gap: 8, padding: 10 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label={pt('newPr')} icon={GitPullRequestCreate} size="sm" kind="primary" onPress={() => setCreating(true)} disabled={busy} testID="pr-new" />
            <Button label={rt('allPullRequests')} icon={ListFilter} size="sm" onPress={() => nav.openPage(deviceKey)} />
          </View>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <TextInput underlineColorAndroid="transparent" value={url} onChangeText={setUrl} placeholder={pt('url')} placeholderTextColor={t.c.fgMuted} accessibilityLabel={pt('url')} autoCapitalize="none" autoCorrect={false} keyboardType="url"
              onSubmitEditing={() => { if (url.trim()) void run('link', { url: url.trim() }).then(r => { if (r) setUrl(''); }); }}
              style={{ flex: 1, height: 40, borderWidth: 1, borderColor: t.c.borderStrong, borderRadius: t.radius.md, paddingHorizontal: 10, color: t.c.fg, fontFamily: t.font.mono, fontSize: 13 }} />
            <Button label={pt('link')} icon={Link2} size="sm" disabled={busy || !url.trim()} onPress={() => void run('link', { url: url.trim() }).then(r => { if (r) setUrl(''); })} />
          </View>
          {error ? <Banner tone="danger" text={error} /> : null}
          {links === null && !error ? <ActivityIndicator color={t.c.primary} /> : null}
        </View>}
        ListEmptyComponent={links ? <AppText tone="muted" center style={{ padding: 16 }}>{pt('empty')}</AppText> : undefined}
        renderItem={({ item: link }) => (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 12, paddingRight: 4, borderTopWidth: 1, borderTopColor: t.c.border }}>
            <Press onPress={() => link.kind === 'pr' ? setReviewing(link.url) : void Linking.openURL(link.url).catch(() => undefined)} accessibilityRole="button"
              accessibilityLabel={`${link.repository.owner}/${link.repository.name} ${link.kind === 'issue' ? pt('issues') : 'PR'} #${link.number}`}
              style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 }}>
              {link.kind === 'pr' ? <GitPullRequest size={17} color={t.c.online} /> : <CircleDot size={17} color={t.c.fgSoft} />}
              <View style={{ flex: 1, minWidth: 0 }}>
                <AppText variant="callout" weight="medium">{`#${link.number}`}</AppText>
                <AppText variant="caption" tone="muted" numberOfLines={1}>{`${link.repository.owner}/${link.repository.name} · ${link.kind === 'issue' ? pt('issues') : 'PR'}`}</AppText>
              </View>
            </Press>
            {link.kind === 'pr' ? <IconButton icon={MessageSquareText} label={`${rt('viewLink')} #${link.number}`} onPress={() => setReviewing(link.url)} /> : null}
            <IconButton icon={ExternalLink} label={rt('openHost')} onPress={() => void Linking.openURL(link.url).catch(() => undefined)} />
            <IconButton icon={Unlink} label={`${pt('unlink')} #${link.number}`} disabled={busy}
              onPress={async () => { if (await confirmAsync({ title: `${pt('unlink')} #${link.number}?`, message: link.url, confirmLabel: pt('unlink'), destructive: true })) void run('unlink', { url: link.url }); }} />
          </View>
        )} />
      <CreateSheet visible={creating} onClose={() => setCreating(false)} deviceKey={deviceKey} threadId={threadId} workingCopyId={workingCopyId} running={running} busy={busy}
        run={run} onCreated={() => { setCreating(false); showToast(pt('result'), 'success'); }} />
    </View>
  );
}

function CreateSheet({ visible, onClose, deviceKey, threadId, workingCopyId, busy, run, onCreated }: {
  visible: boolean; onClose(): void; deviceKey: string; threadId: string; workingCopyId: string; running: boolean; busy: boolean;
  run<T>(action: string, input?: Record<string, unknown>): Promise<T | null>; onCreated(): void;
}) {
  const t = useTheme();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [head, setHead] = useState('');
  const [base, setBase] = useState('main');
  const [draft, setDraft] = useState(true);
  const [generating, setGenerating] = useState(false);
  useEffect(() => {
    if (!visible) return;
    fetchThreadGitStatus(threadId, workingCopyId, deviceKey).then(s => { if (s.branch) setHead(h => h || s.branch!); }, () => undefined);
  }, [visible, threadId, workingCopyId, deviceKey]);
  const field = (value: string, set: (v: string) => void, label: string, options: { multiline?: boolean; mono?: boolean } = {}) => (
    <View style={{ gap: 4, flex: options.multiline ? undefined : 1 }}>
      <AppText variant="caption" tone="muted">{label}</AppText>
      <TextInput underlineColorAndroid="transparent" value={value} onChangeText={set} accessibilityLabel={label} multiline={options.multiline} autoCapitalize={options.mono ? 'none' : 'sentences'} autoCorrect={!options.mono}
        textAlignVertical={options.multiline ? 'top' : 'center'} selectionColor={t.c.primary}
        style={{ minHeight: options.multiline ? 110 : 42, maxHeight: 240, borderWidth: 1, borderColor: t.c.borderStrong, borderRadius: t.radius.md, paddingHorizontal: 10, paddingVertical: options.multiline ? 10 : 6,
          color: t.c.fg, fontFamily: options.mono ? t.font.mono : t.font.regular, fontSize: 15 }} />
    </View>
  );
  const generate = async () => {
    setGenerating(true);
    try { const r = await run<{ title?: string; body?: string }>('generate', { head, base }); if (r) { if (r.title) setTitle(r.title); if (r.body) setBody(r.body); } }
    finally { setGenerating(false); }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={pt('newPr')} tall dismissable={!busy}
      footer={<><Button label={pt('cancel')} onPress={onClose} style={{ flex: 1, maxWidth: 220 }} />
        <Button label={pt('create')} kind="primary" busy={busy && !generating} disabled={!title.trim() || !head.trim() || !base.trim() || generating}
          onPress={() => void run('create', { title, body, head, base, draft, kind: 'pr' }).then(r => { if (r) { setTitle(''); setBody(''); onCreated(); } })} style={{ flex: 1, maxWidth: 220 }} testID="pr-create" /></>}>
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>{field(head, setHead, pt('head'), { mono: true })}{field(base, setBase, pt('base'), { mono: true })}</View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
          <View style={{ flex: 1 }}>{field(title, setTitle, pt('prTitle'))}</View>
          {generating ? <View style={{ width: 40, height: 42, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.c.primary} /></View>
            : <IconButton icon={Sparkles} tone="primary" label={pt('generate')} onPress={() => void generate()} disabled={busy || !head.trim()} />}
        </View>
        {field(body, setBody, pt('body'), { multiline: true })}
        <Press onPress={() => setDraft(v => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: draft }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
          {draft ? <SquareCheck size={20} color={t.c.primary} /> : <Square size={20} color={t.c.fgMuted} />}
          <AppText variant="callout">{pt('draft')}</AppText>
        </Press>
        {generating ? <AppText variant="footnote" tone="muted">{translate('review.generating')}</AppText> : null}
      </View>
    </Sheet>
  );
}
