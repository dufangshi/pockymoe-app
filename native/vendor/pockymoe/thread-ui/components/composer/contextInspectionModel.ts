import type {
  ContextInspectionCategoryDto,
  ContextInspectionGroupItemDto,
  ContextInspectionSnapshotDto,
  ThreadContextUsageDto,
} from '@pockymoe/shared';

import { translate, type TranslationKey } from '../../i18n';

export interface ContextReading {
  used: number;
  window: number;
  updatedAt: string | null;
}

export interface ContextSegment {
  id: string;
  label: string;
  /** Palette slot (1-8); 0 is the neutral of unattributed and unknown categories. */
  slot: number;
  tokens: number;
}

/** A hue belongs to a group of categories, whichever others are present, and the
    groups keep one order so neighbours stay the validated adjacent pairs:
    1 system, 2 tool definitions, 3 memory, 4 skills, 5 the user, 6 the model's
    own output, 7 tool results, 8 what the harness injected. */
const USED_CATEGORIES: Record<string, { slot: number; label: TranslationKey; rank: number }> = {
  system_prompt: { slot: 1, label: 'chat.contextCategorySystemPrompt', rank: 1 },
  mcp_instructions: { slot: 1, label: 'chat.contextCategoryMcpInstructions', rank: 2 },
  runtime_context: { slot: 1, label: 'chat.contextCategoryRuntime', rank: 3 },
  custom_agents: { slot: 1, label: 'chat.contextCategoryAgents', rank: 4 },
  // What the provider counts beyond the request's own content, every request.
  provider_overhead: { slot: 1, label: 'chat.contextCategoryProviderOverhead', rank: 4.5 },
  system_tools: { slot: 2, label: 'chat.contextCategorySystemTools', rank: 5 },
  tools: { slot: 2, label: 'chat.contextCategoryTools', rank: 5 },
  mcp_tools: { slot: 2, label: 'chat.contextCategoryMcpTools', rank: 6 },
  memory_files: { slot: 3, label: 'chat.contextCategoryMemory', rank: 7 },
  skills: { slot: 4, label: 'chat.contextCategorySkills', rank: 8 },
  user_messages: { slot: 5, label: 'chat.contextCategoryUserMessages', rank: 9 },
  assistant_messages: { slot: 6, label: 'chat.contextCategoryAssistantMessages', rank: 10 },
  reasoning: { slot: 6, label: 'chat.contextCategoryReasoning', rank: 11 },
  tool_calls: { slot: 6, label: 'chat.contextCategoryToolCalls', rank: 12 },
  // A conversation its collector does not split: drawn as the model's side.
  messages: { slot: 6, label: 'chat.contextCategoryMessages', rank: 13 },
  tool_results: { slot: 7, label: 'chat.contextCategoryToolResults', rank: 14 },
  injected: { slot: 8, label: 'chat.contextCategoryInjected', rank: 15 },
  unattributed: { slot: 0, label: 'chat.contextCategoryUnattributed', rank: 20 },
};
const OTHER_LABELS: Record<string, TranslationKey> = {
  free_space: 'chat.contextCategoryFree',
  autocompact_buffer: 'chat.contextCategoryBuffer',
  system_tools_deferred: 'chat.contextCategorySystemToolsDeferred',
  mcp_tools_deferred: 'chat.contextCategoryMcpToolsDeferred',
  custom_agents: 'chat.contextCategoryAgents',
  mcp_tools: 'chat.contextCategoryMcpTools',
  mcp_instructions: 'chat.contextCategoryMcpInstructions',
  memory_files: 'chat.contextCategoryMemory',
  skills: 'chat.contextCategorySkills',
  system_tools: 'chat.contextCategorySystemTools',
};

export function contextCategoryLabel(entry: { id: string; label?: string | null }) {
  const key = USED_CATEGORIES[entry.id]?.label ?? OTHER_LABELS[entry.id];
  return key ? translate(key) : entry.label || entry.id;
}

export function contextCategorySlot(id: string) {
  return USED_CATEGORIES[id]?.slot ?? 0;
}

const validCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function readingFromUsage(usage: ThreadContextUsageDto | null | undefined): ContextReading | null {
  if (usage?.availability !== 'available') return null;
  const { tokensInContextWindow: used, modelContextWindow: window } = usage;
  if (!validCount(used) || !validCount(window) || window <= 0) return null;
  return { used, window, updatedAt: usage.updatedAt };
}

export function readingFromSnapshot(snapshot: ContextInspectionSnapshotDto | null | undefined): ContextReading | null {
  if (!snapshot || !validCount(snapshot.usedTokens) || !validCount(snapshot.windowTokens) || snapshot.windowTokens <= 0) return null;
  return { used: snapshot.usedTokens, window: snapshot.windowTokens, updatedAt: snapshot.updatedAt };
}

const timeOf = (value: string | null | undefined) => {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : 0;
};

/** Which analysis to show: the newer one, except that Claude's summary does not
    replace a full count of the same context, whose categories are measured. */
export function preferredSnapshot(
  current: ContextInspectionSnapshotDto | null | undefined,
  next: ContextInspectionSnapshotDto | null | undefined,
) {
  current = usableSnapshot(current);
  next = usableSnapshot(next);
  if (!current || !next) return current ?? next ?? null;
  const [full, summary] = current.source === 'claudeFull' ? [current, next] : [next, current];
  if (full.source === 'claudeFull' && summary.source === 'claudeSummary' && full.usedTokens === summary.usedTokens) return full;
  return timeOf(next.updatedAt) >= timeOf(current.updatedAt) ? next : current;
}

