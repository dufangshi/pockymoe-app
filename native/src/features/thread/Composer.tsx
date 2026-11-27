// The composer: text, attachments (photos, camera, files), quotes, model and effort, the
// harness, and Send / Stop / queue. The draft survives navigation and restarts; a list
// row shows "Draft: …" while one exists (§4: unsaved input is visible).
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import { ArrowUp, Camera, FileText, FileUp, ImagePlus, Paperclip, Plus, Quote, SendHorizontal, X, Clock3 } from 'lucide-react-native';
import type { ThreadContextUsageDto, ModelOptionDto, ThreadDto } from '@pockymoe/shared';
import { AppText } from '../../design/AppText';
import { IconButton } from '../../design/Button';
import { Press } from '../../design/Press';
import { ImageViewer } from '../../design/ImageViewer';
import { ContextMeter } from './ContextMeter';
import { useKeyCommand } from '../../platform/keyCommands';
import { ComposerPeek } from '../../design/AgentAvatar';
import { mixColor, withAlpha } from '../../design/contrast';
import { effortColor, orderedEfforts, plumEffortColor } from './effortModel';
import { useModelOptions } from './modelOptions';
import { showMenu, showToast } from '../../design/Overlay';
import { useTheme } from '../../design/theme';
import { haptic } from '../../design/haptics';
import { translate } from '../../i18n';
import { prefs } from '../../platform/prefs';
import { createStore } from '../../state/store';
import type { DeviceApi, PromptAttachment } from '../../protocol/api';
import { effortLabel, ModelPicker, type AgentChoice, type Anchor, type ModelChoice } from './ModelPicker';
import { clipQuote, composeQuotedPrompt, quotePlaceholder, type PromptQuote } from '../../../vendor/pockymoe/thread-ui/components/composer/promptQuotes';
import { attachmentPlaceholder } from './placeholder';

export interface QuoteDraft {
  id: string; text: string; from: 'assistant' | 'user'; turnId: string | null; itemId: string | null;
  /** A review comment on file lines (a diff or a file): path, range and what to change. */
  path?: string; startLine?: number; endLine?: number; comment?: string;
}
interface Draft { text: string; attachments: PromptAttachment[]; quotes: QuoteDraft[] }
const DRAFT_PREFIX = 'pockymoe-native.draft:';
/** Drafts by thread key; text is persisted, attachments live in memory like the Web. */
export const draftStore = createStore<Record<string, Draft>>({});
export function readDraft(key: string): Draft {
  return draftStore.get()[key] ?? { text: prefs.get(DRAFT_PREFIX + key) ?? '', attachments: [], quotes: [] };
}
export function writeDraft(key: string, draft: Draft) {
  draftStore.set({ [key]: draft });
  prefs.set(DRAFT_PREFIX + key, draft.text.trim() ? draft.text : null);
}
export function addQuote(key: string, quote: QuoteDraft) {
  const draft = readDraft(key);
  writeDraft(key, { ...draft, quotes: [...draft.quotes.filter(q => q.id !== quote.id), quote] });
}
export const draftPreview = (key: string) => (draftStore.get()[key]?.text ?? prefs.get(DRAFT_PREFIX + key) ?? '').trim();

export interface ComposerProps {
  draftKey: string;
  api: DeviceApi;
  threadId: string | null;
  agent: AgentChoice;
  agents?: ModelOptionDto[];
  model: ModelChoice;
  onModel: (v: ModelChoice) => void;
  /** The reader may move the thread to another agent (owner; false on shared devices). */
  canSwitch?: boolean;
  /** The thread's workspace path, for agents whose model lists depend on it. */
  cwd?: string | null;
  onSwitched?: (thread: ThreadDto) => void;
  running: boolean;
  disabled?: boolean;
  placeholder?: string;
  onSend: (text: string, attachments: PromptAttachment[]) => Promise<boolean>;
  onStop?: () => void;
  /** The thread's context use, shown as a ring by the send button. */
  contextUsage?: ThreadContextUsageDto | null;
  onCompact?: () => Promise<void>;
  /** Extra chips before the model chip (workspace for a new thread). */
  leading?: React.ReactNode;
  /** The phone dock row under the input. */
  dock?: React.ReactNode;
  autoFocus?: boolean;
}

