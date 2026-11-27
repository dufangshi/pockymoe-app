import type { ThreadHistoryItemDto, ThreadTurnActivityDto, ThreadTurnActivitySegmentDto, ThreadTurnChangedFileDto } from '@pockymoe/shared';
import { formatDurationMs } from './durationFormatting';
import { translate } from '../../i18n';

export type ActivityCounts = Required<Omit<ThreadTurnActivityDto, 'files' | 'segments'>>;

const EMPTY: ActivityCounts = {
  commands: 0, fileChanges: 0, changedFiles: 0, fileCount: 0, addedLines: 0, removedLines: 0,
  reads: 0, searches: 0, tools: 0, agents: 0, reasoning: 0, failed: 0,
};

const KEY_BY_KIND: Partial<Record<ThreadHistoryItemDto['kind'], keyof ActivityCounts>> = {
  commandExecution: 'commands',
  fileChange: 'fileChanges',
  fileRead: 'reads',
  webSearch: 'searches',
  toolCall: 'tools',
  skillToolCall: 'tools',
  agentToolCall: 'agents',
  reasoning: 'reasoning',
};

export type LogStatus = 'done' | 'running' | 'failed' | 'interrupted';

/** Harnesses report free-form statuses; the log only distinguishes these four. */
export function logStatus(status: string | null | undefined): LogStatus {
  const value = (status ?? '').trim().toLowerCase();
  if (/fail|error|declin|denied|reject/.test(value)) return 'failed';
  if (/interrupt|cancel|abort|stopp/.test(value)) return 'interrupted';
  if (/running|progress|pending|started/.test(value)) return 'running';
  return 'done';
}

/** Same counts as the Supervisor's summary of a folded turn (runtime service.rs). */
export function activityFromItems(items: readonly ThreadHistoryItemDto[]): ActivityCounts {
  const counts = { ...EMPTY };
  const paths = new Set<string>();
  for (const item of items) {
    const key = KEY_BY_KIND[item.kind];
    if (!key) continue;
    counts[key] += 1;
    if (logStatus(item.status) === 'failed') counts.failed += 1;
    if (item.kind === 'fileChange') {
      if (logStatus(item.status) !== 'failed') item.text.split(/,\s+/).filter(Boolean).forEach((path) => paths.add(path));
      counts.changedFiles += item.changedFiles ?? 0;
      counts.addedLines += item.addedLines ?? 0;
      counts.removedLines += item.removedLines ?? 0;
    }
  }
  counts.fileCount = paths.size;
  return counts;
}

/** A folded turn reports the Supervisor's counts. Items streamed since then can
    only add to them, so each count is the larger of the two. */
export function turnActivity(
  turn: { hasDeferredItems?: boolean | null; activity?: ThreadTurnActivityDto | null },
  items: readonly ThreadHistoryItemDto[],
): ActivityCounts | null {
  const loaded = activityFromItems(items);
  // Items loaded while a turn worked can be behind its summary, so the
  // Supervisor's counts win wherever they are larger.
  if (!turn.activity) return turn.hasDeferredItems && !hasActivity(loaded) ? null : loaded;
  const counts = { ...EMPTY };
  for (const key of Object.keys(EMPTY) as Array<keyof ActivityCounts>) counts[key] = turn.activity[key] ?? 0;
  for (const key of Object.keys(counts) as Array<keyof ActivityCounts>) counts[key] = Math.max(counts[key], loaded[key]);
  return counts;
}

export function hasActivity(counts: ActivityCounts | null): counts is ActivityCounts {
  return Boolean(counts && (counts.commands || counts.fileChanges || counts.reads || counts.searches || counts.tools || counts.agents || counts.reasoning));
}

export interface ActivityPart {
  key: string;
  /** The whole phrase, for assistive technology and plain-text use. */
  text: string;
  /** Counted kinds can show as an icon and this number. */
  count?: number;
  tone?: 'add' | 'remove' | 'failed';
}

