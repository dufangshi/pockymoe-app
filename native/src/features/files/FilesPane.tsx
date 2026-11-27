// Files of the thread's workspace: browse folders (breadcrumbs, a filter for long
// folders), read a file with line numbers, find, wrapping and the same line selection as
// diffs (a review chip in the composer), view images and rendered Markdown, copy the path
// or content, and share the file through the system sheet. Large files load in pages.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, TextInput, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { File as FsFile, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import { ChevronLeft, ChevronRight, Code2, Eye, File, FileImage, FileText, Folder, MoreHorizontal, Search, Share2 } from 'lucide-react-native';
import type { ThreadWorkspaceFilePreviewDto, ThreadWorkspaceTreeNodeDto } from '@pockymoe/shared';
import { deviceRequest } from '../../protocol/webApiShim';
import { deviceFetch } from '../../protocol/transport';
import { findDevice } from '../../connection/devices';
import { AppText } from '../../design/AppText';
import { IconButton } from '../../design/Button';
import { Press } from '../../design/Press';
import { MiddleName } from '../../design/Copy';
import { EmptyState } from '../../design/States';
import { showMenu, showToast } from '../../design/Overlay';
import { useTheme } from '../../design/theme';
import { haptic } from '../../design/haptics';
import { translate } from '../../i18n';
import { DiffViewer, type DiffComment } from '../diff/DiffViewer';
import { fileAsPatch, rangeLabel } from '../diff/model';
import { Markdown } from '../thread/Markdown';

const errorText = (e: unknown) => String((e as Error)?.message ?? e);
const IMAGE = /\.(png|jpe?g|gif|webp|bmp|heic|avif|svg)$/i;
const MARKDOWN = /\.(md|markdown|mdx)$/i;
const PREVIEW_LIMIT = 200_000;
export function formatSize(bytes: number | undefined) {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
/** Workspace paths without `./` or `.` segments (the tree may answer `./src`). */
export const cleanPath = (path: string) => path.split('/').filter(part => part && part !== '.').join('/');
const parentOf = (path: string) => { const p = cleanPath(path); return p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''; };

export interface FilesPaneProps {
  deviceKey: string; threadId: string; workspaceId: string | null;
  /** Open this file (or folder) first. */
  initialPath?: string | null;
  onReviewQuote?: (quote: { path: string; startLine: number; endLine: number; text: string; comment: string }) => boolean;
  onAsk?: (prompt: string) => void;
}

export function FilesPane({ deviceKey, threadId, workspaceId, initialPath, onReviewQuote, onAsk }: FilesPaneProps) {
  const t = useTheme();
  const [dir, setDir] = useState<string>(initialPath ? parentOf(initialPath) : '');
  const [node, setNode] = useState<ThreadWorkspaceTreeNodeDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [file, setFile] = useState<string | null>(initialPath ?? null);
  const [revision, setRevision] = useState(0);
  useEffect(() => { if (initialPath) { setDir(parentOf(initialPath)); setFile(initialPath); } }, [initialPath]);
  const base = workspaceId ? `api/workspaces/${encodeURIComponent(workspaceId)}/files` : null;
  useEffect(() => {
    if (!base) return;
    let live = true; setNode(null); setError(null); setFilter('');
    const params = new URLSearchParams({ threadId, ...(dir ? { path: dir } : {}) });
    deviceRequest<ThreadWorkspaceTreeNodeDto>(deviceKey, `${base}/tree?${params}`, {}, threadId)
      .then(n => { if (live) setNode(n); }, e => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [deviceKey, threadId, base, dir, revision]);
  const children = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return [...(node?.children ?? [])].filter(c => !q || c.name.toLowerCase().includes(q))
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1));
  }, [node, filter]);

  if (!workspaceId || !base) return <EmptyState icon={Folder} title={translate('native.noWorkspace')} />;
  if (file) return <FileViewer key={file} deviceKey={deviceKey} threadId={threadId} base={base} path={file} onBack={() => setFile(null)} onReviewQuote={onReviewQuote} onAsk={onAsk} />;

  const crumbs = cleanPath(dir).split('/').filter(Boolean);
  const entryMenu = (child: ThreadWorkspaceTreeNodeDto) => showMenu({ title: child.name, items: [
    { label: translate('common.copyPath'), copy: child.path },
    ...(child.kind === 'file' ? [{ label: translate('native.share'), icon: Share2, onPress: () => void shareFile(deviceKey, threadId, base, child.path, child.name) }] : []),
  ] });
  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 6, gap: 0, minHeight: 44 }} style={{ flexGrow: 0 }}>
        <Press onPress={() => setDir('')} style={{ paddingHorizontal: 8, minHeight: 40, justifyContent: 'center' }} accessibilityRole="button" accessibilityLabel={translate('native.root')}>
          <AppText variant="subhead" tone={dir ? 'accent' : 'fg'} weight="semibold">{translate('native.root')}</AppText>
        </Press>
        {crumbs.map((c, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <ChevronRight size={13} color={t.c.fgMuted} />
            <Press onPress={() => setDir(crumbs.slice(0, i + 1).join('/'))} style={{ paddingHorizontal: 8, minHeight: 40, justifyContent: 'center' }} accessibilityRole="button">
              <AppText variant="subhead" tone={i === crumbs.length - 1 ? 'fg' : 'accent'} weight={i === crumbs.length - 1 ? 'semibold' : undefined}>{c}</AppText>
            </Press>
          </View>
        ))}
      </ScrollView>
      {(node?.children?.length ?? 0) > 12 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 10, marginBottom: 6, paddingHorizontal: 10, height: 38, borderRadius: t.radius.md, backgroundColor: t.c.surface }}>
          <Search size={15} color={t.c.fgMuted} />
          <TextInput underlineColorAndroid="transparent" value={filter} onChangeText={setFilter} placeholder={translate('review.filterFolder')} placeholderTextColor={t.c.fgMuted} accessibilityLabel={translate('review.filterFolder')}
            autoCapitalize="none" autoCorrect={false} style={{ flex: 1, color: t.c.fg, fontFamily: t.font.regular, fontSize: 15, paddingVertical: 4 }} />
        </View>
      ) : null}
      {error ? <EmptyState title={translate('native.filesUnavailable')} body={error} action={{ label: translate('common.retry'), onPress: () => setRevision(v => v + 1) }} />
        : !node ? <ActivityIndicator style={{ marginTop: 30 }} color={t.c.primary} /> : (
        <FlatList data={children} keyExtractor={c => c.path} contentContainerStyle={{ paddingHorizontal: 4, paddingBottom: 30 }} keyboardShouldPersistTaps="handled"
          onRefresh={() => setRevision(v => v + 1)} refreshing={false}
          ListEmptyComponent={<AppText tone="muted" center style={{ padding: 20 }}>{filter ? translate('review.noMatches') : translate('native.emptyFolder')}</AppText>}
          renderItem={({ item: child }) => {
            const Icon = child.kind === 'directory' ? Folder : IMAGE.test(child.name) ? FileImage : MARKDOWN.test(child.name) ? FileText : File;
            return (
              <Press onPress={() => { haptic.selection(); if (child.kind === 'directory') setDir(cleanPath(child.path)); else setFile(cleanPath(child.path)); }} onLongPress={() => entryMenu(child)}
                accessibilityRole="button" accessibilityLabel={child.kind === 'directory' ? translate('review.openFolder', { name: child.name }) : child.name}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 8, borderRadius: t.radius.sm }}>
                <Icon size={17} color={child.kind === 'directory' ? t.c.accentStrong : t.c.fgMuted} />
                <View style={{ flex: 1, minWidth: 0 }}><MiddleName text={child.name} max={48} /></View>
                {child.kind === 'file' && child.size !== undefined ? <AppText variant="caption" tone="muted">{formatSize(child.size)}</AppText> : null}
                {child.kind === 'directory' ? <ChevronRight size={15} color={t.c.fgMuted} /> : null}
              </Press>
            );
          }} />
      )}
    </View>
  );
}

