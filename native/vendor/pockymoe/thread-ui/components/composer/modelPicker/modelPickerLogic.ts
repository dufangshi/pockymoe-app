import type { ModelOptionDto, ReasoningEffortDto } from '@pockymoe/shared';

/** An agent the model picker can show: its id on the device and its name. */
export interface ModelPickerAgent {
  id: string;
  name: string;
}

/** Facts a row shows beside a model's name, all optional. */
export interface ModelFacts {
  contextWindow?: number | undefined;
  inputUsdPerMillion?: number | undefined;
  outputUsdPerMillion?: number | undefined;
}

/** What a switch would hand to the new agent (the device's harness preview). */
export interface HandoffSummary {
  turns: number;
  omittedTurns?: number | undefined;
  estimatedTokens: number;
  resumesSession: boolean;
  text: string;
}

export interface ModelSwitchTarget {
  agentId: string;
  model: string;
  reasoningEffort: ReasoningEffortDto | null;
}

/** Moves a thread to another agent from the composer's model picker. */
export interface ComposerModelSwitching {
  currentAgentId: string;
  /** Agents ready on the device, the current one included. */
  agents: ModelPickerAgent[];
  loadModels: (agentId: string) => Promise<ModelOptionDto[]>;
  preview: (target: { agentId: string; model: string | null }) => Promise<HandoffSummary>;
  /** `stop` interrupts the running turn and waits for it before switching. */
  switchTo: (target: ModelSwitchTarget & { stop: boolean }) => Promise<void>;
  /** Forks the thread into a new one on another agent, through `turnId` or the latest turn. */
  fork?: ((target: { agentId: string; turnId: string | null }) => Promise<void>) | undefined;
}

/** What the host gives the composer's model picker beyond the current models. */
export interface ComposerModelPickerSource {
  facts?: ((model: ModelOptionDto) => ModelFacts | null) | undefined;
  /** Present only when this reader may change the thread's agent. */
  switching?: ComposerModelSwitching | undefined;
}

/** The current agent first, then the rest in the device's order, without repeats. */
export function orderPickerAgents(agents: ModelPickerAgent[], currentAgentId: string) {
  const seen = new Set<string>();
  const unique = agents.filter((agent) => !seen.has(agent.id) && Boolean(seen.add(agent.id)));
  const current = unique.find((agent) => agent.id === currentAgentId);
  return current ? [current, ...unique.filter((agent) => agent !== current)] : unique;
}

/** Models a reader picks from: hidden ones only when current. */
export function visiblePickerModels(models: ModelOptionDto[], currentModel?: string | null) {
  return models.filter((model) => !model.hidden || model.model === currentModel);
}

/** The model a pick of an agent lands on when no model is named: its default, else its first. */
export function defaultPickerModel(models: ModelOptionDto[]) {
  return models.find((model) => model.isDefault && !model.hidden) ?? models.find((model) => !model.hidden) ?? models[0];
}

const fold = (value: string) => value.normalize('NFKD').toLowerCase();

/**
 * How well a model matches a search, higher is better; 0 is no match. Every
 * word of the query must appear in the model's name, id or agent name; a name
 * starting with the query ranks first, then word starts, then anywhere.
 */
export function modelSearchScore(query: string, model: Pick<ModelOptionDto, 'displayName' | 'model'>, agentName = '') {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const name = fold(model.displayName || model.model);
  const haystack = `${name} ${fold(model.model)} ${fold(agentName)}`;
  if (!words.every((word) => haystack.includes(word))) return 0;
  const whole = words.join(' ');
  if (name.startsWith(whole)) return 4;
  if (words.every((word) => new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(name))) return 3;
  if (words.every((word) => name.includes(word))) return 2;
  return 1;
}

export interface PickerGroup {
  agent: ModelPickerAgent;
  models: ModelOptionDto[];
}