/** The words of a work summary, most telling first: edits, commands, then lookups. */
export function activityParts(counts: ActivityCounts, { lines = true }: { lines?: boolean } = {}): ActivityPart[] {
  const parts: ActivityPart[] = [];
  if (counts.fileChanges) {
    parts.push({ key: 'edits', text: translate('chat.logEdits', { count: counts.fileCount || counts.changedFiles || counts.fileChanges }) });
    if (lines && counts.addedLines) parts.push({ key: 'added', text: `+${counts.addedLines}`, tone: 'add' });
    if (lines && counts.removedLines) parts.push({ key: 'removed', text: `−${counts.removedLines}`, tone: 'remove' });
  }
  if (counts.commands) parts.push({ key: 'commands', count: counts.commands, text: translate('chat.commandCount', { count: counts.commands }) });
  // Failures read with the commands they mostly are: ">_ ✓69 ✕9".
  if (counts.failed && counts.commands) parts.push({ key: 'failed', count: counts.failed, text: translate('chat.logFailed', { count: counts.failed }), tone: 'failed' });
  if (counts.reads) parts.push({ key: 'reads', count: counts.reads, text: translate('chat.readFileCount', { count: counts.reads }) });
  if (counts.searches) parts.push({ key: 'searches', count: counts.searches, text: translate('chat.logSearches', { count: counts.searches }) });
  if (counts.agents) parts.push({ key: 'agents', count: counts.agents, text: translate('chat.logAgents', { count: counts.agents }) });
  if (counts.tools) parts.push({ key: 'tools', count: counts.tools, text: translate('chat.logTools', { count: counts.tools }) });
  if (!parts.length && counts.reasoning) parts.push({ key: 'reasoning', count: counts.reasoning, text: translate('chat.logThoughts', { count: counts.reasoning }) });
  if (counts.failed && !counts.commands) parts.push({ key: 'failed', count: counts.failed, text: translate('chat.logFailed', { count: counts.failed }), tone: 'failed' });
  return parts;
}

/** Compact elapsed time, in the one duration format (durationFormatting). */
export function compactDuration(ms: number): string {
  return formatDurationMs(ms, { pad: false });
}

/** Elapsed time covered by a run of items, when their timestamps allow it. */
export function itemsDuration(items: readonly ThreadHistoryItemDto[]): number | null {
  let start = Infinity;
  let end = -Infinity;
  for (const item of items) {
    const created = Date.parse(item.createdAt ?? '');
    const updated = Date.parse(item.updatedAt ?? '');
    if (Number.isFinite(created)) { start = Math.min(start, created); end = Math.max(end, created); }
    if (Number.isFinite(updated)) end = Math.max(end, updated);
  }
  return Number.isFinite(start) && end > start ? end - start : null;
}

/** Tool details are stored as "Tool: …\n\nInput:\n…\n\nOutput:\n…"; the log shows the result. */
export function toolResultText(detail: string): string {
  const match = /(?:^|\n\n)(?:Output|Result):\n([\s\S]*)$/.exec(detail);
  if (!match) return detail.trim();
  const body = match[1]!.trim();
  if (body.startsWith('"') && body.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(body);
      if (typeof parsed === 'string') return parsed.trimEnd();
    } catch { /* not a JSON string literal */ }
  }
  return body.replace(/^```\w*\n([\s\S]*?)\n```$/, '$1');
}

/** Files a turn changed: the Supervisor's list for a folded turn, else the loaded edits. */
export function turnChangedFiles(
  turn: { hasDeferredItems?: boolean | null; activity?: ThreadTurnActivityDto | null },
  items: readonly ThreadHistoryItemDto[],
): ThreadTurnChangedFileDto[] {
  if (turn.hasDeferredItems || turn.activity?.files) return turn.activity?.files ?? [];
  const files: ThreadTurnChangedFileDto[] = [];
  for (const item of items) {
    if (item.kind !== 'fileChange' || logStatus(item.status) === 'failed') continue;
    item.text.split(/,\s+/).filter(Boolean).forEach((path, index) => {
      const added = index === 0 ? item.addedLines ?? 0 : 0;
      const removed = index === 0 ? item.removedLines ?? 0 : 0;
      const file = files.find((entry) => entry.path === path);
      if (file) {
        file.itemId = item.id;
        file.addedLines = (file.addedLines ?? 0) + added;
        file.removedLines = (file.removedLines ?? 0) + removed;
      } else files.push({ path, itemId: item.id, addedLines: added, removedLines: removed });
    });
  }
  return files;
}

