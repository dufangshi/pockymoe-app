// Edit from here (docs/git.md "Turn checkpoints and restore"): rewind the conversation to
// before a user message, optionally restoring the files to that turn's start, and put the
// message (with its attachments) back in the composer. Queued prompts need an explicit
// discard; replacing a draft asks first; a file rewind offers Undo. External effects stay.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Circle, CircleDot, RotateCcw, Square, SquareCheck } from 'lucide-react-native';
import { gitWrite } from '@pockymoe/web/gitApi';
import { gitText as gt } from '@pockymoe/web/gitI18n';
import { File as FsFile, Paths } from 'expo-file-system';
import { AppText } from '../../design/AppText';
import { Button } from '../../design/Button';
import { Press } from '../../design/Press';
import { Banner } from '../../design/States';
import { Sheet } from '../../design/Sheet';
import { confirmAsync, showToast } from '../../design/Overlay';
import { useTheme } from '../../design/theme';
import { haptic } from '../../design/haptics';
import { translate } from '../../i18n';
import { findDevice } from '../../connection/devices';
import { deviceFetch } from '../../protocol/transport';
import type { PromptAttachment } from '../../protocol/api';
import { readDraft, writeDraft } from '../thread/Composer';
import { loadThread, threadKey } from '../../state/threadDetail';
import { errorText } from './useGitWrite';

import { rewindDraftText, type RewindPrompt } from './rewind';

async function downloadAttachment(deviceKey: string, threadId: string, a: RewindPrompt['attachments'][number], placeholder: string): Promise<PromptAttachment> {
  const device = findDevice(deviceKey);
  if (!device) throw new Error('No device');
  const response = await deviceFetch(device.target, `/api/threads/${encodeURIComponent(threadId)}/linked-files/raw?${new URLSearchParams({ path: a.path })}`, {}, threadId);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const file = new FsFile(Paths.cache, `rewind-${Date.now()}-${a.originalName.replace(/[^\w.-]+/g, '_')}`);
  if (file.exists) file.delete();
  file.create();
  await (file as unknown as { write(c: Uint8Array): Promise<void> | void }).write(bytes);
  return { clientId: a.clientId || globalThis.crypto.randomUUID(), kind: a.kind, name: a.originalName, uri: file.uri, mimeType: response.headers.get('content-type') ?? 'application/octet-stream', placeholder };
}

