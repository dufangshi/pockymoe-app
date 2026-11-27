// The one diff viewer (Git changes, turn changes, commits, PR code, guide excerpts).
// One virtualized list of rows: file headings fold, hunks carry their writes, lines are
// numbered and tinted with an edge bar (or blue/orange). Unified, or split side by side
// when the viewer is ≥ 720 dp wide. Long lines wrap, or all code scrolls sideways together
// while numbers and headings stay put. Find opens matching files and steps through hits.
// A tap on a line selects it, a long press starts a range and a tap ends it; the
// selection becomes a comment (a composer chip, a PR draft or a question for an agent).
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactElement, type ReactNode } from 'react';
import { TextInput, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withDecay, type SharedValue } from 'react-native-reanimated';
import { ChevronDown, ChevronRight, ChevronUp, MessageCircleQuestion, MessageSquarePlus, Search, SlidersHorizontal, X } from 'lucide-react-native';
import { gitText as gt } from '@pockymoe/web/gitI18n';
import { AppText } from '../../design/AppText';
import { Button, IconButton } from '../../design/Button';
import { CopyButton } from '../../design/Copy';
import { Press } from '../../design/Press';
import { Sheet } from '../../design/Sheet';
import { showMenu } from '../../design/Overlay';
import { useTheme, type Theme } from '../../design/theme';
import { haptic } from '../../design/haptics';
import { translate } from '../../i18n';
import {
  buildRows, findMatches, hunkPatches, inRange, isCode, lineNumber, lineSide, longestLine, numberLines, parsePatch, rangeLabel, rangeText,
  type DiffRow, type LineRange, type NumberedLine, type ParsedPatch, type PatchFile, type Selection, type Side,
} from './model';
import { diffPrefs, setDiffPref, SPLIT_MIN } from './prefs';
import { useFocusWhen } from './focus';

const CODE_SIZE = 12;
const CODE_LINE = 18;
const CHAR = 7.25;
const PAGE = 400;

export type HunkAction = 'stage' | 'unstage' | 'discard';
export interface DiffComment {
  /** The main action (Add to prompt, Add to review). Returns true when the comment was taken. */
  label: string;
  onSubmit(selection: Selection, comment: string): boolean | Promise<boolean>;
  /** A second action in the comment sheet (Ask agent). */
  secondary?: { label: string; run(selection: Selection, comment: string): void };
}
export interface DiffViewerProps {
  patch: string;
  parsed?: ParsedPatch;
  /** One file on its own: its heading is a label, not a way to open it. */
  single?: boolean;
  onOpenFile?: (path: string) => void;
  fileAccessory?: (file: PatchFile) => ReactNode;
  /** A file's folded state before the reader changes it (Viewed files in a PR). */
  defaultClosed?: (path: string) => boolean;
  hunkActions?: { actions: HunkAction[]; busy: boolean; run(action: HunkAction, patch: string): void } | null;
  comment?: DiffComment | null;
  annotated?: (path: string, side: Side, line: number) => boolean;
  annotation?: (path: string, side: Side, line: number) => ReactNode;
  header?: ReactElement | null;
  footer?: ReactElement | null;
  /** Shown instead of rows when the patch has no files. */
  empty?: ReactElement | null;
  /** Show the find / options / copy row (off for short guide excerpts). */
  toolbar?: boolean;
  toolbarStart?: ReactNode;
  /** Render rows without a virtualized list (a short excerpt inside another list). */
  inline?: boolean;
  /** A file's lines, not a diff: no headings, hunks or signs (see `fileAsPatch`). */
  plain?: boolean;
  /** What the copy button copies; null hides it. Defaults to the patch. */
  copyValue?: string | null;
  copyLabel?: string;
  /** The page already names the one file shown (Git's file view): leave out its heading. */
  hideFileHeading?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  testID?: string;
}

interface Palette { add: string; addBg: string; del: string; delBg: string }
const palette = (t: Theme, colorblind: boolean): Palette => colorblind
  ? { add: t.c.info, addBg: t.c.infoBg, del: t.c.warning, delBg: t.c.warningBg }
  : { add: t.c.success, addBg: t.c.successBg, del: t.c.danger, delBg: t.c.dangerBg };