/** Each agent's matching models, best first; agents without a match drop out. */
export function searchPickerGroups(groups: PickerGroup[], query: string): PickerGroup[] {
  return groups
    .map((group) => ({
      agent: group.agent,
      models: group.models
        .map((model, index) => ({ model, index, score: modelSearchScore(query, model, group.agent.name) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map((entry) => entry.model),
    }))
    .filter((group) => group.models.length > 0);
}

/** The next agent in the rail, wrapping, for ←/→. */
export function adjacentPickerAgent(agents: ModelPickerAgent[], current: string, direction: 1 | -1) {
  if (!agents.length) return current;
  const index = agents.findIndex((agent) => agent.id === current);
  return agents[(Math.max(0, index) + direction + agents.length) % agents.length]!.id;
}

/** "1M", "272K", "200K": a context window in tokens, compact. */
export function formatContextWindow(tokens: number | undefined) {
  if (!tokens || !Number.isFinite(tokens) || tokens <= 0) return null;
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${millions >= 10 || Math.abs(millions - Math.round(millions)) < 0.06 ? Math.round(millions) : millions.toFixed(1)}M`;
  }
  return `${Math.round(tokens / 1000)}K`;
}

/** "$2", "$0.2", "$1.25": a price per million tokens. */
export function formatUsdPerMillion(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value) || value < 0) return null;
  const text = value >= 10 ? String(Math.round(value)) : String(Number(value.toFixed(2)));
  return `$${text}`;
}

/** Input and output prices as one short cell, "$2 · $10". */
export function formatModelPrice(facts: ModelFacts | null | undefined) {
  const input = formatUsdPerMillion(facts?.inputUsdPerMillion);
  const output = formatUsdPerMillion(facts?.outputUsdPerMillion);
  if (!input && !output) return null;
  return `${input ?? '–'} · ${output ?? '–'}`;
}

type PriceRates = {
  inputUsdPerMillion?: unknown;
  outputUsdPerMillion?: unknown;
  contextWindowTokens?: unknown;
  aliases?: unknown;
  unpriced?: unknown;
};

const normalized = (value: string) => [...value.toLowerCase()].filter((c) => /[\p{L}\p{N}]/u.test(c)).join('');
const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/**
 * The catalog entry for a model id, matched like the device's cost estimate
 * (`crates/protocol/src/pricing.rs`, `match_plain_model`): exact key, the last
 * path segment, a key or alias equal after dropping punctuation and case, or a
 * key followed by a dated snapshot suffix.
 */
export function matchPricedModel(models: Record<string, PriceRates>, raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  for (const candidate of new Set([trimmed, trimmed.split('/').pop()!.trim()])) {
    if (models[candidate] && models[candidate].unpriced !== true) return candidate;
    const key = normalized(candidate);
    for (const [id, rates] of Object.entries(models)) {
      if (rates.unpriced === true) continue;
      if (normalized(id) === key) return id;
      if (Array.isArray(rates.aliases) && rates.aliases.some((alias) => typeof alias === 'string' && normalized(alias) === key)) return id;
    }
    const lower = candidate.toLowerCase();
    for (const [id, rates] of Object.entries(models)) {
      if (rates.unpriced === true) continue;
      const prefix = `${id.toLowerCase()}-`;
      if (!lower.startsWith(prefix)) continue;
      const digits = lower.slice(prefix.length).replace(/-/g, '');
      if ((digits.length === 4 || digits.length === 8) && /^\d+$/.test(digits)) return id;
    }
  }
  return undefined;
}

/** A model's facts from a pricing catalog (`GET api/config/model-pricing`), by id then name. */
export function modelFactsFromCatalog(catalog: { models?: Record<string, PriceRates> } | null | undefined, model: Pick<ModelOptionDto, 'model' | 'displayName'>): ModelFacts | null {
  const models = catalog?.models;
  if (!models) return null;
  const key = matchPricedModel(models, model.model) ?? (model.displayName ? matchPricedModel(models, model.displayName) : undefined);
  if (!key) return null;
  const rates = models[key]!;
  const facts: ModelFacts = {
    contextWindow: number(rates.contextWindowTokens),
    inputUsdPerMillion: number(rates.inputUsdPerMillion),
    outputUsdPerMillion: number(rates.outputUsdPerMillion),
  };
  return facts.contextWindow === undefined && facts.inputUsdPerMillion === undefined && facts.outputUsdPerMillion === undefined ? null : facts;
}

type GitStateFile = { path?: unknown };
/**
 * The handoff text for reading: its `Current Git state:` JSON becomes a short
 * summary (branch, ahead/behind, changed files). Display only: the text handed
 * to the agent, and the one copied, stays as the device wrote it.
 */
export function readableHandoffText(text: string) {
  return text.replace(/^(Current Git state:)[ \t]*\n?[ \t]*(\{[^\n]*\})[ \t]*$/m, (whole, label: string, raw: string) => {
    let state: Record<string, unknown>;
    try {
      state = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return whole;
    }
    const files = (Array.isArray(state.files) ? state.files as GitStateFile[] : [])
      .map((file) => (typeof file.path === 'string' ? file.path : null))
      .filter((path): path is string => Boolean(path));
    const conflicted = Array.isArray(state.conflicted) ? state.conflicted.filter((path): path is string => typeof path === 'string') : [];
    const ahead = Number(state.ahead) || 0;
    const behind = Number(state.behind) || 0;
    const branch = typeof state.branch === 'string' ? state.branch : typeof state.head === 'string' ? `detached at ${state.head.slice(0, 8)}` : 'no branch';
    const upstream = typeof state.upstream === 'string' ? ` → ${state.upstream}` : '';
    const list = (paths: string[]) => `${paths.slice(0, 5).join(', ')}${paths.length > 5 ? ` (+${paths.length - 5} more)` : ''}`;
    const lines = [
      // Ahead and behind mean something only against an upstream.
      `Branch ${branch}${upstream}${upstream ? ` · ${ahead || behind ? `ahead ${ahead} · behind ${behind}` : 'in sync'}` : ''}`,
      files.length ? `${files.length} changed ${files.length === 1 ? 'file' : 'files'}${state.truncated === true ? '+' : ''}: ${list(files)}` : 'No uncommitted changes',
      conflicted.length ? `Conflicts: ${list(conflicted)}` : '',
      typeof state.operation === 'string' && state.operation ? `In progress: ${state.operation}` : '',
      Number(state.stashCount) > 0 ? `Stashes: ${Number(state.stashCount)}` : '',
    ].filter(Boolean);
    return `${label}\n${lines.join('\n')}`;
  });
}