async function fetchBytes(deviceKey: string, threadId: string, base: string, path: string, kind: 'raw' | 'download') {
  const device = findDevice(deviceKey);
  if (!device) throw new Error('No device');
  const response = await deviceFetch(device.target, `/${base}/${kind}?${new URLSearchParams({ path, threadId })}`, {}, threadId);
  if (!response.ok) throw new Error((await response.text().catch(() => '')).slice(0, 200) || `HTTP ${response.status}`);
  return { bytes: new Uint8Array(await response.arrayBuffer()), type: response.headers.get('content-type') ?? 'application/octet-stream' };
}
async function cacheFile(name: string, content: string | Uint8Array) {
  const target = new FsFile(Paths.cache, `files-${Date.now()}-${name.replace(/[^\w.-]+/g, '_')}`);
  if (target.exists) target.delete();
  target.create();
  await (target as unknown as { write(c: string | Uint8Array): Promise<void> | void }).write(content);
  return target.uri;
}
async function shareFile(deviceKey: string, threadId: string, base: string, path: string, name: string, text?: string) {
  try {
    const uri = text !== undefined ? await cacheFile(name, text) : await cacheFile(name, (await fetchBytes(deviceKey, threadId, base, path, 'download')).bytes);
    await Sharing.shareAsync(uri, { dialogTitle: name });
  } catch (e) { showToast(errorText(e), 'error'); }
}