export function DiffViewer(props: DiffViewerProps) {
  const { patch, single, defaultClosed, comment, annotated, toolbar = true, inline } = props;
  const t = useTheme();
  const prefsValue = diffPrefs.useValue(s => s);
  const window = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const parsed = useMemo(() => props.parsed ?? parsePatch(patch), [props.parsed, patch]);
  const hunks = useMemo(() => props.hunkActions ? hunkPatches(patch) : null, [patch, props.hunkActions]);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [limits, setLimits] = useState<Record<string, number>>({});
  useEffect(() => { setOverrides({}); setLimits({}); }, [patch, prefsValue.collapsed]);
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState(0);
  const matches = useMemo(() => finding ? findMatches(parsed.files, query) : [], [finding, parsed, query]);
  const matchedFiles = useMemo(() => new Set(matches.map(m => parsed.files[m.file]!.path)), [matches, parsed]);
  const [selection, setSelection] = useState<LineRange | null>(null);
  const [pending, setPending] = useState<{ path: string; side: Side; line: number } | null>(null);
  const [composing, setComposing] = useState(false);
  useEffect(() => { setSelection(null); setPending(null); }, [patch]);

  const viewerWidth = width || window.width;
  const split = prefsValue.split && viewerWidth >= SPLIT_MIN;
  const wrap = split || (prefsValue.wrap ?? viewerWidth < 600);
  const open = useCallback((path: string) => matchedFiles.has(path) || (overrides[path] ?? (defaultClosed ? !defaultClosed(path) : single || !prefsValue.collapsed)),
    [matchedFiles, overrides, defaultClosed, single, prefsValue.collapsed]);
  const plain = !!props.plain;
  const rows = useMemo(() => buildRows(parsed, { open, split: split && !plain, limit: path => limits[path] ?? (plain ? Infinity : PAGE), annotated, hunks, bare: plain, noHeading: !!props.hideFileHeading && parsed.files.length === 1 }), [parsed, open, split, limits, annotated, hunks, plain, props.hideFileHeading]);
  const numbered = useMemo(() => new Map(parsed.files.map(file => [file.path, numberLines(file.lines)])), [parsed]);
  const digits = useMemo(() => {
    let max = 1;
    for (const lines of numbered.values()) for (const line of lines) max = Math.max(max, line.old ?? 0, line.new ?? 0);
    return String(max).length;
  }, [numbered]);
  const gutter = digits * CHAR + 14;
  const codeWidth = Math.max(0, viewerWidth - gutter - 4);
  const contentWidth = Math.max(codeWidth, longestLine(parsed) * CHAR + 24);
  const maxX = wrap ? 0 : Math.max(0, contentWidth - codeWidth);
  const scrollX = useSharedValue(0);
  const startX = useSharedValue(0);
  const limitX = useSharedValue(maxX);
  useEffect(() => { limitX.value = maxX; if (scrollX.value > maxX) scrollX.value = maxX; }, [maxX, limitX, scrollX]);
  const pan = useMemo(() => Gesture.Pan().enabled(!wrap).activeOffsetX([-12, 12]).failOffsetY([-14, 14])
    .onBegin(() => { startX.value = scrollX.value; })
    .onUpdate(e => { scrollX.value = Math.min(limitX.value, Math.max(0, startX.value - e.translationX)); })
    .onEnd(e => { scrollX.value = withDecay({ velocity: -e.velocityX, clamp: [0, limitX.value] }); }), [wrap, scrollX, startX, limitX]);

  const listRef = useRef<LegendListRef>(null);
  const matchKey = useMemo(() => {
    const hit = matches[current];
    if (!hit) return null;
    const file = parsed.files[hit.file]!;
    return { path: file.path, index: hit.line };
  }, [matches, current, parsed]);
  useEffect(() => {
    if (!matchKey || inline) return;
    const index = rows.findIndex(row => (row.type === 'line' || row.type === 'hunk' ? row.line.index === matchKey.index : row.type === 'pair' && (row.left?.index === matchKey.index || row.right?.index === matchKey.index)) && 'path' in row && row.path === matchKey.path);
    if (index >= 0) listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.4 });
  }, [matchKey, rows, parsed, inline]);
  const step = (delta: number) => { if (!matches.length) return; haptic.selection(); setCurrent(value => (value + delta + matches.length) % matches.length); };

  const pressLine = useCallback((path: string, line: NumberedLine, long: boolean) => {
    if (!comment || !isCode(line)) return;
    const side = lineSide(line);
    const n = lineNumber(line, side)!;
    if (long) { haptic.selection(); setPending({ path, side, line: n }); setSelection({ path, side, start: n, end: n }); return; }
    if (pending && pending.path === path && pending.side === side) {
      haptic.selection();
      setSelection({ path, side, start: Math.min(pending.line, n), end: Math.max(pending.line, n) });
      setPending(null);
      return;
    }
    setPending(null);
    setSelection(value => value && value.path === path && value.side === side && value.start === n && value.end === n ? null : { path, side, start: n, end: n });
  }, [comment, pending]);
  const selected = useMemo<Selection | null>(() => {
    if (!selection) return null;
    const lines = numbered.get(selection.path);
    return lines ? { ...selection, text: rangeText(lines, selection) } : null;
  }, [selection, numbered]);
  const toggle = useCallback((path: string, isOpen: boolean) => setOverrides(value => ({ ...value, [path]: !isOpen })), []);
  const more = useCallback((path: string) => setLimits(value => ({ ...value, [path]: (value[path] ?? PAGE) + PAGE * 2 })), []);
  const colors = palette(t, prefsValue.colorblind);
  const q = finding ? query.trim().toLocaleLowerCase() : '';

  const renderRow = ({ item }: { item: DiffRow }) => (
    <RowView row={item} t={t} colors={colors} gutter={gutter} wrap={wrap} contentWidth={contentWidth} scrollX={scrollX}
      single={!!single} plain={plain} query={q} current={matchKey} selection={selection} pending={pending}
      onToggle={toggle} onOpenFile={props.onOpenFile} onMore={more} onLine={comment ? pressLine : undefined}
      fileAccessory={props.fileAccessory} hunkActions={props.hunkActions ?? null} annotation={props.annotation} />
  );

  const options = () => showMenu({ title: translate('review.diffOptions'), items: [
    ...(viewerWidth >= SPLIT_MIN ? [
      { label: gt('unified'), checked: !prefsValue.split, onPress: () => setDiffPref('split', false) },
      { label: gt('split'), checked: prefsValue.split, onPress: () => setDiffPref('split', true) },
    ] : []),
    ...(!split ? [{ label: translate('review.wrapLines'), checked: wrap, onPress: () => setDiffPref('wrap', !wrap) }] : []),
    { label: gt('whitespace'), checked: prefsValue.whitespace, onPress: () => setDiffPref('whitespace', !prefsValue.whitespace) },
    { label: gt('collapse'), checked: prefsValue.collapsed, onPress: () => setDiffPref('collapsed', !prefsValue.collapsed) },
    { label: translate('review.colorblind'), checked: prefsValue.colorblind, onPress: () => setDiffPref('colorblind', !prefsValue.colorblind) },
  ] });

  const bar = toolbar ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, minHeight: 44 }}>
      {props.toolbarStart ?? <View style={{ flex: 1 }} />}
      {parsed.files.length ? <IconButton icon={Search} label={gt('find')} active={finding} onPress={() => { setFinding(v => !v); setQuery(''); setCurrent(0); }} testID="diff-find" /> : null}
      <IconButton icon={SlidersHorizontal} label={translate('review.diffOptions')} onPress={options} testID="diff-options" />
      {props.copyValue !== null && (props.copyValue ?? patch) ? <CopyButton value={props.copyValue ?? patch} label={props.copyLabel ?? translate('workbench.gitCopyPatch')} size={18} style={{ width: 40, height: 40, justifyContent: 'center' }} /> : null}
    </View>
  ) : null;
  const findBar = finding ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 10, paddingRight: 4, minHeight: 44, borderBottomWidth: 1, borderBottomColor: t.c.border, backgroundColor: t.c.panel }}>
      <Search size={15} color={t.c.fgMuted} />
      <TextInput underlineColorAndroid="transparent" value={query} onChangeText={v => { setQuery(v); setCurrent(0); }} autoFocus placeholder={gt('find')} placeholderTextColor={t.c.fgMuted}
        accessibilityLabel={gt('find')} autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => step(1)} blurOnSubmit={false}
        style={{ flex: 1, color: t.c.fg, fontFamily: t.font.mono, fontSize: 14, paddingVertical: 8, paddingHorizontal: 8 }} />
      <AppText variant="caption" tone="muted" accessibilityLiveRegion="polite">{query.trim() ? matches.length ? translate('review.matchOf', { current: current + 1, total: matches.length }) : translate('review.noMatches') : ''}</AppText>
      <IconButton icon={ChevronUp} label={gt('previousMatch')} onPress={() => step(-1)} disabled={!matches.length} size={18} />
      <IconButton icon={ChevronDown} label={gt('nextMatch')} onPress={() => step(1)} disabled={!matches.length} size={18} />
      <IconButton icon={X} label={gt('closeFind')} onPress={() => { setFinding(false); setQuery(''); }} size={18} />
    </View>
  ) : null;
  const selectionBar = comment && (selection || pending) ? (
    <View style={{ position: 'absolute', left: 10, right: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 6, padding: 6, paddingLeft: 12, borderRadius: t.radius.lg,
      backgroundColor: t.c.panel, borderWidth: 1, borderColor: t.c.borderStrong, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 }}>
      <AppText variant="subhead" numberOfLines={1} style={{ flex: 1 }}>{pending ? translate('review.pickRangeEnd') : `${selection!.path.split('/').pop()}:${rangeLabel(selection!)}`}</AppText>
      {selection ? <Button label={gt('comment')} icon={MessageSquarePlus} size="sm" kind="primary" onPress={() => setComposing(true)} testID="diff-comment" /> : null}
      <IconButton icon={X} label={translate('review.clearSelection')} onPress={() => { setSelection(null); setPending(null); }} size={18} />
    </View>
  ) : null;
  const sheet = comment && selected ? (
    <CommentSheet visible={composing} selection={selected} comment={comment} onClose={() => setComposing(false)}
      onDone={() => { setComposing(false); setSelection(null); setPending(null); }} />
  ) : null;

  const onLayout = (e: LayoutChangeEvent) => { const w = Math.round(e.nativeEvent.layout.width); if (w && Math.abs(w - width) > 1) setWidth(w); };
  if (inline) {
    return (
      <View onLayout={onLayout} testID={props.testID}>
        {bar}{findBar}
        <GestureDetector gesture={pan}><View>{rows.map(row => <View key={row.key}>{renderRow({ item: row })}</View>)}</View></GestureDetector>
        {selectionBar ? <View style={{ height: 56 }} /> : null}
        {selectionBar}
        {sheet}
      </View>
    );
  }
  return (
    <View style={{ flex: 1 }} onLayout={onLayout} testID={props.testID}>
      {findBar}
      <GestureDetector gesture={pan}>
        <View style={{ flex: 1 }}>
          <LegendList ref={listRef} data={parsed.files.length || parsed.preamble.length ? rows : []} keyExtractor={row => row.key} renderItem={renderRow}
            getItemType={row => row.type} estimatedItemSize={CODE_LINE} recycleItems extraData={[selection, pending, q, matchKey, wrap, split, contentWidth, colors]}
            ListHeaderComponent={<>{props.header}{bar}</>} ListFooterComponent={<>{props.footer}<View style={{ height: selectionBar ? 72 : 24 }} /></>}
            ListEmptyComponent={props.empty ?? undefined} keyboardShouldPersistTaps="handled"
            onRefresh={props.onRefresh} refreshing={props.refreshing ?? false} />
        </View>
      </GestureDetector>
      {selectionBar}
      {sheet}
    </View>
  );
}