/** Older Codex collectors tokenized inline media and could persist categories
    far above native occupancy. Keep the native meter during a rolling upgrade,
    without presenting that corrupted cache as a valid composition. */
function usableSnapshot(snapshot: ContextInspectionSnapshotDto | null | undefined) {
  if (snapshot?.source !== 'codexTrace') return snapshot;
  if (snapshot.compositionTokens != null) return snapshot;
  const sum = snapshot.categories.filter(entry => entry.kind === 'used')
    .reduce((sum, entry) => sum + entry.tokens, 0);
  return sum > snapshot.usedTokens ? null : snapshot;
}

/** These are integer token counts, not rounded display values. A newer native
    total or window always takes precedence over an older analysis. */
export function totalMovedOn(snapshot: ContextReading | null, base: ContextReading | null) {
  if (!snapshot || !base || timeOf(base.updatedAt) <= timeOf(snapshot.updatedAt)) return false;
  return base.used !== snapshot.used || base.window !== snapshot.window;
}

export function currentReading(snapshot: ContextReading | null, base: ContextReading | null) {
  return totalMovedOn(snapshot, base) ? base : snapshot ?? base;
}

export function contextPercent(used: number, window: number) {
  return window > 0 ? Math.max(0, Math.min(100, (used / window) * 100)) : 0;
}

/** Whole percents; anything above nothing never reads as 0%. */
export function formatContextPercent(used: number, window: number, detailed = false) {
  const percent = contextPercent(used, window);
  if (detailed) return percent > 0 && percent < 0.1 ? '<0.1%' : `${Number(percent.toFixed(1))}%`;
  if (percent > 0 && percent < 1) return '<1%';
  return `${Math.round(percent)}%`;
}

/** A category's share: one decimal while it is small. */
export function formatContextShare(tokens: number, window: number) {
  const percent = contextPercent(tokens, window);
  if (percent > 0 && percent < 0.1) return '<0.1%';
  return percent < 10 ? `${Number(percent.toFixed(1))}%` : `${Math.round(percent)}%`;
}

export function formatContextTokens(value: number) {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`;
  if (value >= 1000) return `${Number((value / 1000).toFixed(1))}k`;
  return String(Math.round(value));
}

export function contextTone(used: number, window: number) {
  const percent = contextPercent(used, window);
  return percent >= 80 ? 'danger' : percent >= 60 ? 'warning' : 'normal';
}

export function segmentOf(category: ContextInspectionCategoryDto): ContextSegment {
  return {
    id: category.id,
    label: contextCategoryLabel(category),
    slot: contextCategorySlot(category.id),
    tokens: Math.max(0, category.tokens),
  };
}

export function arrangeContextCategories(snapshot: ContextInspectionSnapshotDto) {
  const of = (kind: ContextInspectionCategoryDto['kind']) =>
    snapshot.categories.filter((entry) => entry.kind === kind && validCount(entry.tokens));
  const rank = (entry: ContextInspectionCategoryDto) => USED_CATEGORIES[entry.id]?.rank ?? 19;
  return {
    used: of('used').map((entry, index) => ({ entry, index }))
      .sort((a, b) => rank(a.entry) - rank(b.entry) || a.index - b.index).map(({ entry }) => entry),
    buffer: of('buffer'),
    free: of('free'),
    deferred: of('deferred'),
  };
}

/** Which listed items sit behind which category. The tool groups hold loaded and
    deferred tools together; they split along the same line as the categories.
    Groups no category claims are returned as `rest`. */
export function contextCategoryItems(snapshot: ContextInspectionSnapshotDto) {
  const items = new Map<string, ContextInspectionGroupItemDto[]>();
  const rest: { id: string; label: string; items: ContextInspectionGroupItemDto[] }[] = [];
  const present = new Set(snapshot.categories.map((entry) => entry.id));
  const sorted = (list: ContextInspectionGroupItemDto[]) => [...list].sort((a, b) => b.tokens - a.tokens);
  for (const group of snapshot.groups ?? []) {
    if (!group.items?.length) continue;
    const deferredId = `${group.id}_deferred`;
    const deferred = present.has(deferredId) ? group.items.filter((item) => item.loaded === false) : [];
    const loaded = deferred.length ? group.items.filter((item) => item.loaded !== false) : group.items;
    if (deferred.length) items.set(deferredId, sorted(deferred));
    if (!loaded.length) continue;
    if (present.has(group.id)) items.set(group.id, sorted(loaded));
    else rest.push({ id: group.id, label: contextCategoryLabel(group), items: sorted(loaded) });
  }
  return { items, rest };
}

/** "just now", "12s ago", "3m ago", "2h ago", "4d ago". */
export function contextAge(value: string | null | undefined, now = Date.now()) {
  const time = timeOf(value);
  if (!time) return null;
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 5) return translate('chat.contextUpdatedNow');
  if (seconds < 60) return translate('chat.contextUpdatedSeconds', { value1: seconds });
  if (seconds < 3600) return translate('chat.contextUpdatedMinutes', { value1: Math.floor(seconds / 60) });
  if (seconds < 86400) return translate('chat.contextUpdatedHours', { value1: Math.floor(seconds / 3600) });
  return translate('chat.contextUpdatedDays', { value1: Math.floor(seconds / 86400) });
}
