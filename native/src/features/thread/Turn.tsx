// One turn of the terminal-timeline transcript: the prompt, one work line that folds the
// turn's operations, narration and answers, changed files and failures. What opens by
// itself follows the owner's rules: command output never; a working turn keeps its latest
// work open; a finished turn folds into its work line.
import { memo, useEffect, useMemo, useState, type ComponentType } from 'react';
import { ActivityIndicator, LayoutAnimation, ScrollView, View } from 'react-native';
import type { LucideProps } from 'lucide-react-native';
import { Bot, Brain, ChevronDown, ChevronRight, FileText, FilePen, Pencil, Globe, ListChecks, Search, SquareTerminal, Wrench, X, Sparkles, Image as ImageIcon, Webhook, Bell, Check, Lightbulb, BellRing, Info } from 'lucide-react-native';
import type { ThreadHistoryItemDto } from '@pockymoe/shared';
import type { TimelineHistoryEntry } from '../../../vendor/pockymoe/thread-ui/components/timeline/timelineItems';
import { compactDuration } from '../../../vendor/pockymoe/thread-ui/components/timeline/activity';
import { describeTurnError } from '../../../vendor/pockymoe/thread-ui/components/timeline/turnErrors';
import { AppText } from '../../design/AppText';
import { Press } from '../../design/Press';
import { Sheet } from '../../design/Sheet';
import { StatusMark } from '../../design/StatusMark';
import { CopyButton, MiddleName, PathChip } from '../../design/Copy';
import { useTheme, type Theme } from '../../design/theme';
import { showMenu, showToast } from '../../design/Overlay';
import { Image as ExpoImage } from 'expo-image';
import { ImageViewer } from '../../design/ImageViewer';
import { Copy as CopyIcon, Quote as QuoteIcon, CircleAlert, ChevronUp, File as FileIcon, ImageOff } from 'lucide-react-native';
import { parseQuotedPrompt, type PromptQuote } from '../../../vendor/pockymoe/thread-ui/components/composer/promptQuotes';
import { fileBadge, fileFamily, shortFileName } from '../../../vendor/pockymoe/thread-ui/components/attachments/attachmentFiles';
import { mixColor, withAlpha } from '../../design/contrast';
import { FILE_FAMILY_COLOR, shortModelName } from './turnFormat';
import type { TextStyle } from 'react-native';
import { translate } from '../../i18n';
import { Markdown } from './Markdown';
import { TurnHead } from './TurnHead';
import { Rule } from '../../design/Rule';
import { AgentMark } from '../../design/AgentMark';
import { agentKeyOf, themeAgentName } from '../../../vendor/pockymoe/thread-ui/components/themeAgent';
import { formatDurationSeconds } from '../../../vendor/pockymoe/thread-ui/components/timeline/durationFormatting';
import { entryItems, foldReply, hiddenAmount, itemStatus, promptAttachments, promptPreviewEnd, type Section, type TurnView } from './model';
import type { LocalPrompt } from '../../state/threadDetail';
import { DiffViewer } from '../diff/DiffViewer';
import { parsePatch } from '../diff/model';

export interface TurnActions {
  quote(item: ThreadHistoryItemDto, turnId: string, from: 'assistant' | 'user'): void;
  loadImage(path: string): Promise<string>;
  loadItemDetail(itemId: string): Promise<string>;
  loadTurnItems(turnId: string): Promise<void>;
  /** A finished turn's changes chip: the Git pane on that turn's changes. */
  openFiles(paths: string[], turnId?: string): void;
  retryLocal(clientRequestId: string): void;
  discardLocal(clientRequestId: string): void;
  /** Rewind to before this turn's prompt (Edit from here); absent when not allowed. */
  editFromHere?: (turnId: string) => void;
}

const KIND_ICON: Partial<Record<ThreadHistoryItemDto['kind'], ComponentType<LucideProps>>> = {
  commandExecution: SquareTerminal, fileChange: FilePen, fileRead: FileText, webSearch: Globe, toolCall: Wrench, skillToolCall: Sparkles,
  agentToolCall: Bot, reasoning: Brain, plan: ListChecks, image: ImageIcon, imageView: ImageIcon, hook: Webhook,
};
const PART_ICON: Record<string, ComponentType<LucideProps>> = { commands: SquareTerminal, reads: FileText, searches: Search, agents: Bot, tools: Wrench, reasoning: Brain, failed: X };

function animate() { LayoutAnimation.configureNext({ duration: 220, update: { type: 'easeInEaseOut' }, create: { type: 'easeInEaseOut', property: 'opacity' }, delete: { type: 'easeInEaseOut', property: 'opacity' } }); }

// ---- the message menu (long press): copy, quote into the composer --------------------------------
function messageMenu(item: ThreadHistoryItemDto, turnId: string, from: 'assistant' | 'user', actions: TurnActions, editable = false) {
  showMenu({ items: [
    { label: translate('chat.copy'), icon: CopyIcon, copy: item.text },
    { label: translate('native.quote'), icon: QuoteIcon, onPress: () => actions.quote(item, turnId, from) },
    // Edit from here: rewind to before this prompt once its turn is done (owner devices).
    ...(editable && actions.editFromHere ? [{ label: translate('review.editFromHere'), icon: Pencil, onPress: () => actions.editFromHere!(turnId) }] : []),
  ] });
}