interface RowViewProps {
  row: DiffRow; t: Theme; colors: Palette; gutter: number; wrap: boolean; contentWidth: number; scrollX: SharedValue<number>;
  single: boolean; plain: boolean; query: string; current: { path: string; index: number } | null; selection: LineRange | null; pending: { path: string; side: Side; line: number } | null;
  onToggle(path: string, open: boolean): void; onOpenFile?: ((path: string) => void) | undefined; onMore(path: string): void;
  onLine?: ((path: string, line: NumberedLine, long: boolean) => void) | undefined;
  fileAccessory?: ((file: PatchFile) => ReactNode) | undefined; hunkActions: DiffViewerProps['hunkActions'] | null;
  annotation?: ((path: string, side: Side, line: number) => ReactNode) | undefined;
}

const RowView = memo(function RowView(p: RowViewProps) {
  const { row, t } = p;
  switch (row.type) {
    case 'preamble': return <AppText variant="monoSmall" tone="soft" style={{ padding: 10 }} selectable>{row.text}</AppText>;
    case 'file': return <FileHeading {...p} row={row} />;
    case 'note': return <AppText variant="footnote" tone="muted" style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: t.c.code }}>{row.path ? gt(row.note, { path: row.path }) : gt(row.note)}</AppText>;
    case 'more': return (
      <Press onPress={() => p.onMore(row.path)} accessibilityRole="button" style={{ paddingHorizontal: 12, minHeight: 40, justifyContent: 'center', backgroundColor: t.c.code }}>
        <AppText variant="subhead" tone="accent">{translate('native.showMoreCount', { count: row.remaining })}</AppText>
      </Press>
    );
    case 'annotation': return <View style={{ paddingLeft: p.gutter, paddingRight: 8, paddingVertical: 6, backgroundColor: t.c.code, gap: 6 }}>{p.annotation?.(row.path, row.side, row.line)}</View>;
    case 'hunk': return <HunkRow {...p} row={row} />;
    case 'line': return <LineRow {...p} path={row.path} line={row.line} />;
    case 'pair': return (
      <View style={{ flexDirection: 'row' }}>
        <View style={{ flex: 1, minWidth: 0, borderRightWidth: 1, borderRightColor: t.c.border }}>{row.left ? <LineRow {...p} path={row.path} line={row.left} side="old" /> : <Blank t={t} />}</View>
        <View style={{ flex: 1, minWidth: 0 }}>{row.right ? <LineRow {...p} path={row.path} line={row.right} side="new" /> : <Blank t={t} />}</View>
      </View>
    );
  }
});

