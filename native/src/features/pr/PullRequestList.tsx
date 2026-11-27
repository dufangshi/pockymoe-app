// The device's pull requests: one search box (with `author:`, `label:`, `draft:`,
// `review:` qualifiers), one row of filter pills, saved views kept on the Supervisor, then
// the rows. State is read from the hosts; every other filter narrows the same list
// (the Web's listModel, vendored, does the filtering and ranking).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, ScrollView, TextInput, View } from 'react-native';
import { Bookmark, ChevronDown, RefreshCw, Search, X } from 'lucide-react-native';
import { fetchPullRequests, fetchViews, saveViews, type ListQuery, type PageResponse, type PullSummary, type SavedView } from '@pockymoe/web-git/pr/review/reviewApi';
import { activeFilters, DEFAULT_QUERY, filterPulls, matchingView, normalizeQuery, repositoryKey } from '@pockymoe/web-git/pr/review/listModel';
import { rt } from '@pockymoe/web-git/pr/review/reviewText';
import { AppText } from '../../design/AppText';
import { Button, IconButton } from '../../design/Button';
import { Press } from '../../design/Press';
import { Banner, EmptyState } from '../../design/States';
import { Sheet } from '../../design/Sheet';
import { confirmAsync, showMenu, type MenuItem } from '../../design/Overlay';
import { useTheme } from '../../design/theme';
import { haptic } from '../../design/haptics';
import { prefs } from '../../platform/prefs';
import { Stat } from '../diff/DiffViewer';
import { Ago, ChecksMark, DecisionMark, Label, PullStateMark, message } from './parts';
import { StackChip } from './StackBar';

