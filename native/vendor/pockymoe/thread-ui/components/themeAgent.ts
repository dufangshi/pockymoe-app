/* The canonical agent key that themes use for agent art (`[data-agent="…"]`).
   Thread ids ("claude-code", "dsh"), harness labels ("Claude Code", "GitHub
   Copilot CLI") and providers all map to the same key, so a theme pack only
   needs one entry per agent family. */

const AGENT_FAMILIES: readonly (readonly [key: string, matches: (value: string) => boolean])[] = [
  ['claude', (value) => value.includes('claude')],
  ['opencode', (value) => value.includes('opencode')],
  ['codex', (value) => value.includes('codex')],
  ['deepseek', (value) => value.includes('deepseek') || value === 'dsh'],
  ['copilot', (value) => value.includes('copilot')],
  ['gemini', (value) => value.includes('gemini')],
  ['grok', (value) => value.includes('grok')],
  ['cursor', (value) => value.includes('cursor')],
  ['qwen', (value) => value.includes('qwen')],
  ['kimi', (value) => value.includes('kimi')],
];

const AGENT_NAMES: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  copilot: 'Copilot',
  cursor: 'Cursor',
  deepseek: 'DeepSeek',
  gemini: 'Gemini',
  grok: 'Grok',
  kimi: 'Kimi',
  opencode: 'OpenCode',
  qwen: 'Qwen',
};

/** Keys a theme pack may declare art for: lowercase letters and digits in dash-separated words. */
export const THEME_AGENT_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The theme agent key for a thread's agent id, provider or harness label;
 *  undefined for nothing or the bare `acp` provider. */
export function themeAgentKey(value: string | null | undefined): string | undefined {
  // An ACP variant (`acp:codex`) keeps its agent's art.
  const normalized = (value ?? '').trim().toLowerCase().replace(/^acp:/, '');
  if (!normalized || normalized === 'acp') return undefined;
  const family = AGENT_FAMILIES.find(([, matches]) => matches(normalized));
  if (family) return family[0];
  const slug = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  return slug || undefined;
}

/** The key for a thread: its agent id, else its provider. */
export function threadThemeAgentKey(thread: { provider?: string | null; agentId?: string | null }) {
  return themeAgentKey(thread.agentId || thread.provider);
}

/** Display name for an agent: the family name, else the raw id in title case.
 *  An ACP variant's key (`acp:codex`) is named as one: "ACP · Codex". */
export function themeAgentName(raw: string, key = themeAgentKey(raw)): string {
  if (isAcpAgentKey(raw)) return agentDisplayName(raw, themeAgentName(agentKeyBase(raw), key));
  if (key && AGENT_NAMES[key]) return AGENT_NAMES[key];
  return raw.trim().toLowerCase().replace(/(^|[-_ ])(\w)/g, (_, gap: string, letter: string) => `${gap ? ' ' : ''}${letter.toUpperCase()}`);
}

/* Agent keys. Codex and Claude run natively by default; a thread created under the
   ACP agent runs them through their ACP adapter instead and is keyed `acp:codex` /
   `acp:claude`. Every client passes the key where it passes an agent id (thread
   creation, models, harness switch and fork); `agentId` itself stays `codex`. */
const ACP_AGENT_PREFIX = 'acp:';
export type HarnessProtocol = 'native' | 'acp';

/** The key of an agent id run over a protocol: `acp:codex` for ACP Codex, else the id. */
export function agentKeyOf(agentId: string, protocol?: HarnessProtocol | null) {
  return protocol === 'acp' && !isAcpAgentKey(agentId) ? `${ACP_AGENT_PREFIX}${agentId}` : agentId;
}

/** A thread's agent key: its agent id (else a legacy Codex/Claude provider) over its protocol. */
export function threadAgentKey(thread: { provider?: string | null; agentId?: string | null; harnessProtocol?: HarnessProtocol | null }): string | null {
  const agentId = thread.agentId || (thread.provider === 'codex' || thread.provider === 'claude' ? thread.provider : null);
  return agentId ? agentKeyOf(agentId, thread.harnessProtocol) : null;
}

/** True for an ACP variant of an agent that also runs natively (`acp:codex`). */
export function isAcpAgentKey(key: string | null | undefined): boolean {
  return Boolean(key?.startsWith(ACP_AGENT_PREFIX));
}

/** The agent id behind a key: `codex` for `acp:codex`. */
export function agentKeyBase(key: string) {
  return isAcpAgentKey(key) ? key.slice(ACP_AGENT_PREFIX.length) : key;
}

/** The one label rule for naming an agent by its key: the agent's own name (`name`,
 *  else its family name), prefixed "ACP · " for an ACP variant. Native and ACP-only
 *  agents keep their name unchanged. */
export function agentDisplayName(key: string, name?: string | null): string {
  const base = name?.trim() || themeAgentName(agentKeyBase(key));
  return isAcpAgentKey(key) ? `ACP · ${base}` : base;
}