function Blank({ t }: { t: Theme }) { return <View style={{ flex: 1, minHeight: CODE_LINE, backgroundColor: t.c.muted, opacity: 0.35 }} />; }

function FileHeading({ row, t, single, onToggle, onOpenFile, fileAccessory }: RowViewProps & { row: Extract<DiffRow, { type: 'file' }> }) {
  const { file, open } = row;
  const Chevron = open ? ChevronDown : ChevronRight;
  const name = file.path.split('/').pop() || file.path;
  const dir = file.path.slice(0, file.path.length - name.length);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingRight: 4, backgroundColor: t.c.surface, borderTopWidth: row.fileIndex ? 1 : 0, borderTopColor: t.c.border, borderBottomWidth: 1, borderBottomColor: t.c.border }}>
      <IconButton icon={Chevron} size={16} label={translate('review.toggleFile', { path: file.path })} onPress={() => onToggle(file.path, open)} />
      <Press onPress={() => single || !onOpenFile ? onToggle(file.path, open) : onOpenFile(file.path)} feedback="dim" accessibilityRole="button"
        accessibilityLabel={single || !onOpenFile ? translate('review.toggleFile', { path: file.path }) : translate('workbench.gitViewFile', { path: file.path })}
        style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingVertical: 8 }}>
        <AppText variant="subhead" weight="semibold" numberOfLines={1} style={{ flexShrink: 0, maxWidth: '70%' }} ellipsizeMode="middle">{name}</AppText>
        {dir ? <AppText variant="caption" tone="muted" numberOfLines={1} ellipsizeMode="head" style={{ flexShrink: 1 }}>{dir}</AppText> : null}
      </Press>
      {file.binary ? <AppText variant="caption" tone="muted">{gt('binary')}</AppText> : <Stat additions={file.additions} deletions={file.deletions} />}
      {fileAccessory?.(file)}
    </View>
  );
}