export function Composer({ draftKey, api, threadId, agent, agents, canSwitch, cwd, onSwitched, model, onModel, running, disabled, placeholder, onSend, onStop, leading, dock, autoFocus, contextUsage, onCompact }: ComposerProps) {
  const t = useTheme();
  const [draft, setDraft] = useState<Draft>(() => readDraft(draftKey));
  const [picker, setPicker] = useState(false);
  // Wide windows open the picker as a popover above the model key.
  const modelKey = useRef<ComponentRef<typeof View>>(null);
  const [pickerAnchor, setPickerAnchor] = useState<Anchor | null>(null);
  const openPicker = () => {
    const node = modelKey.current;
    if (!node) { setPicker(true); return; }
    node.measureInWindow((x, y, width, height) => { setPickerAnchor(width ? { x, y, width, height } : null); setPicker(true); });
  };
  const [sending, setSending] = useState(false);
  const [viewing, setViewing] = useState<PromptAttachment | null>(null);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  useEffect(() => { setDraft(readDraft(draftKey)); }, [draftKey]);
  useEffect(() => draftStore.subscribe(() => { const next = draftStore.get()[draftKey]; if (next) setDraft(next); }), [draftKey]);
  const update = (next: Partial<Draft>) => { const merged = { ...draft, ...next }; setDraft(merged); writeDraft(draftKey, merged); };

  // All picked files in one update, from the draft as it is now (the pickers are async).
  const addAttachments = (picked: Omit<PromptAttachment, 'clientId' | 'placeholder'>[]) => {
    const current = readDraft(draftKey);
    const used = new Set(current.attachments.map(x => x.placeholder));
    const added = picked.map(a => {
      const placeholder = attachmentPlaceholder(a.kind, a.name, used); used.add(placeholder);
      return { ...a, clientId: globalThis.crypto.randomUUID(), placeholder };
    });
    const merged = { ...current, attachments: [...current.attachments, ...added] };
    setDraft(merged); writeDraft(draftKey, merged);
  };
  const pickPhotos = async (camera: boolean) => {
    if (camera) { const p = await ImagePicker.requestCameraPermissionsAsync(); if (!p.granted) { showToast(translate('native.cameraDenied'), 'error'); return; } }
    const result = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsMultipleSelection: true, selectionLimit: 8 });
    if (result.canceled) return;
    addAttachments(result.assets.map((asset, i) => ({ kind: 'photo' as const, uri: asset.uri, name: asset.fileName ?? `photo-${Date.now()}-${i + 1}.jpg`, mimeType: asset.mimeType ?? 'image/jpeg' })));
  };
  const pickFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return;
    addAttachments(result.assets.map(asset => ({ kind: asset.mimeType?.startsWith('image/') ? 'photo' as const : 'file' as const, uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? 'application/octet-stream' })));
  };
  const attach = () => showMenu({ title: translate('native.attach'), items: [
    { label: translate('native.photoLibrary'), icon: ImagePlus, onPress: () => void pickPhotos(false) },
    { label: translate('native.takePhoto'), icon: Camera, onPress: () => void pickPhotos(true) },
    { label: translate('native.chooseFile'), icon: FileUp, onPress: () => void pickFiles() },
  ] });

  const text = draft.text;
  const canSend = !disabled && !sending && (text.trim().length > 0 || draft.attachments.length > 0 || draft.quotes.length > 0);
  // Cmd/Ctrl+Enter sends from a hardware keyboard; an empty composer lets an older one try.
  useKeyCommand('send', () => { if (!canSend) return false; void send(); });
  const send = async () => {
    if (!canSend) return;
    let body = text.trim();
    // The server swaps each placeholder for the uploaded file's path; the Web puts them where
    // the caret is, the native composer shows files above the text and sends them after it.
    if (draft.attachments.length) body = `${body}${body ? '\n' : ''}${draft.attachments.map(a => a.placeholder).join(' ')}`;
    if (draft.quotes.length) {
      // The Web's quote format: a <pockymoe-quotes> block and [QUOTE n] tokens.
      const quotes = new Map<string, PromptQuote>();
      draft.quotes.forEach((q, i) => quotes.set(quotePlaceholder(i + 1), { text: clipQuote(q.text), from: q.from, turn: null, turnId: q.turnId, itemId: q.itemId,
        ...(q.path ? { path: q.path, startLine: q.startLine, endLine: q.endLine } : {}), ...(q.comment ? { comment: q.comment } : {}) }));
      const tokens = draft.quotes.map((_q, i) => quotePlaceholder(i + 1)).join(' ');
      body = composeQuotedPrompt(`${tokens}\n${body}`.trim(), quotes);
    }
    const attachments = draft.attachments;
    setSending(true);
    const saved = draft;
    update({ text: '', attachments: [], quotes: [] });
    const ok = await onSend(body, attachments).catch(() => false);
    setSending(false);
    if (ok) haptic.sent(); else update(saved);
  };

  // The Web's phone composer: one row at rest (text and Send), two once it has focus (attach on
  // the left; the model key with its context bar, Stop and Send on the right). It folds when the
  // conversation is tapped, or when focus leaves an empty prompt; losing focus alone keeps it.
  const [expanded, setExpanded] = useState(!!autoFocus);
  const empty = !text.trim() && !draft.attachments.length && !draft.quotes.length;
  useEffect(() => composerFold.subscribe(() => { if (composerFold.get().at) { input.current?.blur(); setExpanded(false); } }), []);
  const options = useModelOptions(api, threadId, agent, cwd);
  const option = options?.find(o => o.model === model.model);
  const modelName = option?.displayName || model.model || translate('native.defaultModel');
  const efforts = option ? option.supportedReasoningEfforts : null;
  // The effort line shows for a model the list knows with adjustable effort (the Web's rule).
  const effortWord = !efforts?.length ? null : model.effort ? effortLabel(model.effort) : translate('native.effortDefault');
  const effortTint = (() => {
    const index = efforts ? orderedEfforts(efforts).findIndex(e => e.reasoningEffort === model.effort) : -1;
    const color = t.plum ? plumEffortColor(model.effort, Math.max(0, index), efforts?.length ?? 1) : effortColor(model.effort, Math.max(0, index), efforts?.length ?? 1);
    return model.effort ? (t.mode === 'light' && !t.plum ? mixColor(color, '#000000', 0.28, t.c.panel) : color) : t.c.fgMuted;
  })();
  const lines = text.split('\n').length;
  const focusRing = expanded && !t.terminal;
  const shellRadius = t.terminal ? 0 : t.plum ? 20 : 18;
  const key = t.plum ? 36 : 34;
  const sendColors = t.plum ? { bg: canSend ? '#e8a93a' : '#f5e8d1', fg: canSend ? '#2e1a35' : t.c.fgMuted } : { bg: t.c.primary, fg: t.c.primaryFg };
  const sendKey = (
    <Press onPress={() => void send()} disabled={!canSend} feedback="dim" testID="send"
      accessibilityRole="button" accessibilityLabel={running ? translate('native.sendAfterTurn') : translate('chat.send')} accessibilityState={{ disabled: !canSend }}
      style={{ width: t.plum ? 42 : key, height: key, borderRadius: t.terminal ? 0 : t.plum ? 12 : key / 2, alignItems: 'center', justifyContent: 'center',
        backgroundColor: sendColors.bg, opacity: canSend || t.plum ? 1 : 0.45, ...(t.plum ? { borderBottomWidth: 2, borderBottomColor: canSend ? '#c4862a' : 'transparent' } : null) }}>
      {sending ? <ActivityIndicator size="small" color={sendColors.fg} />
        : running ? (
          // The Web's "send after this turn": the arrow with a small clock.
          <View style={{ width: 18, height: 18 }}><ArrowUp size={15} color={sendColors.fg} strokeWidth={1.8} style={{ position: 'absolute', left: 0, top: 0 }} />
            <Clock3 size={8} color={sendColors.fg} strokeWidth={2.4} style={{ position: 'absolute', right: 0, bottom: 0 }} /></View>
        )
        : t.plum ? <SendHorizontal size={17} color={sendColors.fg} /> : <ArrowUp size={16} color={sendColors.fg} strokeWidth={1.8} />}
    </Press>
  );
  const stopKey = running && onStop ? (
    <Press onPress={() => { haptic.warning(); onStop(); }} feedback="dim" accessibilityRole="button" accessibilityLabel={translate('chat.stop')} testID="stop"
      style={{ width: t.plum ? 32 : key, height: t.plum ? 32 : key, borderRadius: t.terminal ? 0 : 99, alignItems: 'center', justifyContent: 'center', marginRight: 8,
        backgroundColor: t.plum || t.terminal ? 'transparent' : mixColor(t.c.panel, '#c83b42', 0.12, t.c.panel),
        borderWidth: t.plum ? 1.5 : 1, borderColor: t.plum ? '#a62e3d' : t.terminal ? t.c.borderStrong : mixColor(t.c.border, '#c83b42', 0.3, t.c.panel) }}>
      <View style={{ width: t.plum ? 8 : 10, height: t.plum ? 8 : 10, borderRadius: t.terminal ? 0 : 2, backgroundColor: t.plum ? '#a62e3d' : t.terminal ? t.c.fg : t.mode === 'dark' ? '#ff9b9f' : '#b62f38' }} />
    </Press>
  ) : null;
  const tiles = draft.quotes.length || draft.attachments.length ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4, paddingBottom: 6 }} keyboardShouldPersistTaps="handled">
      {draft.quotes.map((q, i) => (
        <QuoteMark key={q.id} n={i + 1} text={q.path ? `${q.path.split('/').pop()}:${q.startLine === q.endLine ? q.startLine : `${q.startLine}–${q.endLine}`}` : q.text}
          onPress={() => showMenu({ title: q.text.slice(0, 80), items: [{ label: translate('native.remove'), icon: X, destructive: true, onPress: () => update({ quotes: draft.quotes.filter(x => x.id !== q.id) }) }] })} />
      ))}
      {draft.attachments.map(a => (
        <AttachTile key={a.clientId} attachment={a}
          onPress={() => showMenu({ title: a.name, items: [
            ...(a.kind === 'photo' ? [{ label: translate('chat.attachmentView'), icon: ImagePlus, onPress: () => setViewing(a) }] : []),
            { label: translate('native.remove'), icon: X, destructive: true, onPress: () => update({ attachments: draft.attachments.filter(x => x.clientId !== a.clientId) }) },
          ] })} />
      ))}
    </ScrollView>
  ) : null;
  return (
    <View style={{ paddingHorizontal: 9 }}>
      <View style={{ backgroundColor: t.plum ? withAlpha(t.c.panel, 0.96) : t.c.panel, borderRadius: shellRadius,
        borderWidth: t.plum ? 1.5 : 1, borderColor: focusRing ? (t.plum ? '#b67a1c' : t.c.primary) : t.plum ? (t.mode === 'dark' ? '#4d3260' : '#dcc19a') : t.terminal ? (t.mode === 'dark' ? '#7a867f' : '#55554f') : t.c.borderStrong,
        paddingTop: t.plum ? (expanded ? 11 : 7) : 9, paddingBottom: t.plum ? 7 : 9, paddingLeft: t.plum ? (expanded ? 14 : 13) : 12, paddingRight: t.plum ? 7 : 12,
        ...(t.terminal ? null : { shadowColor: t.plum ? '#3d2349' : '#192821', shadowOpacity: t.mode === 'dark' ? 0.35 : t.plum ? 0.13 : 0.19, shadowRadius: t.plum ? 17 : 22, shadowOffset: { width: 0, height: t.plum ? 7 : 9 }, elevation: 4 }) }}>
        {t.plum ? <View pointerEvents="none" style={{ position: 'absolute', top: 3, left: 3, right: 3, bottom: 3, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: withAlpha(t.c.stitch ?? t.c.primary, running ? 0.35 : 0.5) }} /> : null}
        <ComposerPeek agent={agent.agentId ?? agent.provider} />
        {tiles}
        <View style={{ flexDirection: 'row', alignItems: expanded ? 'flex-start' : 'center', gap: 8 }}>
          {t.terminal ? <AppText variant="mono" color={t.c.primary} style={{ fontSize: 13, lineHeight: 24 }}>❯</AppText> : null}
          <TextInput ref={input} value={text} onChangeText={v => update({ text: v })} multiline autoFocus={autoFocus}
            onFocus={() => setExpanded(true)} onBlur={() => { if (!readDraft(draftKey).text.trim() && !draft.attachments.length && !draft.quotes.length) setExpanded(false); }}
            placeholder={placeholder ?? (running ? translate('chat.queueNextPrompt') : translate('chat.typeMessage'))} placeholderTextColor={t.c.fgMuted}
            accessibilityLabel={translate('native.prompt')} selectionColor={t.c.primary} textAlignVertical="top" scrollEnabled={expanded} testID="composer-input"
            style={{ flex: 1, minHeight: 24, maxHeight: expanded ? 240 : 24, padding: 0, color: t.c.fg, fontFamily: t.terminal ? t.font.mono : t.font.regular, fontSize: t.terminal ? 13 : 16, lineHeight: 24 }} />
          {!expanded && lines > 1 ? <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: t.c.hover }}><AppText variant="caption" style={{ fontSize: 11 }}>{`+${lines - 1}`}</AppText></View> : null}
          {!expanded ? <>{stopKey}{sendKey}</> : null}
        </View>
        {expanded ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4, marginHorizontal: -6, marginBottom: -4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <IconButton icon={t.plum ? Paperclip : Plus} size={t.plum ? 16 : 14} label={translate('native.attach')} onPress={attach} style={{ width: key, height: key }} />
              {leading}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
              <View style={{ alignItems: 'stretch', marginRight: 6, flexShrink: 1, maxWidth: t.plum ? 144 : 200 }}>
                <Press ref={modelKey} onPress={openPicker} feedback="dim" accessibilityRole="button" testID="model-key"
                  accessibilityLabel={`${translate('native.modelAndEffort')}: ${modelName}${effortWord ? `, ${effortWord}` : ''}`}
                  style={{ height: 26, justifyContent: 'center', paddingHorizontal: t.plum ? 8 : 4, borderRadius: t.terminal ? 0 : t.plum ? 10 : 6, ...(t.terminal ? { borderWidth: 1, borderColor: t.c.border } : null) }}>
                  <AppText variant="caption" weight={t.plum ? 'bold' : 'regular'} numberOfLines={1} color={t.c.fgSoft} style={{ fontSize: t.plum ? 10 : 11, lineHeight: 12 }}>{modelName}</AppText>
                  {effortWord ? <AppText variant="caption" numberOfLines={1} color={effortTint} style={{ fontSize: t.plum ? 9 : 11, lineHeight: 12 }}>{effortWord}</AppText> : null}
                </Press>
                <ContextMeter variant="bar" usage={contextUsage} running={running} onCompact={onCompact} />
              </View>
              {stopKey}
              {sendKey}
            </View>
          </View>
        ) : null}
      </View>
      {dock}
      <ModelPicker visible={picker} onClose={() => setPicker(false)} api={api} threadId={threadId} agent={agent} value={model} onChange={onModel}
        agents={agents} canSwitch={!!threadId && canSwitch !== false} running={running} cwd={cwd} anchor={pickerAnchor} onSwitched={onSwitched} />
      {viewing ? <ImageViewer uri={viewing.uri} name={viewing.name} onClose={() => setViewing(null)} /> : null}
    </View>
  );
}