function FileViewer({ deviceKey, threadId, base, path, onBack, onReviewQuote, onAsk }: { deviceKey: string; threadId: string; base: string; path: string; onBack(): void } & Pick<FilesPaneProps, 'onReviewQuote' | 'onAsk'>) {
  const t = useTheme();
  const name = path.split('/').pop() || path;
  const image = IMAGE.test(name);
  const markdown = MARKDOWN.test(name);
  const [preview, setPreview] = useState<ThreadWorkspaceFilePreviewDto | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(markdown);
  const [more, setMore] = useState(false);
  const load = useCallback(async (offset = 0) => {
    const params = new URLSearchParams({ path, threadId, limit: String(PREVIEW_LIMIT), ...(offset ? { offset: String(offset) } : {}) });
    return deviceRequest<ThreadWorkspaceFilePreviewDto>(deviceKey, `${base}/preview?${params}`, {}, threadId);
  }, [deviceKey, threadId, base, path]);
  useEffect(() => {
    let live = true;
    setError(null); setPreview(null); setImageUri(null);
    if (image) fetchBytes(deviceKey, threadId, base, path, 'raw').then(r => cacheFile(name, r.bytes)).then(uri => { if (live) setImageUri(uri); }, e => { if (live) setError(errorText(e)); });
    else load().then(p => { if (live) setPreview(p); }, e => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [image, load, deviceKey, threadId, base, path, name]);
  const loadMore = async () => {
    if (!preview) return;
    setMore(true);
    try { const next = await load(preview.nextOffset); setPreview({ ...next, content: preview.content + next.content }); }
    catch (e) { showToast(errorText(e), 'error'); } finally { setMore(false); }
  };
  const patch = useMemo(() => preview ? fileAsPatch(path, preview.content) : '', [preview, path]);
  const comment: DiffComment | null = onReviewQuote ? {
    label: translate('review.addToPrompt'),
    onSubmit: (s, text) => { const ok = onReviewQuote({ path, startLine: s.start, endLine: s.end, text: s.text, comment: text }); if (ok) showToast(translate('review.quoteAdded'), 'success'); return ok; },
    ...(onAsk ? { secondary: { label: translate('review.askAgent'), run: (s, text) => onAsk(`${path}:${rangeLabel(s)}\n\`\`\`\n${s.text}\n\`\`\`\n\n${text}`) } } : {}),
  } : null;
  const menu = () => showMenu({ title: name, items: [
    { label: translate('common.copyPath'), copy: path },
    ...(preview ? [{ label: translate('native.copyContent'), copy: preview.content }] : []),
    { label: translate('native.share'), icon: Share2, onPress: () => void shareFile(deviceKey, threadId, base, path, name, preview && !preview.truncated ? preview.content : undefined) },
  ] });
  const subtitle = preview ? [preview.language, formatSize(preview.size)].filter(Boolean).join(' · ') : null;
  const bar = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4, minHeight: 48, borderBottomWidth: 1, borderBottomColor: t.c.border }}>
      <IconButton icon={ChevronLeft} label={translate('native.back')} onPress={onBack} testID="file-back" />
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText variant="subhead" weight="semibold" numberOfLines={1} ellipsizeMode="middle">{name}</AppText>
        <AppText variant="caption" tone="muted" numberOfLines={1} ellipsizeMode="head">{subtitle ?? parentOf(path)}</AppText>
      </View>
      {markdown && preview ? <IconButton icon={rendered ? Code2 : Eye} label={rendered ? translate('review.showSource') : translate('review.showRendered')} onPress={() => setRendered(v => !v)} /> : null}
      <IconButton icon={Share2} label={translate('native.share')} onPress={() => void shareFile(deviceKey, threadId, base, path, name, preview && !preview.truncated ? preview.content : undefined)} />
      <IconButton icon={MoreHorizontal} label={translate('native.more')} onPress={menu} />
    </View>
  );
  const truncated = preview?.truncated ? (
    <Press onPress={() => void loadMore()} disabled={more} style={{ padding: 12, alignItems: 'center' }} accessibilityRole="button">
      {more ? <ActivityIndicator color={t.c.primary} /> : <AppText variant="subhead" tone="accent">{translate('review.loadMoreFile', { size: formatSize(Math.max(0, preview.size - preview.content.length)) })}</AppText>}
    </Press>
  ) : null;
  return (
    <View style={{ flex: 1 }}>
      {bar}
      {error ? <EmptyState title={translate('native.filesUnavailable')} body={error} />
        : image ? (imageUri ? <ScrollView contentContainerStyle={{ padding: 12, alignItems: 'center' }} maximumZoomScale={4} minimumZoomScale={1}>
            <Image source={{ uri: imageUri }} style={{ width: '100%', aspectRatio: 1 }} contentFit="contain" accessibilityLabel={name} />
          </ScrollView> : <ActivityIndicator style={{ marginTop: 30 }} color={t.c.primary} />)
        : !preview ? <ActivityIndicator style={{ marginTop: 30 }} color={t.c.primary} />
        : markdown && rendered ? <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}><Markdown text={preview.content} />{truncated}</ScrollView>
        : <DiffViewer patch={patch} plain single copyValue={preview.content} copyLabel={translate('native.copyContent')} comment={comment} footer={truncated} testID="file-view"
            toolbarStart={<AppText variant="caption" tone="muted" style={{ flex: 1, paddingLeft: 8 }} numberOfLines={1}>{translate('review.lines', { count: preview.content.split('\n').length })}</AppText>} />}
    </View>
  );
}