/** Counts of one stretch of work, ready for `activityParts`. */
export function segmentCounts(segment: ThreadTurnActivitySegmentDto): ActivityCounts {
  const counts = { ...EMPTY };
  for (const key of Object.keys(EMPTY) as Array<keyof ActivityCounts>) {
    if (key !== 'fileCount') counts[key] = segment[key] ?? 0;
  }
  return counts;
}

/** A folded turn can be told as narration between runs without loading its
    operations when its summary carries the narration every stretch precedes. */
export function storySegments(turn: {
  hasDeferredItems?: boolean | null;
  activity?: ThreadTurnActivityDto | null;
  items: readonly ThreadHistoryItemDto[];
}): ThreadTurnActivitySegmentDto[] | null {
  const segments = turn.activity?.segments;
  if (!turn.hasDeferredItems || !segments?.length) return null;
  const ids = new Set(turn.items.map((item) => item.id));
  return segments.every((segment) => segment.before === null || ids.has(segment.before)) ? segments : null;
}

/** The work between two conversation items as one stretch: the Supervisor's
    stretches after `afterId` up to the one that precedes `beforeId` (null = the
    turn's start or end). Null when the summary has no stretches there. */
export function stretchBetween(
  segments: readonly ThreadTurnActivitySegmentDto[] | null | undefined,
  afterId: string | null,
  beforeId: string | null,
): ThreadTurnActivitySegmentDto | null {
  if (!segments?.length) return null;
  const picked: ThreadTurnActivitySegmentDto[] = [];
  let collecting = afterId === null;
  for (const segment of segments) {
    if (collecting) picked.push(segment);
    if (collecting && segment.before === beforeId) break;
    if (!collecting && segment.before === afterId) collecting = true;
  }
  if (!picked.length || (beforeId !== null && picked.at(-1)!.before !== beforeId)) return null;
  const merged = { before: beforeId } as ThreadTurnActivitySegmentDto;
  for (const key of Object.keys(EMPTY) as Array<keyof ActivityCounts>) {
    if (key === 'fileCount') continue;
    const total = picked.reduce((sum, segment) => sum + (segment[key] ?? 0), 0);
    if (total) merged[key] = total;
  }
  const startedAt = picked.find((segment) => segment.startedAt)?.startedAt;
  const endedAt = picked.findLast((segment) => segment.endedAt)?.endedAt;
  if (startedAt) merged.startedAt = startedAt;
  if (endedAt) merged.endedAt = endedAt;
  return merged;
}

/** A stretch from loaded operations, for turns whose summary has none. */
export function stretchFromItems(items: readonly ThreadHistoryItemDto[], beforeId: string | null): ThreadTurnActivitySegmentDto | null {
  const counts = activityFromItems(items);
  if (!hasActivity(counts)) return null;
  const merged = { before: beforeId } as ThreadTurnActivitySegmentDto;
  for (const key of Object.keys(EMPTY) as Array<keyof ActivityCounts>) {
    if (key !== 'fileCount' && counts[key]) merged[key] = counts[key];
  }
  const times = items.flatMap((item) => [item.createdAt, item.updatedAt]).filter((time): time is string => Boolean(time)).sort();
  if (times.length) { merged.startedAt = times[0]!; merged.endedAt = times.at(-1)!; }
  return merged;
}

/** Elapsed time of one stretch of work, when the Supervisor reported it. */
export function segmentDuration(segment: ThreadTurnActivitySegmentDto): number | null {
  const start = Date.parse(segment.startedAt ?? '');
  const end = Date.parse(segment.endedAt ?? '');
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : null;
}