export function RewindSheet({ visible, onClose, deviceKey, threadId, turnId, running, queued }: {
  visible: boolean; onClose(): void; deviceKey: string; threadId: string; turnId: string | null; running: boolean; queued: number;
}) {
  const t = useTheme();
  const [restoreFiles, setRestoreFiles] = useState(false);
  const [dropQueued, setDropQueued] = useState(false);
  const [reason, setReason] = useState<string | null>('…');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoId, setUndoId] = useState<string | null>(null);
  const preview = useRef<{ key: string; promise: Promise<unknown> } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!visible || !turnId) return;
    setRestoreFiles(false); setDropQueued(false); setError(null); setUndoId(null); setReason('…');
  }, [visible, turnId]);
  useEffect(() => {
    if (!visible || !turnId) return;
    let live = true;
    const key = JSON.stringify([threadId, turnId, deviceKey, revision]);
    if (preview.current?.key !== key) preview.current = { key, promise: gitWrite(threadId, 'checkpoints/preview', { turnId, phase: 'start' }, deviceKey) };
    preview.current.promise.then(() => { if (live) setReason(null); }, e => { if (live) setReason(errorText(e)); });
    return () => { live = false; };
  }, [visible, threadId, turnId, deviceKey, revision]);
  const key = threadKey(deviceKey, threadId);
  const rewind = async () => {
    if (!turnId) return;
    const draft = readDraft(key);
    if ((draft.text.trim() || draft.attachments.length) && !await confirmAsync({ title: translate('review.replaceDraft'), message: translate('review.replaceDraftBody'), confirmLabel: translate('review.replace') })) return;
    setBusy(true); setError(null);
    try {
      const result = await gitWrite<{ prompt: RewindPrompt; undoId?: string }>(threadId, 'rewind', { turnId, restoreFiles, ...(dropQueued ? { dropQueued: true } : {}) }, deviceKey);
      void loadThread(deviceKey, threadId, 6, true);
      const { text, placeholders } = rewindDraftText(result.prompt);
      // The text first, so a failed attachment download never loses the prompt.
      writeDraft(key, { text: result.prompt.attachments.length ? text : result.prompt.text, attachments: [], quotes: [] });
      if (result.prompt.attachments.length) {
        const attachments: PromptAttachment[] = [];
        for (const [i, a] of result.prompt.attachments.entries()) {
          try { attachments.push(await downloadAttachment(deviceKey, threadId, a, placeholders[i]!)); } catch (e) { showToast(`${a.originalName}: ${errorText(e)}`, 'error'); }
        }
        writeDraft(key, { ...readDraft(key), attachments });
      }
      haptic.success();
      if (result.undoId) setUndoId(result.undoId); else onClose();
    } catch (e) { setError(errorText(e)); haptic.warning(); } finally { setBusy(false); }
  };
  const undo = async () => {
    if (!undoId) return;
    setBusy(true);
    try { await gitWrite(threadId, 'checkpoints/undo', { undoId }, deviceKey); showToast(translate('review.filesBack'), 'success'); onClose(); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const option = (on: boolean, label: string, onPress: () => void, disabled = false) => (
    <Press onPress={onPress} disabled={disabled} accessibilityRole="radio" accessibilityState={{ checked: on, disabled }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
      {on ? <CircleDot size={20} color={t.c.primary} /> : <Circle size={20} color={t.c.fgMuted} />}
      <AppText variant="callout" style={{ flex: 1 }}>{label}</AppText>
    </Press>
  );
  if (undoId) {
    return (
      <Sheet visible={visible} onClose={onClose} title={gt('restored')}
        footer={<><Button label={gt('undo')} icon={RotateCcw} busy={busy} onPress={() => void undo()} style={{ flex: 1, maxWidth: 220 }} /><Button label={translate('review.done')} kind="primary" onPress={onClose} style={{ flex: 1, maxWidth: 220 }} /></>}>
        <AppText variant="callout" tone="soft">{translate('review.rewoundFiles')}</AppText>
        {error ? <View style={{ marginTop: 8 }}><Banner tone="danger" text={error} /></View> : null}
      </Sheet>
    );
  }
  return (
    <Sheet visible={visible} onClose={onClose} title={translate('review.editFromHere')} dismissable={!busy}
      footer={<><Button label={gt('cancel')} onPress={onClose} style={{ flex: 1, maxWidth: 220 }} />
        <Button label={translate('review.rewind')} kind="primary" busy={busy} disabled={running || (queued > 0 && !dropQueued)} onPress={() => void rewind()} style={{ flex: 1, maxWidth: 220 }} testID="rewind-confirm" /></>}>
      <View style={{ gap: 4 }}>
        <AppText variant="footnote" tone="muted" style={{ marginBottom: 4 }}>{translate('review.externalEffects')}</AppText>
        {option(!restoreFiles, translate('review.rewindConversation'), () => setRestoreFiles(false))}
        {option(restoreFiles, translate('review.rewindFiles'), () => setRestoreFiles(true), reason !== null)}
        {reason === '…' ? <ActivityIndicator size="small" color={t.c.fgMuted} style={{ alignSelf: 'flex-start', marginLeft: 30 }} />
          : reason ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 30 }}>
            <AppText variant="footnote" tone="muted" style={{ flex: 1 }}>{reason}</AppText>
            <Button label={translate('common.retry')} size="sm" kind="ghost" onPress={() => { setReason('…'); setRevision(v => v + 1); }} />
          </View> : null}
        {queued > 0 ? (
          <Press onPress={() => setDropQueued(v => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: dropQueued }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, marginTop: 4 }}>
            {dropQueued ? <SquareCheck size={20} color={t.c.primary} /> : <Square size={20} color={t.c.fgMuted} />}
            <AppText variant="callout" style={{ flex: 1 }}>{translate('review.discardQueued', { count: queued })}</AppText>
          </Press>
        ) : null}
        {running ? <Banner tone="warning" text={translate('review.rewindIdle')} /> : null}
        {error ? <Banner tone="danger" text={error} /> : null}
      </View>
    </Sheet>
  );
}