export function Stat({ additions, deletions, colorblind }: { additions: number | null | undefined; deletions: number | null | undefined; colorblind?: boolean }) {
  const t = useTheme();
  const cb = colorblind ?? diffPrefs.get().colorblind;
  if (!additions && !deletions) return null;
  const colors = palette(t, cb);
  return (
    <View style={{ flexDirection: 'row', gap: 4, paddingHorizontal: 4 }} accessible accessibilityLabel={gt('statTitle', { added: additions ?? 0, removed: deletions ?? 0 })}>
      {additions ? <AppText variant="caption" color={colors.add}>{`+${additions}`}</AppText> : null}
      {deletions ? <AppText variant="caption" color={colors.del}>{`−${deletions}`}</AppText> : null}
    </View>
  );
}

function HunkRow({ row, t, hunkActions, gutter }: RowViewProps & { row: Extract<DiffRow, { type: 'hunk' }> }) {
  const actions = row.patch && hunkActions ? hunkActions.actions : [];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: actions.length ? 40 : 26, backgroundColor: t.c.infoBg, paddingLeft: Math.max(10, gutter - 26) }}>
      <AppText variant="monoSmall" color={t.c.info} numberOfLines={1} style={{ flex: 1, fontSize: 11 }}>{row.line.text}</AppText>
      {actions.map(action => (
        <Press key={action} disabled={hunkActions!.busy} onPress={() => hunkActions!.run(action, row.patch!)} feedback="dim" accessibilityRole="button"
          accessibilityLabel={`${gt(action)} ${gt('hunk')}`} style={{ paddingHorizontal: 10, minHeight: 40, justifyContent: 'center' }}>
          <AppText variant="caption" weight="semibold" color={action === 'discard' ? t.c.danger : t.c.accentStrong}>{gt(action)}</AppText>
        </Press>
      ))}
    </View>
  );
}

