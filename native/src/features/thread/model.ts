// The transcript's view model, built with the shared UI's own timeline logic (vendored):
// item ordering and grouping, answer sections, operation counts and changed files.
import type { ThreadDetailDto, ThreadHistoryItemDto, ThreadTurnDto } from '@pockymoe/shared';
import { groupTimelineHistoryItems, prepareTurnItemsForRendering, sortTurnItemsByRecordedSequence, type TimelineHistoryEntry } from '../../../vendor/pockymoe/thread-ui/components/timeline/timelineItems';
import { groupAnswerSections, isSubstantiveAnswer } from '../../../vendor/pockymoe/thread-ui/components/timeline/answerSections';
import { activityParts, hasActivity, logStatus, turnActivity, turnChangedFiles, type ActivityCounts, type ActivityPart } from '../../../vendor/pockymoe/thread-ui/components/timeline/activity';
import type { LocalPrompt } from '../../state/threadDetail';

export type Section =
  | { kind: 'answer'; key: string; item: ThreadHistoryItemDto }
  | { kind: 'narration'; key: string; item: ThreadHistoryItemDto }
  | { kind: 'work'; key: string; entries: TimelineHistoryEntry[] };

export interface TurnView {
  key: string;
  turn: ThreadTurnDto;
  prompt: ThreadHistoryItemDto | null;
  /** Prompts sent into the running turn (steers). */
  steers: ThreadHistoryItemDto[];
  sections: Section[];
  counts: ActivityCounts | null;
  parts: ActivityPart[];
  files: ReturnType<typeof turnChangedFiles>;
  durationMs: number | null;
  running: boolean;
  status: 'done' | 'running' | 'failed' | 'interrupted';
  /** Older turns arrive summarized; their operations load on demand. */
  deferred: boolean;
  /** The latest reasoning headline while the turn works. */
  thought: string | null;
  local?: LocalPrompt;
  /** A switch of the thread's agent recorded after this turn. */
  switchAfter?: ThreadHistoryItemDto;
}

export function turnDuration(turn: ThreadTurnDto, now = Date.now()) {
  const start = Date.parse(turn.startedAt ?? '');
  if (!Number.isFinite(start)) return null;
  const end = turn.completedAt ? Date.parse(turn.completedAt) : turn.status === 'inProgress' ? now : NaN;
  return Number.isFinite(end) && end >= start ? end - start : null;
}

