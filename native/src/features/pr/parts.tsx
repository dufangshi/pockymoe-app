// Pull request marks and small pieces, the Web's `pr/review/parts.tsx` on native: state by
// shape (open, draft, merged, closed differ without colour), CI and review decision marks,
// relative times, labels and host Markdown.
import { View } from 'react-native';
import {
  CircleCheck, CircleDashed, CircleDot, CircleX, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, MessageSquareWarning, ThumbsUp,
} from 'lucide-react-native';
import type { ChecksState, PullState, ReviewDecision } from '@pockymoe/web-git/pr/review/reviewApi';
import { rt } from '@pockymoe/web-git/pr/review/reviewText';
import { AppText } from '../../design/AppText';
import { useTheme } from '../../design/theme';
import { formatDate } from '../../i18n';
import { relativeTime } from '../threads/time';
import { Markdown } from '../thread/Markdown';

export function PullStateMark({ state, draft, size = 18 }: { state: PullState; draft: boolean; size?: number }) {
  const t = useTheme();
  const label = state === 'merged' ? rt('merged') : state === 'closed' ? rt('closed') : draft ? rt('draftState') : rt('open');
  const Icon = state === 'merged' ? GitMerge : state === 'closed' ? GitPullRequestClosed : draft ? GitPullRequestDraft : GitPullRequest;
  const color = state === 'merged' ? t.c.agents : state === 'closed' ? t.c.failed : draft ? t.c.fgMuted : t.c.online;
  return <View accessible accessibilityRole="image" accessibilityLabel={label}><Icon size={size} color={color} strokeWidth={2.2} /></View>;
}

export function ChecksMark({ checks, size = 15 }: { checks: ChecksState | null; size?: number }) {
  const t = useTheme();
  if (!checks || checks === 'none') return null;
  const label = `${rt('checks')}: ${checks === 'passed' ? rt('passing') : checks === 'failed' ? rt('failing') : rt('pending')}`;
  const Icon = checks === 'passed' ? CircleCheck : checks === 'failed' ? CircleX : CircleDashed;
  const color = checks === 'passed' ? t.c.online : checks === 'failed' ? t.c.failed : t.c.waiting;
  return <View accessible accessibilityRole="image" accessibilityLabel={label}><Icon size={size} color={color} /></View>;
}

export function DecisionMark({ decision, size = 15 }: { decision: ReviewDecision | null; size?: number }) {
  const t = useTheme();
  if (!decision) return null;
  const label = rt(decision === 'approved' ? 'approved' : decision === 'changesRequested' ? 'changesRequested' : 'reviewRequired');
  const Icon = decision === 'approved' ? ThumbsUp : decision === 'changesRequested' ? MessageSquareWarning : CircleDot;
  const color = decision === 'approved' ? t.c.online : decision === 'changesRequested' ? t.c.failed : t.c.fgMuted;
  return <View accessible accessibilityRole="image" accessibilityLabel={label}><Icon size={size} color={color} /></View>;
}

/** "3h", "2d" (the full time for screen readers): the thread list's relative time. */
export const ago = (value: string) => relativeTime(value);
export function Ago({ value }: { value: string }) {
  const text = ago(value);
  if (!text) return null;
  return <AppText variant="caption" tone="muted" accessibilityLabel={formatDate(value)}>{text}</AppText>;
}

export function Label({ name, color }: { name: string; color?: string | undefined }) {
  const t = useTheme();
  const hex = color ? `#${color.replace(/^#/, '')}` : t.c.fgMuted;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, height: 18, borderRadius: t.radius.pill, borderWidth: 1, borderColor: t.c.border }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: hex }} />
      <AppText variant="caption" tone="soft" numberOfLines={1} style={{ lineHeight: 14, maxWidth: 110 }}>{name}</AppText>
    </View>
  );
}

/** Host Markdown with native views (never a WebView); empty bodies say so when asked. */
export function Body({ text, empty }: { text: string; empty?: string }) {
  if (!text.trim()) return empty ? <AppText variant="callout" tone="muted">{empty}</AppText> : null;
  return <Markdown text={text} />;
}

export const message = (e: unknown) => String((e as Error)?.message ?? e);
