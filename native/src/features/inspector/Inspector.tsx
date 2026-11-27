// The inspector (Git, Files): a column on expanded windows, a sheet elsewhere. One header
// for every pane: the pane switch, the thread it belongs to, ×. Review comments made in a
// diff or a file become chips in this thread's composer; "Ask agent" puts text there.
import { useState } from 'react';
import { View } from 'react-native';
import { X } from 'lucide-react-native';
import { AppText } from '../../design/AppText';
import { IconButton } from '../../design/Button';
import { useTheme } from '../../design/theme';
import { translate } from '../../i18n';
import { useThreadEntry, threadKey } from '../../state/threadDetail';
import { useDeviceData } from '../../state/deviceData';
import { devicesStore, findDevice } from '../../connection/devices';
import { addQuote, readDraft, writeDraft } from '../thread/Composer';
import { Segmented } from '../thread/ModelPicker';
import { GitPane, type GitView } from '../git/GitPane';
import { ThreadPullRequests } from '../pr/ThreadPullRequests';
import { FilesPane } from '../files/FilesPane';

export type InspectorPane = 'files' | 'git';
export interface InspectorProps {
  deviceKey: string; threadId: string; pane: InspectorPane;
  /** Files a turn changed (its changes chip). */
  paths?: string[];
  /** The turn whose changes chip opened the pane. */
  turnId?: string | null;
  /** Opens the Git pane on a view (e.g. a PR from a link). */
  gitView?: GitView | null;
  onPane: (p: InspectorPane) => void; onClose: () => void;
}

export function Inspector({ deviceKey, threadId, pane, paths, turnId, gitView, onPane, onClose }: InspectorProps) {
  const t = useTheme();
  const entry = useThreadEntry(deviceKey, threadId);
  const data = useDeviceData(deviceKey);
  const shared = devicesStore.useValue(() => findDevice(deviceKey)?.shared ?? false);
  const thread = entry.detail?.thread ?? data.threads.find(th => th.id === threadId);
  const running = thread?.status === 'running' || !!thread?.activeTurnId;
  const [filePath, setFilePath] = useState<string | null>(null);
  const key = threadKey(deviceKey, threadId);
  const quote = (q: { path: string; startLine: number; endLine: number; text: string; comment: string }) => {
    addQuote(key, { id: `${q.path}:${q.startLine}-${q.endLine}:${Date.now()}`, from: 'user', turnId: null, itemId: null, ...q });
    return true;
  };
  const ask = (prompt: string) => {
    const draft = readDraft(key);
    writeDraft(key, { ...draft, text: draft.text.trim() ? `${draft.text}\n\n${prompt}` : prompt });
    onClose();
  };
  return (
    <View style={{ flex: 1 }} accessibilityLabel={translate('native.inspector')}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 4, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.c.border }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Segmented label={translate('native.inspector')} value={pane} onChange={onPane} options={[{ value: 'git', label: translate('native.git') }, { value: 'files', label: translate('native.files') }]} />
          {thread ? <AppText variant="caption" tone="muted" numberOfLines={1}>{thread.title}</AppText> : null}
        </View>
        <IconButton icon={X} label={translate('workbench.close')} onPress={onClose} />
      </View>
      {pane === 'git' ? (
        <GitPane key={`git:${threadId}`} deviceKey={deviceKey} threadId={threadId} canWrite={!shared} running={running}
          initialTurnId={turnId ?? null} initialView={gitView ?? null} onReviewQuote={quote} onAsk={ask}
          onOpenPath={path => { setFilePath(path); onPane('files'); }}
          renderPullRequests={!shared ? ({ workingCopyId }) => <ThreadPullRequests deviceKey={deviceKey} threadId={threadId} workingCopyId={workingCopyId} running={running} onAsk={ask} /> : undefined} />
      ) : (
        <FilesPane key={`files:${threadId}`} deviceKey={deviceKey} threadId={threadId} workspaceId={thread?.workspaceId ?? null}
          initialPath={filePath ?? (paths?.length === 1 ? paths[0]! : null)} onReviewQuote={quote} onAsk={ask} />
      )}
    </View>
  );
}