/** First line of a reasoning summary, without markdown emphasis. */
export function headline(text: string) {
  const line = text.split('\n').map(l => l.trim()).find(Boolean) ?? '';
  return line.replace(/^#+\s*/, '').replace(/^\*\*(.+?)\*\*:?$/, '$1').replace(/\*\*/g, '').slice(0, 140);
}

export function buildTurn(turn: ThreadTurnDto, activeTurnId: string | null): TurnView {
  const running = turn.status === 'inProgress' || turn.id === activeTurnId;
  const ordered = sortTurnItemsByRecordedSequence(prepareTurnItemsForRendering(turn.items, running));
  const promptIndex = ordered.findIndex(i => i.kind === 'userMessage');
  const prompt = promptIndex >= 0 ? ordered[promptIndex]! : null;
  const rest = ordered.filter((_, i) => i !== promptIndex);
  const steers = rest.filter(i => i.kind === 'userMessage');
  const work = rest.filter(i => i.kind !== 'userMessage');
  const agentMessages = work.filter(i => i.kind === 'agentMessage');
  const lastAgent = agentMessages.at(-1);
  // A finished turn shows its reply; the last agent message is the answer even when short.
  const visibleAgentId = running ? undefined : lastAgent?.id;
  const grouped = groupAnswerSections(groupTimelineHistoryItems(work), visibleAgentId);
  const sections: Section[] = grouped.map(entry => {
    if (entry.kind === 'item' && entry.item.kind === 'agentMessage' && (isSubstantiveAnswer(entry.item) || entry.item.id === visibleAgentId))
      return { kind: 'answer', key: entry.key, item: entry.item };
    if (entry.kind === 'item' && entry.item.kind === 'agentMessage') return { kind: 'narration', key: entry.key, item: entry.item };
    return { kind: 'work', key: entry.key, entries: entry.kind === 'agentActivityGroup' ? entry.entries : [entry] };
  });
  const counts = turnActivity(turn, work);
  const reasoning = [...work].reverse().find(i => i.kind === 'reasoning' && i.text.trim());
  return {
    key: turn.id, turn, prompt, steers, sections, counts,
    parts: hasActivity(counts) ? activityParts(counts) : [],
    files: turnChangedFiles(turn, work),
    durationMs: turnDuration(turn),
    running,
    status: running ? 'running' : turn.status === 'failed' ? 'failed' : turn.status === 'interrupted' ? 'interrupted' : 'done',
    deferred: !!turn.hasDeferredItems,
    thought: running && reasoning ? headline(reasoning.text) : null,
  };
}

/** Turns in display order, plus prompts this app sent that the device has not shown. */
export function buildTranscript(detail: ThreadDetailDto | null, local: LocalPrompt[]): TurnView[] {
  const switches = new Map((detail?.harnessSwitches ?? []).filter(e => e.afterTurnId).map(e => [e.afterTurnId!, e]));
  const turns: TurnView[] = (detail?.turns ?? []).map(turn => ({ ...buildTurn(turn, detail?.thread.activeTurnId ?? null), switchAfter: switches.get(turn.id) }));
  for (const prompt of local) {
    turns.push({
      key: `local:${prompt.clientRequestId}`,
      turn: { id: prompt.clientRequestId, startedAt: prompt.createdAt, status: 'inProgress', error: prompt.error ?? null, items: [] },
      prompt: { id: `local:${prompt.clientRequestId}`, kind: 'userMessage', text: prompt.text, createdAt: prompt.createdAt },
      steers: [], sections: [], counts: null, parts: [], files: [], durationMs: null, running: prompt.state === 'sending',
      status: prompt.state === 'failed' ? 'failed' : 'running', deferred: false, thought: null, local: prompt,
    });
  }
  return turns;
}

/** Flat rows of one work section, with the item counts of each group. */
export function entryItems(entry: TimelineHistoryEntry): ThreadHistoryItemDto[] {
  if (entry.kind === 'item') return [entry.item];
  if (entry.kind === 'agentActivityGroup') return entry.entries.flatMap(entryItems);
  return entry.items;
}
export const itemStatus = (item: ThreadHistoryItemDto) => logStatus(item.status);

/** Ports the shared UI's foldReply (GraphChatMessageBody.tsx): cut long replies at a line,
    sentence or word near the limit, never inside an unclosed fence or bold marker. */
export function foldReply(text: string, limit = 1200): string | null {
  if (text.length <= limit * 1.25) return null;
  let cut = text.lastIndexOf('\n', limit);
  if (cut < limit * 0.6) cut = Math.max(text.lastIndexOf('. ', limit), text.lastIndexOf('。', limit));
  if (cut < limit * 0.6) cut = text.lastIndexOf(' ', limit);
  if (cut < limit * 0.5) cut = limit;
  let head = text.slice(0, cut).trimEnd();
  const fences = head.match(/^```/gm)?.length ?? 0;
  if (fences % 2) head = head.slice(0, head.lastIndexOf('```')).trimEnd();
  if ((head.match(/\*\*/g)?.length ?? 0) % 2) head = head.slice(0, head.lastIndexOf('**')).trimEnd();
  return head;
}

/**
 * A prompt's attachment markers (`[PHOTO path]`, `[FILE path]`, the Web's
 * tokenizeUserMessageText) split from its text: photos show as thumbnails, files as path chips.
 */
export function promptAttachments(text: string): { text: string; photos: string[]; files: string[] } {
  const photos: string[] = [], files: string[] = [];
  const rest = text.replace(/\[(PHOTO|FILE)\s+([^\]]+)\]/g, (whole, kind: string, raw: string) => {
    const path = raw.trim();
    if (!path) return whole;
    (kind === 'PHOTO' ? photos : files).push(path);
    return '';
  });
  return { text: rest.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), photos, files };
}

/**
 * Where a long prompt's preview ends (the Web's GraphChatUserMessageBody): at most 600
 * characters, 160 words or 8 lines; null when the prompt is short enough to show whole.
 */
export function promptPreviewEnd(text: string): number | null {
  const points = Array.from(text);
  const wordBoundary = [...text.matchAll(/\S+/gu)][160]?.index ?? text.length;
  const lineBoundary = text.split('\n').slice(0, 8).join('\n').length;
  const end = Math.min(points.slice(0, 600).join('').length, wordBoundary, lineBoundary);
  return end < text.length ? end : null;
}

/** How much a fold hides, rounded as the Web says it ("about 1,000 more characters"). */
export function hiddenAmount(hidden: number): number | null {
  if (hidden < 200) return null;
  return hidden < 1000 ? Math.round(hidden / 100) * 100 : Math.round(hidden / 1000) * 1000;
}