/** Folds every composer, as a tap on the conversation does on the Web. */
export const composerFold = createStore<{ at: number }>({ at: 0 });
export const foldComposer = () => composerFold.set({ at: Date.now() });

/** A quote as the Web's quote mark: a 22 pt pill with the quote icon, its number and an excerpt. */
function QuoteMark({ n, text, onPress }: { n: number; text: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Press onPress={onPress} feedback="dim" accessibilityRole="button" accessibilityLabel={`${n}: ${text}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 3, height: 22, paddingLeft: 6, paddingRight: 7, borderRadius: t.terminal ? 0 : 999, borderWidth: 1, borderColor: t.c.border }}>
      <Quote size={11} color={t.c.fgMuted} />
      <AppText variant="caption" weight="bold" tone="muted" style={{ fontSize: 11 }}>{n}</AppText>
      <AppText variant="caption" tone="muted" numberOfLines={1} style={{ fontSize: 11, maxWidth: 110 }}>{text}</AppText>
    </Press>
  );
}

/** An attachment as the Web's 22 pt tile: a thumbnail or glyph and the name. */
function AttachTile({ attachment: a, onPress }: { attachment: PromptAttachment; onPress: () => void }) {
  const t = useTheme();
  return (
    <Press onPress={onPress} feedback="dim" accessibilityRole="button" accessibilityLabel={a.name}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 22, maxWidth: 144, paddingLeft: 3, paddingRight: 6, borderRadius: t.terminal ? 0 : 6, borderWidth: 1, borderColor: t.c.border, backgroundColor: t.c.surface }}>
      {a.kind === 'photo' ? <Image source={{ uri: a.uri }} style={{ width: 16, height: 18, borderRadius: 3 }} /> : <FileText size={14} color={t.c.fgMuted} />}
      <AppText variant="caption" numberOfLines={1} style={{ fontSize: 10, flexShrink: 1 }}>{a.name}</AppText>
    </Press>
  );
}