function Highlighted({ text, query, color, t }: { text: string; query: string; color: string; t: Theme }) {
  if (!query) return <>{text}</>;
  const lower = text.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let from = 0, at = lower.indexOf(query);
  while (at >= 0) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<AppText key={at} variant="monoSmall" color={t.c.fg} style={{ backgroundColor: t.c.warningBg, fontSize: CODE_SIZE, lineHeight: CODE_LINE }}>{text.slice(at, at + query.length)}</AppText>);
    from = at + query.length; at = lower.indexOf(query, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  void color;
  return <>{parts}</>;
}

function LineRow({ path, line, side: column, t, colors, gutter, wrap, contentWidth, scrollX, plain, query, current, selection, pending, onLine }: RowViewProps & { path: string; line: NumberedLine; side?: Side }) {
  const side = column ?? lineSide(line);
  const n = line.kind === 'ctx' ? (side === 'old' ? line.old : line.new) : lineNumber(line);
  const tint = line.kind === 'add' ? colors.addBg : line.kind === 'del' ? colors.delBg : 'transparent';
  const edge = line.kind === 'add' ? colors.add : line.kind === 'del' ? colors.del : 'transparent';
  const chosen = inRange(selection, path, line) && (line.kind !== 'ctx' || selection?.side === side);
  const waiting = !!pending && pending.path === path && pending.side === lineSide(line) && pending.line === lineNumber(line, pending.side);
  const isCurrent = !!current && current.path === path && current.index === line.index;
  const hit = !!query && line.text.toLocaleLowerCase().includes(query);
  const textColor = line.kind === 'add' || line.kind === 'del' || plain ? t.c.fg : line.kind === 'note' ? t.c.fgMuted : t.c.fgSoft;
  const shift = useAnimatedStyle(() => ({ transform: [{ translateX: -scrollX.value }] }));
  const sign = line.text.slice(0, 1);
  const body = line.text.slice(1) || ' ';
  const code = (
    <AppText variant="monoSmall" color={textColor} numberOfLines={wrap ? undefined : 1} style={{ fontSize: CODE_SIZE, lineHeight: CODE_LINE, paddingRight: 12 }}>
      <AppText variant="monoSmall" color={edge === 'transparent' ? t.c.fgMuted : edge} style={{ fontSize: CODE_SIZE, lineHeight: CODE_LINE }}>{line.kind === 'note' || plain ? '' : `${sign || ' '} `}</AppText>
      <Highlighted text={line.kind === 'note' ? line.text : body} query={query} color={textColor} t={t} />
    </AppText>
  );
  const content = (
    <View style={{ flexDirection: 'row', minHeight: CODE_LINE, backgroundColor: chosen ? t.c.accentSoft : tint }}>
      <View style={{ width: 3, backgroundColor: chosen || waiting ? t.c.primary : edge }} />
      <View style={{ width: gutter - 3, alignItems: 'flex-end', paddingRight: 6, justifyContent: 'flex-start' }}>
        <AppText variant="monoSmall" tone="muted" style={{ fontSize: 11, lineHeight: CODE_LINE }}>{n ?? ''}</AppText>
      </View>
      <View style={{ flex: 1, minWidth: 0, overflow: 'hidden', borderWidth: isCurrent ? 1 : 0, borderColor: t.c.primary, backgroundColor: hit && !chosen ? t.c.hover : undefined }}>
        {wrap ? code : <Animated.View style={[{ width: contentWidth }, shift]}>{code}</Animated.View>}
      </View>
    </View>
  );
  if (!onLine || !isCode(line)) return content;
  return (
    <Press onPress={() => onLine(path, line, false)} onLongPress={() => onLine(path, line, true)} delayLongPress={320} feedback="none"
      accessibilityRole="button" accessibilityLabel={`${plain ? '' : side === 'old' ? '−' : '+'}${n ?? ''} ${body}`} accessibilityHint={translate('review.lineHint')} accessibilityState={{ selected: chosen }}>
      {content}
    </Press>
  );
}