// ---- prompt ------------------------------------------------------------------------------
/** The Web's fold label: "Show all (about 1,000 more characters)" once it hides 200 or more. */
function foldLabel(expanded: boolean, hidden: number) {
  if (expanded) return translate('chat.showLess');
  const amount = hiddenAmount(hidden);
  return amount ? translate('chat.showMoreChars', { count: String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }) : translate('chat.showMore');
}

function Prompt({ item, view, actions, failure }: { item: ThreadHistoryItemDto; view: TurnView; actions: TurnActions; failure?: string | null }) {
  const t = useTheme();
  const local = view.local;
  const quoted = parseQuotedPrompt(item.text);
  const { text: fullText, photos, files } = promptAttachments(quoted ? quoted.body : item.text);
  // Long prompts (pasted logs) fold like the Web's: 600 characters, 160 words or 8 lines, and the
  // preview shows at most 6 lines.
  const [expanded, setExpanded] = useState(false);
  const previewEnd = promptPreviewEnd(fullText);
  const text = previewEnd !== null && !expanded ? `${fullText.slice(0, previewEnd).trimEnd()}…` : fullText;
  const menu = () => messageMenu(item, view.turn.id, 'user', actions, !view.running && !local && view.prompt?.id === item.id);
  const toggle = previewEnd !== null ? (
    <Press onPress={() => { animate(); setExpanded(v => !v); }} feedback="dim" accessibilityRole="button" accessibilityState={{ expanded }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 28, marginTop: 4, paddingHorizontal: 4, alignSelf: 'flex-start', opacity: 0.8 }}>
      {expanded ? <ChevronUp size={14} color={t.c.fgMuted} /> : <ChevronRight size={14} color={t.c.fgMuted} />}
      <AppText variant="caption" weight="medium" tone="muted" style={{ fontSize: 12 }}>{foldLabel(expanded, fullText.length - previewEnd)}</AppText>
    </Press>
  ) : null;
  // The Web's failure mark: the turn's error behind a small round mark after the text.
  const mark = failure ? (
    <Press onPress={() => showErrorDetails(failure)} feedback="dim" accessibilityRole="button" accessibilityLabel={describeTurnError(failure).message}
      style={{ width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' }}>
      <CircleAlert size={14} color={mixColor(t.c.danger, t.c.fgMuted, 0.38, t.c.bg)} />
    </Press>
  ) : null;
  const body = <QuotedText text={text} quotes={quoted?.quotes} style={t.terminal ? { fontFamily: t.font.monoBold, fontWeight: '700', fontSize: 13, lineHeight: 21 } : { fontSize: 15, lineHeight: 25.5 }}
    color={t.terminal ? t.c.fg : t.c.userBubbleFg} numberOfLines={previewEnd !== null && !expanded ? 6 : undefined} />;
  const tiles = photos.length || files.length ? (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: text ? 4 : 0, marginHorizontal: -3 }}>
      {photos.map(path => <AttachmentTile key={path} path={path} photo actions={actions} localUri={local?.attachments.find(a => a.placeholder === `[PHOTO ${path}]`)?.uri} />)}
      {files.map(path => <AttachmentTile key={path} path={path} actions={actions} />)}
    </View>
  ) : null;
  const status = local ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
      {local.state === 'sending' ? <><ActivityIndicator size="small" color={t.c.fgMuted} /><AppText variant="caption" tone="muted">{translate('native.sending')}</AppText></>
        : <>
          <StatusMark status="failed" size={10} />
          <AppText variant="caption" tone="danger" numberOfLines={2} style={{ maxWidth: 220 }}>{local.error ?? translate('native.notSent')}</AppText>
          <AppText variant="caption" tone="accent" onPress={() => actions.retryLocal(local.clientRequestId)} accessibilityRole="button">{translate('chat.retryPrompt')}</AppText>
          <AppText variant="caption" tone="muted" onPress={() => actions.discardLocal(local.clientRequestId)} accessibilityRole="button">{translate('native.discard')}</AppText>
        </>}
    </View>
  ) : null;
  if (t.terminal) {
    // Terminal: no bubble; the prompt in bold behind a ❯ gutter.
    return (
      <View style={{ flexDirection: 'row', marginTop: 4, marginBottom: 4 }}>
        <AppText variant="mono" weight="bold" color={t.c.primary} style={{ width: 22, fontSize: 13, lineHeight: 21 }}>❯</AppText>
        <Press onLongPress={menu} feedback="none" style={{ flex: 1 }} accessibilityHint={translate('native.messageMenuHint')}>
          {text ? body : null}
          {tiles}
          {toggle}
          {mark}
          {status}
        </Press>
      </View>
    );
  }
  return (
    <View style={{ alignItems: 'flex-end', marginTop: 4, marginBottom: 4 }}>
      {item.sender ? <AppText variant="caption" tone="muted" style={{ marginBottom: 3, fontSize: 10, opacity: 0.65 }}>{item.sender.name ?? item.sender.userId.slice(0, 8)}</AppText> : null}
      <Press onLongPress={menu} feedback="none" accessibilityHint={translate('native.messageMenuHint')}
        style={{ maxWidth: '88%', backgroundColor: t.c.userBubble, paddingHorizontal: t.plum ? 15 : 16, paddingVertical: t.plum ? 11 : 12.5, opacity: local?.state === 'sending' ? 0.75 : 1,
          borderRadius: 20, ...(t.plum ? { borderRadius: 18, borderBottomRightRadius: 6, shadowColor: t.c.fg, shadowOpacity: 0.08, shadowRadius: 0, shadowOffset: { width: 0, height: 1 } } : null) }}>
        {text ? body : null}
        {tiles}
        {toggle}
        {mark}
      </Press>
      {status}
    </View>
  );
}

