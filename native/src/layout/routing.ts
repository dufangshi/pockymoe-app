// Cross-feature navigation for review surfaces (PR page, ask an agent, work on a PR). The
// shell decides how a thread opens: a pushed page on a phone, the detail column when split.
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { readDraft, writeDraft } from '../features/thread/Composer';
import { threadKey } from '../state/threadDetail';
import type { RootStack } from '../navigation/routes';
import { useLayout } from './layout';
import { selectionStore } from './selection';

const appendDraft = (key: string, prompt?: string) => {
  if (!prompt) return;
  const draft = readDraft(key);
  writeDraft(key, { ...draft, text: draft.text.trim() ? `${draft.text}\n\n${prompt}` : prompt });
};

export function usePrNavigation() {
  const nav = useNavigation<NativeStackNavigationProp<RootStack>>();
  const layout = useLayout();
  return {
    openPage(deviceKey: string) { nav.push('PullRequests', { deviceKey }); },
    openThread(deviceKey: string, threadId: string, prompt?: string) {
      appendDraft(threadKey(deviceKey, threadId), prompt);
      if (layout.split) { selectionStore.set({ deviceKey, threadId, newThread: null }); nav.popTo('Workbench'); }
      else nav.push('Thread', { deviceKey, threadId });
    },
    newThread(deviceKey: string, workspaceId: string, prompt?: string) {
      appendDraft(`new:${deviceKey}`, prompt);
      if (layout.split) { selectionStore.set({ deviceKey, threadId: null, newThread: { workspaceId } }); nav.popTo('Workbench'); }
      else nav.push('NewThread', { deviceKey, workspaceId });
    },
  };
}
