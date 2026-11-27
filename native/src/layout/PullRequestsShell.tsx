// The pull requests page by width class (layer 2): on a phone the list is the page and a
// PR pushes over it; split, the list and the open review sit side by side. Rotating or
// unfolding hands the open review over to the other layout.
import { useEffect } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GitPullRequest } from 'lucide-react-native';
import { rt } from '@pockymoe/web-git/pr/review/reviewText';
import { AppBar } from '../design/AppBar';
import { EmptyState } from '../design/States';
import { useTheme } from '../design/theme';
import { devicesStore, findDevice } from '../connection/devices';
import { createStore } from '../state/store';
import { PullRequestList, usePullRequests } from '../features/pr/PullRequestList';
import { PullRequestReview, type AskTarget } from '../features/pr/PullRequestReview';
import type { RootStack } from '../navigation/routes';
import { useLayout } from './layout';
import { usePrNavigation } from './routing';

/** The PR open beside the list; survives rotation like the workbench selection. */
export const prSelection = createStore<{ url: string | null }>({ url: null });

function useAsk(deviceKey: string) {
  const nav = usePrNavigation();
  return {
    ask: (target: AskTarget, prompt: string) => target.kind === 'thread' ? nav.openThread(deviceKey, target.threadId, prompt) : nav.newThread(deviceKey, target.workspaceId, prompt),
    openThread: (id: string) => nav.openThread(deviceKey, id),
  };
}

export function PullRequestsShell({ deviceKey }: { deviceKey: string }) {
  const t = useTheme();
  const layout = useLayout();
  const nav = useNavigation<NativeStackNavigationProp<RootStack>>();
  const state = usePullRequests(deviceKey);
  const selected = prSelection.useValue(s => s.url);
  const device = devicesStore.useValue(() => findDevice(deviceKey));
  const { ask, openThread } = useAsk(deviceKey);
  useEffect(() => {
    // Folding to a phone width keeps the open PR: it becomes a pushed page.
    if (!layout.split && selected) { nav.push('PullRequest', { deviceKey, url: selected }); prSelection.set({ url: null }); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.split]);
  const bar = <AppBar title={rt('page')} subtitle={device?.name ?? null} onBack={() => nav.goBack()} />;
  const list = <PullRequestList deviceKey={deviceKey} state={state} selected={layout.split ? selected : null}
    onOpen={pull => layout.split ? prSelection.set({ url: pull.url }) : nav.push('PullRequest', { deviceKey, url: pull.url })} />;
  if (!layout.split) return <View style={{ flex: 1, backgroundColor: t.c.bg }}>{bar}{list}</View>;
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.c.bg }}>
      <View style={{ width: layout.listWidth + 40, borderRightWidth: 1, borderRightColor: t.c.border }}>{bar}{list}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <SafeTop />
        {selected ? <PullRequestReview key={selected} deviceKey={deviceKey} url={selected} onAsk={ask} onOpenThread={openThread} onChanged={state.refresh} onOpenPull={next => prSelection.set({ url: next })} />
          : <EmptyState icon={GitPullRequest} title={rt('page')} body={rt('search')} />}
        <SafeBottom />
      </View>
    </View>
  );
}

function SafeTop() { const insets = useSafeAreaInsets(); return <View style={{ height: insets.top }} />; }
function SafeBottom() { const insets = useSafeAreaInsets(); return <View style={{ height: insets.bottom }} />; }

/** One PR pushed on a phone. Unfolding or rotating to a wide window shows it beside the list. */
export function PullRequestScreen({ deviceKey, url }: { deviceKey: string; url: string }) {
  const t = useTheme();
  const nav = useNavigation<NativeStackNavigationProp<RootStack>>();
  const layout = useLayout();
  const insets = useSafeAreaInsets();
  const { ask, openThread } = useAsk(deviceKey);
  useEffect(() => {
    if (layout.split) { prSelection.set({ url }); nav.goBack(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.split]);
  return (
    <View style={{ flex: 1, backgroundColor: t.c.bg, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <PullRequestReview deviceKey={deviceKey} url={url} onBack={() => nav.goBack()} onAsk={ask} onOpenThread={openThread} onOpenPull={next => nav.replace('PullRequest', { deviceKey, url: next })} />
    </View>
  );
}
