import type { ThreadHistoryItemDto } from '@pockymoe/shared';
import type { TimelineHistoryEntry } from './timelineItems';

/** ACP often gives answers and progress the same message kind. Keep substantial
 * prose at its original position, without treating it as proof of completion.
 * Keep this predicate aligned with runtime/history.rs for lazy summaries. */
export function isSubstantiveAnswer(item: ThreadHistoryItemDto): boolean {
  if (item.kind !== 'agentMessage') return false;
  if (item.responsePhase === 'final') return true;
  const text = item.text.trim();
  const length = Array.from(text).length;
  return length >= 600 || (length >= 300 && (
    /^#{1,6}[ \t]/m.test(text) && text.split(/\n\s*\n/).length >= 3 ||
    text.split('\n').filter(line => /^\|.*\|$/.test(line.trim())).length >= 3
  ));
}

/** Preserve answer boundaries while collecting the surrounding progress/tools
 * into independent disclosures. Keys follow the preceding answer, so incoming
 * work and hydrated details do not reset an already-open section. */
export function groupAnswerSections(entries: TimelineHistoryEntry[], visibleAgentId?: string): TimelineHistoryEntry[] {
  const result: TimelineHistoryEntry[] = [];
  let work: TimelineHistoryEntry[] = [];
  let anchor = 'start';
  const flush = () => {
    if (!work.length) return;
    const flat = work.flatMap(entry => entry.kind === 'agentActivityGroup' ? entry.entries : [entry]);
    // A typed batch already has its own disclosure.
    if (flat.length === 1 && flat[0]!.kind !== 'item') result.push(flat[0]!);
    else result.push({
      kind: 'agentActivityGroup', key: `answer-work:${anchor}`, entries: flat,
      itemCount: flat.reduce((sum, entry) => sum + (entry.kind === 'item' ? 1 : entry.kind === 'agentActivityGroup' ? entry.itemCount : entry.items.length), 0),
    });
    work = [];
  };
  for (const entry of entries) {
    if (entry.kind === 'item' && (isSubstantiveAnswer(entry.item) || entry.item.id === visibleAgentId || (entry.item.origin === 'nativeBackgroundWait' && entry.item.status === 'waiting'))) {
      flush(); result.push(entry); anchor = entry.item.id;
    } else work.push(entry);
  }
  flush();
  return result;
}