/** Prompt text whose `[QUOTE n]` markers read as small quote tiles (the Web's quote marks);
 *  a tile shows the quoted text. */
function QuotedText({ text, quotes, style, color, numberOfLines }: { text: string; quotes?: Map<number, PromptQuote>; style: TextStyle; color: string; numberOfLines?: number }) {
  const t = useTheme();
  const parts = text.split(/(\[QUOTE \d+\])/g);
  return (
    <AppText variant="body" color={color} style={style} numberOfLines={numberOfLines}>
      {parts.map((part, i) => {
        const n = /^\[QUOTE (\d+)\]$/.exec(part)?.[1];
        if (!n) return part;
        const quote = quotes?.get(Number(n));
        return (
          <AppText key={i} variant="caption" weight="semibold" color={t.c.fg} onPress={quote ? () => showToast(quote.path ? `${quote.path}:${quote.startLine}` : quote.text.slice(0, 200), 'info') : undefined}
            style={{ fontSize: 12, backgroundColor: withAlpha(t.c.primary, 0.1) }}>{` ❝ ${n} `}</AppText>
        );
      })}
    </AppText>
  );
}

/** An attachment as the Web's tile (attachments.css): a 78 × 66 card with a photo or a file
 *  glyph and its type badge, and the name shortened in the middle. A photo opens full screen. */