/** The comment for a selection: the lines, a text box and the actions. */
function CommentSheet({ visible, selection, comment, onClose, onDone }: { visible: boolean; selection: Selection; comment: DiffComment; onClose(): void; onDone(): void }) {
  const t = useTheme();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  useFocusWhen(input, visible);
  useEffect(() => { if (visible) setText(''); }, [visible, selection.path, selection.start, selection.end]);
  const submit = async () => {
    setBusy(true);
    try { if (await comment.onSubmit(selection, text.trim())) { haptic.success(); onDone(); } } finally { setBusy(false); }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={gt('addComment')} subtitle={`${selection.path}:${rangeLabel(selection)}`} dismissable={!busy}
      footer={<>
        <Button label={gt('cancel')} onPress={onClose} style={{ flex: 1, maxWidth: 220 }} />
        <Button label={comment.label} kind="primary" busy={busy} disabled={!text.trim()} onPress={() => void submit()} style={{ flex: 1, maxWidth: 220 }} testID="comment-submit" />
      </>}>
      <View style={{ gap: 10 }}>
        <View style={{ maxHeight: 160, borderRadius: t.radius.md, backgroundColor: t.c.code, borderWidth: 1, borderColor: t.c.border, padding: 8 }}>
          <AppText variant="monoSmall" tone="soft" numberOfLines={8}>{selection.text}</AppText>
        </View>
        <TextInput underlineColorAndroid="transparent" ref={input} value={text} onChangeText={setText} multiline placeholder={translate('review.commentPlaceholder')} placeholderTextColor={t.c.fgMuted}
          accessibilityLabel={gt('comment')} selectionColor={t.c.primary} textAlignVertical="top"
          style={{ minHeight: 96, maxHeight: 220, borderWidth: 1, borderColor: t.c.borderStrong, borderRadius: t.radius.md, padding: 10, color: t.c.fg, fontFamily: t.font.regular, fontSize: 15 }} />
        {comment.secondary ? <Button label={comment.secondary.label} icon={MessageCircleQuestion} kind="ghost" size="sm" disabled={!text.trim()} style={{ alignSelf: 'flex-start' }}
          onPress={() => { comment.secondary!.run(selection, text.trim()); onDone(); }} /> : null}
      </View>
    </Sheet>
  );
}