const queryKey = (deviceKey: string) => `pockymoe.pr.query:${deviceKey}`;
export function usePullRequests(deviceKey: string) {
  const [query, setQueryState] = useState<ListQuery>(() => ({ ...normalizeQuery(prefs.getJson(queryKey(deviceKey)) ?? DEFAULT_QUERY) }));
  const [page, setPage] = useState<PageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [views, setViews] = useState<SavedView[]>([]);
  const [revision, setRevision] = useState(0);
  const setQuery = useCallback((next: ListQuery) => { setQueryState(next); prefs.setJson(queryKey(deviceKey), next); }, [deviceKey]);
  useEffect(() => {
    let live = true; setLoading(true); setError(null);
    fetchPullRequests(deviceKey, query.state).then(p => { if (live) setPage(p); }, e => { if (live) setError(message(e)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [deviceKey, query.state, revision]);
  useEffect(() => { fetchViews(deviceKey).then(v => setViews(v.views), () => undefined); }, [deviceKey]);
  const updateViews = useCallback(async (next: SavedView[]) => { const r = await saveViews(deviceKey, next); setViews(r.views); }, [deviceKey]);
  return { query, setQuery, page, loading, error, views, updateViews, refresh: () => setRevision(v => v + 1) };
}

function Pill({ label, value, active, onPress }: { label: string; value: string; active: boolean; onPress(): void }) {
  const t = useTheme();
  return (
    <Press onPress={onPress} feedback="dim" accessibilityRole="button" accessibilityLabel={`${label}: ${value}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 32, paddingHorizontal: 10, borderRadius: t.radius.pill, borderWidth: 1,
        borderColor: active ? t.c.primary : t.c.border, backgroundColor: active ? t.c.accentSoft : t.c.surface }}>
      <AppText variant="subhead" weight={active ? 'semibold' : 'medium'} color={active ? t.c.accentStrong : t.c.fg} numberOfLines={1} style={{ maxWidth: 160 }}>{value}</AppText>
      <ChevronDown size={13} color={active ? t.c.accentStrong : t.c.fgMuted} />
    </Press>
  );
}

export interface PullRequestListProps {
  deviceKey: string; selected: string | null; onOpen(pull: PullSummary): void;
  state: ReturnType<typeof usePullRequests>;
  header?: React.ReactNode;
}
export function PullRequestList({ selected, onOpen, state, header }: PullRequestListProps) {
  const t = useTheme();
  const { query, setQuery, page, loading, error, views, updateViews, refresh } = state;
  const [naming, setNaming] = useState<{ id: string | null; name: string } | null>(null);
  const namingName = naming ? naming.name : '';
  const pulls = useMemo(() => page ? filterPulls(page.pulls, query, page.viewers) : [], [page, query]);
  const repositories = useMemo(() => (page?.repositories ?? []).map(e => ({ value: `${e.repository.host}/${e.repository.owner}/${e.repository.name}`, label: `${e.repository.owner}/${e.repository.name}` })), [page]);
  const failed = (page?.repositories ?? []).filter(e => e.error);
  const set = <K extends keyof ListQuery>(key: K, value: ListQuery[K]) => { haptic.selection(); setQuery({ ...query, [key]: value }); };
  const current = matchingView(views, query);
  const filters = activeFilters(query);
  const pick = <K extends keyof ListQuery>(title: string, key: K, options: { value: ListQuery[K]; label: string }[]) =>
    showMenu({ title, items: options.map(o => ({ label: o.label, checked: query[key] === o.value, onPress: () => set(key, o.value) })) });
  const label = <K extends keyof ListQuery>(key: K, options: { value: ListQuery[K]; label: string }[]) => options.find(o => o.value === query[key])?.label ?? String(query[key]);
  const STATE = [{ value: 'open' as const, label: rt('open') }, { value: 'merged' as const, label: rt('merged') }, { value: 'closed' as const, label: rt('closed') }, { value: 'all' as const, label: rt('all') }];
  const INVOLVE = [{ value: 'all' as const, label: rt('anyone') }, { value: 'reviewing' as const, label: rt('reviewing') }, { value: 'authored' as const, label: rt('authored') }];
  const REVIEW = [{ value: 'all' as const, label: rt('reviewAll') }, { value: 'approved' as const, label: rt('approved') }, { value: 'changesRequested' as const, label: rt('changesRequested') }, { value: 'reviewRequired' as const, label: rt('reviewRequired') }, { value: 'none' as const, label: rt('noReview') }];
  const CHECKS = [{ value: 'all' as const, label: rt('checksAll') }, { value: 'passed' as const, label: rt('passing') }, { value: 'failed' as const, label: rt('failing') }, { value: 'pending' as const, label: rt('pending') }];
  const DRAFT = [{ value: 'all' as const, label: rt('draftAll') }, { value: 'only' as const, label: rt('draftOnly') }, { value: 'hide' as const, label: rt('draftHide') }];
  const SORT = [{ value: 'ready' as const, label: rt('sortReady') }, { value: 'updated' as const, label: rt('sortUpdated') }, { value: 'newest' as const, label: rt('sortNewest') }, { value: 'oldest' as const, label: rt('sortOldest') }, { value: 'largest' as const, label: rt('sortLargest') }, { value: 'smallest' as const, label: rt('sortSmallest') }];
  const REPO = [{ value: '', label: rt('repositoryAll') }, ...repositories];
  const viewsMenu = () => {
    const items: MenuItem[] = [
      { label: rt('defaultView'), onPress: () => setQuery(DEFAULT_QUERY) },
      ...views.map(v => ({ label: v.name, checked: current?.id === v.id, onPress: () => setQuery({ ...DEFAULT_QUERY, ...normalizeQuery(v.query) }) })),
      { label: rt('saveView'), onPress: () => setNaming({ id: null, name: query.involvement === 'reviewing' ? rt('reviewing') : '' }) },
      ...(current ? [
        { label: rt('renameView'), onPress: () => setNaming({ id: current.id, name: current.name }) },
        { label: rt('deleteView'), destructive: true, onPress: async () => { if (await confirmAsync({ title: rt('deleteView'), message: current.name, confirmLabel: rt('deleteView'), destructive: true })) void updateViews(views.filter(v => v.id !== current.id)); } },
      ] : []),
    ];
    showMenu({ title: rt('views'), items });
  };
  const saveNamed = async () => {
    if (!naming?.name.trim()) return;
    const name = naming.name.trim().slice(0, 80);
    await updateViews(naming.id ? views.map(v => v.id === naming.id ? { ...v, name } : v) : [...views, { id: globalThis.crypto.randomUUID(), name, query }]);
    setNaming(null);
  };
  const listHeader = (
    <View>
      {header}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingTop: 6 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 40, borderRadius: t.radius.md, backgroundColor: t.c.surface, borderWidth: 1, borderColor: t.c.border }}>
          <Search size={16} color={t.c.fgMuted} />
          <TextInput underlineColorAndroid="transparent" value={query.search} onChangeText={v => setQuery({ ...query, search: v })} placeholder={rt('search')} placeholderTextColor={t.c.fgMuted} accessibilityLabel={rt('searchLabel')}
            autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={{ flex: 1, color: t.c.fg, fontFamily: t.font.regular, fontSize: 15, paddingVertical: 6 }} />
          {query.search ? <IconButton icon={X} size={15} label={rt('clearFilters')} onPress={() => setQuery({ ...query, search: '' })} style={{ width: 30, height: 30 }} /> : null}
        </View>
        <IconButton icon={Bookmark} label={rt('views')} active={!!current} onPress={viewsMenu} testID="pr-views" />
        <IconButton icon={RefreshCw} label={rt('refresh')} disabled={loading} onPress={refresh} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 10, paddingVertical: 8 }} accessibilityLabel={rt('filters')}>
        <Pill label={rt('page')} value={label('state', STATE)} active={query.state !== 'open'} onPress={() => pick(rt('page'), 'state', STATE)} />
        <Pill label={rt('involvement')} value={label('involvement', INVOLVE)} active={query.involvement !== 'all'} onPress={() => pick(rt('involvement'), 'involvement', INVOLVE)} />
        <Pill label={rt('review')} value={label('review', REVIEW)} active={query.review !== 'all'} onPress={() => pick(rt('review'), 'review', REVIEW)} />
        <Pill label={rt('checks')} value={label('checks', CHECKS)} active={query.checks !== 'all'} onPress={() => pick(rt('checks'), 'checks', CHECKS)} />
        <Pill label={rt('draft')} value={label('draft', DRAFT)} active={query.draft !== 'all'} onPress={() => pick(rt('draft'), 'draft', DRAFT)} />
        {repositories.length > 1 ? <Pill label={rt('repository')} value={label('repository', REPO)} active={!!query.repository} onPress={() => pick(rt('repository'), 'repository', REPO)} /> : null}
        <Pill label={rt('sort')} value={label('sort', SORT)} active={query.sort !== 'ready'} onPress={() => pick(rt('sort'), 'sort', SORT)} />
        {filters > 0 ? <Button label={rt('clearFilters')} icon={X} size="sm" kind="ghost" onPress={() => setQuery({ ...DEFAULT_QUERY, state: query.state, search: query.search, sort: query.sort })} /> : null}
      </ScrollView>
      {error ? <View style={{ paddingHorizontal: 10 }}><Banner tone="danger" text={error} action={{ label: rt('tryAgain'), onPress: refresh }} /></View>
        : failed.length ? <View style={{ paddingHorizontal: 10 }}><Banner tone="warning" text={`${rt('repoFailed', { n: failed.length })}: ${failed.map(e => `${e.repository.owner}/${e.repository.name}`).join(', ')}`} action={{ label: rt('tryAgain'), onPress: refresh }} /></View> : null}
    </View>
  );
  return (
    <>
      <FlatList data={pulls} keyExtractor={p => p.url} ListHeaderComponent={listHeader} onRefresh={refresh} refreshing={false} keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 40 }}
        ListEmptyComponent={page && !page.repositories.length ? <EmptyState title={rt('noRepositories')} /> : page && !loading ? <EmptyState title={rt('empty')} />
          : !page && loading ? <EmptyState title={rt('loading')} /> : undefined}
        renderItem={({ item: pull }) => {
          const on = selected === pull.url;
          return (
            <Press onPress={() => { haptic.selection(); onOpen(pull); }} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`#${pull.number} ${pull.title}`} testID={`pr-row-${pull.number}`}
              style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: on ? t.c.accentSoft : 'transparent', borderBottomWidth: 1, borderBottomColor: t.c.border }}>
              <View style={{ paddingTop: 2 }}><PullStateMark state={pull.state} draft={pull.draft} /></View>
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
                  <AppText variant="callout" weight="medium" numberOfLines={2} style={{ flex: 1 }}>{pull.title}</AppText>
                  <View style={{ flexDirection: 'row', gap: 3, paddingTop: 2 }}><ChecksMark checks={pull.checks} /><DecisionMark decision={pull.reviewDecision} /></View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <AppText variant="caption" tone="muted">{`${repositories.length > 1 ? `${pull.repository.name} ` : ''}#${pull.number}`}</AppText>
                  {pull.author ? <AppText variant="caption" tone="soft" numberOfLines={1}>{pull.author.login}</AppText> : null}
                  <Ago value={pull.updatedAt} />
                  <Stat additions={pull.additions} deletions={pull.deletions} />
                  <StackChip stack={pull.stack} />
                  {pull.labels.slice(0, 2).map(l => <Label key={l.name} name={l.name} color={l.color} />)}
                </View>
              </View>
            </Press>
          );
        }} />
      <Sheet visible={!!naming} onClose={() => setNaming(null)} title={naming?.id ? rt('renameView') : rt('saveView')} subtitle={rt('viewHint')}
        footer={<><Button label={rt('cancel')} onPress={() => setNaming(null)} style={{ flex: 1, maxWidth: 220 }} /><Button label={rt('save')} kind="primary" disabled={!namingName.trim()} onPress={() => void saveNamed()} style={{ flex: 1, maxWidth: 220 }} /></>}>
        <TextInput underlineColorAndroid="transparent" value={naming?.name ?? ''} onChangeText={name => naming && setNaming({ ...naming, name })} autoFocus maxLength={80} accessibilityLabel={rt('viewName')} placeholder={rt('viewName')} placeholderTextColor={t.c.fgMuted}
          style={{ height: 44, borderWidth: 1, borderColor: t.c.borderStrong, borderRadius: t.radius.md, paddingHorizontal: 10, color: t.c.fg, fontFamily: t.font.regular, fontSize: 15 }} />
      </Sheet>
    </>
  );
}
export { repositoryKey };