function AttachmentTile({ path, photo = false, actions, localUri }: { path: string; photo?: boolean; actions: TurnActions; localUri?: string }) {
  const t = useTheme();
  const name = path.split('/').pop() ?? path;
  const [uri, setUri] = useState<string | null>(localUri ?? null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [viewing, setViewing] = useState(false);
  // A photo that cannot be loaded says so and loads again on a tap, instead of spinning (D16).
  useEffect(() => {
    if (!photo || localUri) return;
    let live = true; setFailed(false);
    actions.loadImage(path).then(u => { if (live) setUri(u); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [path, photo, actions, localUri, attempt]);
  const family = fileFamily(name, photo ? 'photo' : 'file');
  const badge = fileBadge(name);
  return (
    <>
      <Press onPress={photo ? () => (failed ? setAttempt(n => n + 1) : uri && setViewing(true)) : () => showToast(path, 'info')} feedback="dim" accessibilityRole={photo ? 'imagebutton' : 'button'}
        accessibilityLabel={failed ? `${name}, ${translate('native.imageFailed')}` : name} accessibilityHint={failed ? translate('common.retry') : undefined}
        style={{ width: 78, height: 66, margin: 3, paddingTop: 5, paddingHorizontal: 5, paddingBottom: 4, gap: 3, alignItems: 'center', borderWidth: 1, borderColor: t.c.border, borderRadius: t.terminal ? 0 : 10, backgroundColor: t.c.surface }}>
        <View style={{ width: '100%', height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: t.terminal ? 0 : 6, overflow: 'hidden' }}>
          {photo ? (uri ? <ExpoImage source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : failed ? <ImageOff size={22} color={t.c.fgMuted} /> : <ActivityIndicator size="small" color={t.c.fgMuted} />) : (
            <View style={{ width: 28, height: 34 }}>
              <FileIcon size={34} strokeWidth={1.3} color={t.c.fgMuted} style={{ position: 'absolute', left: -3 }} />
              {badge ? <View style={{ position: 'absolute', bottom: 4, alignSelf: 'center', paddingHorizontal: 3, borderRadius: 3, backgroundColor: FILE_FAMILY_COLOR[family] ?? FILE_FAMILY_COLOR.other }}>
                <AppText variant="caption" weight="bold" color="#fff" style={{ fontSize: 7.5, lineHeight: 11 }} maxFontSizeMultiplier={1}>{badge}</AppText>
              </View> : null}
            </View>
          )}
        </View>
        {!photo ? <AppText variant="caption" tone="soft" numberOfLines={1} style={{ fontSize: 10, letterSpacing: -0.1 }} maxFontSizeMultiplier={1.2}>{shortFileName(name)}</AppText> : null}
      </Press>
      {viewing ? <ImageViewer uri={uri} name={name} onClose={() => setViewing(false)} /> : null}
    </>
  );
}

function showErrorDetails(error: string) {
  const { message, detail } = describeTurnError(error);
  showToast(detail ? `${message}\n${detail}` : message, 'error');
}

// ---- work rows -----------------------------------------------------------------------------
function OutputSheet({ item, onClose, actions }: { item: ThreadHistoryItemDto | null; onClose: () => void; actions: TurnActions }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!item) return;
    setText(item.detailText ?? null); setError(null);
    if (item.detailText && !item.hasDeferredDetail) return;
    let live = true;
    actions.loadItemDetail(item.id).then(value => { if (live) setText(value); }, e => { if (live) setError(String(e?.message ?? e)); });
    return () => { live = false; };
  }, [item, actions]);
  const t = useTheme();
  // A file change's detail is a patch: show it in the Git panel's coloured diff viewer (D9).
  const patch = useMemo(() => {
    if (!text || item?.kind !== 'fileChange' || !text.includes('@@')) return null;
    const parsed = parsePatch(text);
    return parsed.files.length ? parsed : null;
  }, [text, item?.kind]);
  return (
    <Sheet visible={!!item} onClose={onClose} title={item ? itemTitle(item) : ''} subtitle={item?.status ?? null} tall scroll={false}>
      <View style={{ flex: 1, paddingHorizontal: 12 }}>
        {text === null && !error ? <ActivityIndicator style={{ marginTop: 24 }} color={t.c.primary} /> : null}
        {error ? <AppText tone="danger">{error}</AppText> : null}
        {text !== null && patch ? (
          <View style={{ flex: 1, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.c.border, overflow: 'hidden' }}>
            <DiffViewer patch={text} parsed={patch} single={patch.files.length === 1} hideFileHeading={patch.files.length === 1} copyValue={text} />
          </View>
        ) : text !== null ? (
          <View style={{ flex: 1, backgroundColor: t.c.code, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.c.border }}>
            <View style={{ alignItems: 'flex-end' }}><CopyButton value={text} /></View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: 16 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <AppText variant="monoSmall" selectable>{text || translate('native.noOutput')}</AppText>
              </ScrollView>
            </ScrollView>
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}

export function itemTitle(item: ThreadHistoryItemDto) {
  const text = (item.previewText || item.text || '').trim().split('\n')[0] ?? '';
  return text.replace(/^\/bin\/(ba)?sh -lc ["']?/, '').replace(/["']$/, '') || item.kind;
}

function ItemRow({ item, onOpen, depth = 0 }: { item: ThreadHistoryItemDto; onOpen: (item: ThreadHistoryItemDto) => void; depth?: number }) {
  const t = useTheme();
  const status = itemStatus(item);
  const Icon = KIND_ICON[item.kind] ?? Wrench;
  const mono = item.kind === 'commandExecution';
  const changes = item.kind === 'fileChange' && (item.addedLines || item.removedLines);
  return (
    <Press onPress={() => onOpen(item)} feedback="wash" accessibilityRole="button" accessibilityLabel={`${itemTitle(item)}, ${status}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32, paddingVertical: 4, paddingLeft: 4 + depth * 14, paddingRight: 6, borderRadius: t.radius.sm }}>
      {status === 'running' ? <StatusMark status="running" size={11} /> : status === 'failed' ? <StatusMark status="failed" size={11} /> : <Icon size={14} color={t.c.fgMuted} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        {mono ? <AppText variant="monoSmall" tone="soft" numberOfLines={1}>{t.terminal ? `$ ${itemTitle(item)}` : itemTitle(item)}</AppText>
          : <MiddleName text={itemTitle(item)} variant="subhead" max={64} />}
      </View>
      {changes ? <AppText variant="caption"><AppText variant="caption" tone="success">{`+${item.addedLines ?? 0}`}</AppText>{' '}<AppText variant="caption" tone="danger">{`−${item.removedLines ?? 0}`}</AppText></AppText> : null}
    </Press>
  );
}

const GROUP_LABEL: Record<string, (n: number) => string> = {
  commandGroup: n => translate('chat.commandCount', { count: n }),
  fileChangeGroup: n => translate('chat.logEdits', { count: n }),
  fileReadGroup: n => translate('chat.readFileCount', { count: n }),
  searchGroup: n => translate('chat.logSearches', { count: n }),
  toolCallGroup: n => translate('chat.logTools', { count: n }),
  skillToolCallGroup: n => translate('chat.logTools', { count: n }),
  agentToolCallGroup: n => translate('chat.logAgents', { count: n }),
};

function ImageItem({ path, actions, size = 'large', localUri }: { path: string; actions: TurnActions; size?: 'small' | 'medium' | 'large'; localUri?: string }) {
  const t = useTheme();
  const [uri, setUri] = useState<string | null>(localUri ?? null);
  const [failed, setFailed] = useState(false);
  const [viewing, setViewing] = useState(false);
  useEffect(() => { if (localUri) return; let live = true; actions.loadImage(path).then(u => { if (live) setUri(u); }, () => { if (live) setFailed(true); }); return () => { live = false; }; }, [path, actions, localUri]);
  const name = path.split('/').pop() ?? path;
  if (failed) return <Row icon={ImageIcon} text={name} />;
  return (
    <>
      <Press onPress={() => uri && setViewing(true)} disabled={!uri} feedback="dim" accessibilityRole="imagebutton" accessibilityLabel={name} accessibilityHint={translate('native.imageOpenHint')}
        style={{ marginVertical: size === 'large' ? 6 : 0, width: size === 'small' ? 96 : size === 'medium' ? 180 : 220, height: size === 'small' ? 96 : size === 'medium' ? 135 : 160, borderRadius: t.radius.md, overflow: 'hidden', backgroundColor: t.c.surface, borderWidth: 1, borderColor: t.c.border }}>
        {uri ? <ExpoImage source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : <ActivityIndicator style={{ flex: 1 }} color={t.c.fgMuted} />}
      </Press>
      {viewing ? <ImageViewer uri={uri} name={name} onClose={() => setViewing(false)} /> : null}
    </>
  );
}

function Entry({ entry, open: initiallyOpen, onOpen, actions }: { entry: TimelineHistoryEntry; open: boolean; onOpen: (item: ThreadHistoryItemDto) => void; actions: TurnActions }) {
  const t = useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  useEffect(() => { setOpen(initiallyOpen); }, [initiallyOpen]);
  if (entry.kind === 'item') {
    const item = entry.item;
    if (item.kind === 'reasoning') return <Thought item={item} />;
    if (item.kind === 'plan') return <Plan item={item} />;
    if ((item.kind === 'image' || item.kind === 'imageView') && item.assetPath) return <ImageItem path={item.assetPath} actions={actions} />;
    if (item.origin === 'nativeTaskNotification') return <Row icon={Bell} text={translate('native.wokenUp')} />;
    // Narration between operations reads as text, not as a tool row.
    if (item.kind === 'agentMessage') return <Narration item={item} />;
    return <ItemRow item={item} onOpen={onOpen} />;
  }
  if (entry.kind === 'agentActivityGroup') return <>{entry.entries.map(e => <Entry key={e.key} entry={e} open={initiallyOpen} onOpen={onOpen} actions={actions} />)}</>;
  const items = entry.items;
  const failed = items.filter(i => itemStatus(i) === 'failed').length;
  const running = items.some(i => itemStatus(i) === 'running');
  const Icon = KIND_ICON[items[0]!.kind] ?? Wrench;
  return (
    <View>
      <Press onPress={() => { animate(); setOpen(v => !v); }} accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32, paddingHorizontal: 4, borderRadius: t.radius.sm }}>
        {running ? <StatusMark status="running" size={11} /> : <Icon size={14} color={t.c.fgMuted} />}
        <AppText variant="subhead" tone="soft" style={{ flex: 1 }} numberOfLines={1}>{GROUP_LABEL[entry.kind]?.(items.length) ?? `${items.length}`}</AppText>
        {failed ? <AppText variant="caption" tone="danger">{translate('chat.logFailed', { count: failed })}</AppText> : null}
        {open ? <ChevronDown size={15} color={t.c.fgMuted} /> : <ChevronRight size={15} color={t.c.fgMuted} />}
      </Press>
      {open ? items.map(item => <ItemRow key={item.id} item={item} onOpen={onOpen} depth={1} />) : null}
    </View>
  );
}

function Row({ icon: Icon, text }: { icon: ComponentType<LucideProps>; text: string }) {
  const t = useTheme();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28, paddingHorizontal: 4 }}><Icon size={14} color={t.c.fgMuted} /><AppText variant="subhead" tone="muted">{text}</AppText></View>;
}

function Thought({ item }: { item: ThreadHistoryItemDto }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const first = item.text.split('\n').find(l => l.trim())?.replace(/\*\*/g, '').replace(/^#+\s*/, '') ?? '';
  return (
    <View>
      <Press onPress={() => { animate(); setOpen(v => !v); }} accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 30, paddingHorizontal: 4, borderRadius: t.radius.sm }}>
        <Brain size={14} color={t.c.fgMuted} />
        <AppText variant="subhead" tone="muted" style={{ flex: 1, fontStyle: 'italic' }} numberOfLines={1}>{first}</AppText>
      </Press>
      {open ? <View style={{ paddingLeft: 26, paddingBottom: 6 }}><AppText variant="footnote" tone="soft" selectable>{item.text}</AppText></View> : null}
    </View>
  );
}

function Narration({ item }: { item: ThreadHistoryItemDto }) {
  const [open, setOpen] = useState(false);
  const long = item.text.length > 240;
  return (
    <Press onPress={long ? () => { animate(); setOpen(v => !v); } : undefined} feedback="none" style={{ paddingHorizontal: 4, paddingVertical: 4 }} accessibilityRole={long ? 'button' : undefined}>
      <AppText variant="subhead" tone="soft" numberOfLines={open ? undefined : 3} selectable={!long}>{item.text}</AppText>
    </Press>
  );
}

function Plan({ item }: { item: ThreadHistoryItemDto }) {
  const lines = item.text.split('\n').filter(l => l.trim());
  return (
    <View style={{ paddingHorizontal: 4, paddingVertical: 4, gap: 2 }}>
      <Row icon={ListChecks} text={translate('native.plan')} />
      {lines.map((line, i) => <AppText key={i} variant="footnote" tone="soft" style={{ paddingLeft: 22 }}>{line}</AppText>)}
    </View>
  );
}

// ---- answers ---------------------------------------------------------------------------------
function Answer({ item, muted, agent, onLongPress }: { item: ThreadHistoryItemDto; muted?: boolean; agent?: React.ReactNode; onLongPress?: () => void }) {
  const t = useTheme();
  const folded = foldReply(item.text);
  const [expanded, setExpanded] = useState(false);
  const text = folded && !expanded ? folded : item.text;
  return (
    <View style={{ marginVertical: 4, flexDirection: t.terminal ? 'row' : 'column', gap: t.terminal ? 8 : 0, paddingHorizontal: t.terminal ? 0 : 0 }}>
      {t.terminal ? <AppText variant="mono" tone="accent">●</AppText> : agent}
      <Press onLongPress={onLongPress} feedback="none" style={{ flex: t.terminal ? 1 : undefined, opacity: muted ? 0.82 : 1 }} accessibilityHint={onLongPress ? translate('native.messageMenuHint') : undefined}>
        <Markdown text={text} />
        {folded ? <AppText variant="subhead" tone="accent" onPress={() => { animate(); setExpanded(v => !v); }} accessibilityRole="button" style={{ marginTop: 2 }}>
          {foldLabel(expanded, item.text.length - folded.length)}</AppText> : null}
      </Press>
    </View>
  );
}

// ---- the turn ---------------------------------------------------------------------------------
export const Turn = memo(function Turn({ view, actions, agent, now }: { view: TurnView; actions: TurnActions; agent?: React.ReactNode; now: number }) {
  const t = useTheme();
  const [open, setOpen] = useState(view.running);
  const [opened, setOpened] = useState<ThreadHistoryItemDto | null>(null);
  const [loadingDeferred, setLoadingDeferred] = useState(false);
  // A working turn is open; when it finishes it folds into its work line.
  useEffect(() => { if (!view.running) { animate(); setOpen(false); } else setOpen(true); }, [view.running]);
  const lastWork = [...view.sections].reverse().find(s => s.kind === 'work')?.key;
  const answers = view.sections.filter((s): s is Extract<Section, { kind: 'answer' }> => s.kind === 'answer');
  // The work line opens only when something is folded away (the Web's canToggleWorkedSummary):
  // operations, or narration beyond the one line a turn without an answer shows.
  const narrations = view.sections.filter(s => s.kind === 'narration').length;
  const hasWork = view.sections.some(s => s.kind === 'work') || narrations > (answers.length ? 0 : 1) || answers.length > 1 || view.deferred;
  // A turn that ended without recording anything still opens, to say so and why (the Web's empty note).
  const recordedNothing = !view.running && !view.local && !view.sections.length && !view.parts.length && !view.deferred;
  const toggle = async () => {
    animate(); const next = !open; setOpen(next);
    if (next && view.deferred && !loadingDeferred) { setLoadingDeferred(true); await actions.loadTurnItems(view.turn.id).catch(e => showToast(String((e as Error)?.message ?? e), 'error')); setLoadingDeferred(false); }
  };
  const duration = view.running ? (Date.parse(view.turn.startedAt ?? '') ? now - Date.parse(view.turn.startedAt!) : null) : view.durationMs;
  // A failed turn with a prompt carries the error as a mark in the prompt; an empty one says it in its note.
  const failure = view.status === 'failed' && view.turn.error && !view.local && !recordedNothing ? view.turn.error : null;
  return (
    <View style={{ paddingHorizontal: 9, paddingVertical: 10 }}>
      {!view.local ? <TurnHead turn={view.turn} status={view.status} now={now} /> : null}
      {view.prompt ? <Prompt item={view.prompt} view={view} actions={actions} failure={failure} /> : null}
      {view.steers.map(s => <Prompt key={s.id} item={s} view={{ ...view, local: undefined }} actions={actions} />)}
      {!view.local && !view.running ? (
        <WorkLine view={view} open={open} canOpen={hasWork || recordedNothing} onToggle={() => void toggle()} durationMs={duration} loading={loadingDeferred} t={t}
          onFiles={() => actions.openFiles(view.files.map(f => f.path), view.turn.id)} />
      ) : view.running && hasWork ? (
        <WorkLine view={view} open={open} canOpen onToggle={() => void toggle()} durationMs={duration} loading={loadingDeferred} t={t}
          onFiles={() => actions.openFiles(view.files.map(f => f.path), view.turn.id)} />
      ) : null}
      {open && recordedNothing ? <EmptyNote error={view.turn.error} /> : null}
      {open && !recordedNothing ? (
        <View style={t.plum
          ? { marginTop: 2, marginBottom: 10, paddingVertical: 6, paddingHorizontal: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.c.border, borderRadius: 14, backgroundColor: t.mode === 'dark' ? '#21142a' : '#fffdf8' }
          : { borderLeftWidth: 1, borderLeftColor: t.terminal ? t.c.border : t.c.border, marginLeft: 4, paddingLeft: 10, marginTop: 2, marginBottom: 6 }}>
          {view.sections.map(section => section.kind === 'work'
            ? section.entries.map(entry => <Entry key={entry.key} entry={entry} open={view.running && section.key === lastWork} onOpen={setOpened} actions={actions} />)
            : section.kind === 'narration' ? <Answer key={section.key} item={section.item} muted /> : null)}
        </View>
      ) : null}
      {(open ? answers : answers.slice(-1)).map((s, i) => <Answer key={s.key} item={s.item} agent={i === 0 ? agent : undefined} onLongPress={() => messageMenu(s.item, view.turn.id, 'assistant', actions)} />)}
      {!open && !answers.length ? view.sections.filter((s): s is Extract<Section, { kind: 'narration' }> => s.kind === 'narration').slice(-1).map(s => <Answer key={s.key} item={s.item} />) : null}
      {view.switchAfter ? <HarnessSwitchDivider entry={view.switchAfter} /> : null}
      <OutputSheet item={opened} onClose={() => setOpened(null)} actions={actions} />
    </View>
  );
});

/** "Nothing was recorded in this turn." and why, with the original error folded (the Web's
 *  empty note with its TurnFailureNote). */
function EmptyNote({ error }: { error: string | null }) {
  const t = useTheme();
  const [raw, setRaw] = useState(false);
  const described = error ? describeTurnError(error) : null;
  return (
    <View style={{ marginLeft: 24, marginBottom: 4, paddingVertical: 8, paddingHorizontal: 10, borderLeftWidth: 2, borderLeftColor: error ? '#d56b62' : t.c.border, gap: 6 }}>
      <AppText variant="footnote" tone="muted">{translate('chat.turnRecordedNothing')}</AppText>
      {described ? <AppText variant="footnote">{described.message}</AppText> : null}
      {described?.detail ? (
        <>
          <Press onPress={() => setRaw(v => !v)} feedback="dim" accessibilityRole="button" accessibilityState={{ expanded: raw }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, alignSelf: 'flex-start' }}>
            <ChevronRight size={13} color={t.c.fgMuted} style={{ transform: [{ rotate: raw ? '90deg' : '0deg' }] }} />
            <AppText variant="caption" tone="muted">{translate('chat.rawError')}</AppText>
          </Press>
          {raw ? <AppText variant="monoSmall" tone="muted" numberOfLines={6} style={{ padding: 8, borderRadius: 6, backgroundColor: t.c.surface, fontSize: 11 }} selectable>{described.detail}</AppText> : null}
        </>
      ) : null}
    </View>
  );
}

/** A switch of the thread's agent between two turns (the Web's HarnessSwitchDivider):
 *  "Codex · 5.4 → ACP · Claude · sonnet 4.5 · 2 turns handed over", with the details on a tap. */
function HarnessSwitchDivider({ entry }: { entry: ThreadHistoryItemDto }) {
  const t = useTheme();
  const change = entry.harnessSwitch;
  if (!change) return null;
  const from = change.fromAgentId ? agentKeyOf(change.fromAgentId, change.fromHarnessProtocol) : null;
  const to = change.agentId ? agentKeyOf(change.agentId, change.harnessProtocol) : null;
  if (!from || !to) return null;
  const label = (agent: string, model?: string | null) => [themeAgentName(agent), model].filter(Boolean).join(' · ');
  const fromLabel = label(from, change.fromModel);
  const toLabel = label(to, change.model);
  const count = change.fromAgentId !== change.agentId ? translate('chat.handoffTurnCount', { count: change.turns ?? 0 }) : null;
  const full = [translate('chat.switchedHarness', { from: fromLabel, to: toLabel }), count].filter(Boolean).join(' · ');
  return (
    <Press onPress={() => showToast(`${full}\n${translate('chat.handoffSettingsReset')}`, 'info')} feedback="dim" accessibilityRole="button" accessibilityLabel={full} accessibilityHint={translate('chat.handoffDetails')}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 12, paddingVertical: 4, borderTopWidth: 1, borderBottomWidth: 1, borderColor: t.c.border }}>
      <View style={{ flexShrink: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <View style={{ flexShrink: 1, minWidth: 0 }}><MiddleName text={fromLabel} variant="caption" max={22} /></View>
        <AppText variant="caption" tone="muted">→</AppText>
        <View style={{ flexShrink: 1, minWidth: 0 }}><MiddleName text={toLabel} variant="caption" max={22} /></View>
        {count ? <AppText variant="caption" tone="muted" numberOfLines={1}>{`· ${count}`}</AppText> : null}
      </View>
      <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}><Info size={14} color={t.c.fgMuted} /></View>
    </Press>
  );
}

const COUNT_ICON: Record<string, ComponentType<LucideProps>> = { commands: Check, failed: X, reads: FileText, searches: Search, agents: Bot, tools: Wrench, reasoning: Lightbulb, wakes: BellRing };

/** The Web's work line: "Worked for 42s", "Interrupted", the operation counts as icons with
 *  numbers, "±N" for the changed files (it opens them) and a dashed rule; a turn that ran
 *  nothing shows the time alone. Plum Pocket leads with the agent's avatar and name. */
function WorkLine({ view, open, canOpen, onToggle, onFiles, durationMs, loading, t }: { view: TurnView; open: boolean; canOpen: boolean; onToggle: () => void; onFiles: () => void; durationMs: number | null; loading: boolean; t: Theme }) {
  const label = view.running ? translate('chat.working') : durationMs != null ? translate('chat.workedFor', { duration: formatDurationSeconds(Math.floor(durationMs / 1000), { pad: false }) }) : translate('native.worked');
  const counted = view.parts.filter(p => p.count !== undefined && COUNT_ICON[p.key]);
  const edits = view.parts.some(p => p.key === 'edits') ? view.files.length || 1 : 0;
  const plain = !counted.length && !edits;
  const failedColor = t.mode === 'dark' ? '#f0847f' : '#b3302c';
  const agentKey = view.turn.agentId ? agentKeyOf(view.turn.agentId, null) : view.turn.provider ?? null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap', gap: 6, minHeight: t.plum ? 34 : 28, paddingVertical: 2 }}>
      {t.plum && agentKey ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 4 }}>
        <AgentMark agent={agentKey} size={28} />
        <AppText variant="subhead" weight="semibold" style={{ fontFamily: t.font.display, fontSize: 15 }}>{themeAgentName(agentKey)}</AppText>
      </View> : null}
      <Press onPress={canOpen ? onToggle : undefined} disabled={!canOpen} feedback="none" accessibilityRole={canOpen ? 'button' : undefined} accessibilityState={canOpen ? { expanded: open } : undefined}
        accessibilityLabel={[label, view.status === 'interrupted' ? translate('chat.interrupted') : null, ...view.parts.map(p => p.text)].filter(Boolean).join(', ')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: t.plum ? 44 : 28, flexShrink: 1 }}>
        {canOpen ? <ChevronRight size={t.terminal ? 12 : 14} color={t.c.fgMuted} style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} /> : null}
        {view.running ? <StatusMark status="running" size={11} /> : null}
        <AppText variant="caption" weight={t.terminal ? 'bold' : 'medium'} numberOfLines={1}
          color={t.terminal ? t.c.fg : plain && !canOpen ? t.c.fgMuted : view.running ? t.c.accentStrong : t.c.fgSoft} style={{ fontSize: t.plum ? 12.5 : 12, ...(t.terminal ? { fontFamily: t.font.monoBold, fontWeight: '700' } : null) }}>
          {view.running && durationMs ? `${label} ${compactDuration(durationMs)}` : label}</AppText>
        {view.status === 'interrupted' ? (t.plum
          ? <View style={{ height: 20, paddingHorizontal: 8, borderRadius: 10, justifyContent: 'center', backgroundColor: t.mode === 'dark' ? '#4a2234' : '#fde3ea' }}>
              <AppText variant="caption" weight="bold" color={t.mode === 'dark' ? '#f8a9c4' : '#9c3456'} style={{ fontSize: 11 }}>{translate('chat.interrupted')}</AppText></View>
          : <AppText variant="caption" color={mixColor(t.c.fgMuted, '#f59e0b', 0.18, t.c.bg)} style={{ fontSize: 11 }}>{translate('chat.interrupted')}</AppText>) : null}
        {counted.length ? <AppText variant="caption" tone="muted" style={{ fontSize: 12 }}>·</AppText> : null}
        {counted.map(part => {
          const Icon = COUNT_ICON[part.key]!;
          const failed = part.key === 'failed';
          return (
            <View key={part.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: failed ? -1 : 2 }}>
              {part.key === 'commands' ? <SquareTerminal size={12} color={t.c.fgMuted} style={{ opacity: 0.6, marginRight: 2 }} /> : null}
              <Icon size={12} strokeWidth={failed ? 2.5 : 2} color={failed ? failedColor : t.c.fgMuted} style={{ opacity: failed ? 1 : 0.75 }} />
              <AppText variant="caption" tone="muted" style={{ fontSize: 12, fontVariant: ['tabular-nums'] }}>{part.count}</AppText>
            </View>
          );
        })}
        {loading ? <ActivityIndicator size="small" color={t.c.fgMuted} /> : null}
      </Press>
      {edits ? (
        // A 44 pt target around the small "±N" (D14).
        <Press onPress={onFiles} feedback="dim" accessibilityRole="button" accessibilityLabel={translate('chat.logEdits', { count: edits })}
          hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }} style={{ minHeight: 28, justifyContent: 'center', paddingHorizontal: 4 }}>
          <AppText variant="caption" tone="soft" style={{ fontSize: 12, textDecorationLine: 'underline', textDecorationStyle: 'dotted' }}>{`±${edits}`}</AppText>
        </Press>
      ) : null}
      {!plain ? <Rule color={withAlpha(t.terminal ? (t.mode === 'dark' ? '#5b6560' : '#6a6a65') : t.c.fgMuted, 0.45)} dashed style={{ flex: 1, minWidth: 16 }} /> : null}
    </View>
  );
}

/** The live line under a working turn, as the Web's turn footer: the progress dots, the bell,
 *  the model, and the time it has run at the end. Static (no shimmer, §6). */
export function WorkingLine({ view, now, trailing }: { view: TurnView; now: number; trailing?: React.ReactNode }) {
  const t = useTheme();
  const start = Date.parse(view.turn.startedAt ?? '');
  const elapsed = Number.isFinite(start) ? formatDurationSeconds(Math.max(0, Math.floor((now - start) / 1000))) : null;
  const model = view.turn.model ? shortModelName(view.turn.model) : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 9, paddingVertical: 6 }} accessibilityLiveRegion="polite"
      accessibilityLabel={[translate('native.working'), elapsed].filter(Boolean).join(', ')}>
      <View style={{ flexDirection: 'row', gap: 3 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {[0, 1, 2].map(i => <View key={i} style={{ width: 7, height: 7, borderRadius: t.terminal ? 0 : 3.5, borderWidth: 1.5, borderColor: t.c.fgMuted }} />)}
      </View>
      {trailing}
      {model ? <AppText variant="caption" tone="muted" numberOfLines={1} style={{ fontSize: 12, flexShrink: 1 }}>{model}</AppText> : null}
      <View style={{ flex: 1 }} />
      {elapsed ? <AppText variant="caption" tone="muted" style={{ fontSize: 12, fontVariant: ['tabular-nums'] }}>{elapsed}</AppText> : null}
    </View>
  );
}
