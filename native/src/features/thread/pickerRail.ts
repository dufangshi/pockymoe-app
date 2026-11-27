// The model picker's agent rail, keyed like threads (D20).
// A real Supervisor routes its ACP runtime: the list holds native `codex`/`claude`
// (acpAgent.harnessProtocol "native") and their ACP adapters already keyed `acp:codex`/`acp:claude`,
// and the API takes those ids as they are. An unrouted runtime (the fake runtime, lab proxies)
// lists the adapters as bare `codex`/`claude`; their threads are still keyed `acp:<id>`, so only
// then does the rail add the prefix, and the API keeps the list's own id.
import type { ModelOptionDto } from '@pockymoe/shared';
import { isAcpAgentKey } from '../../../vendor/pockymoe/thread-ui/components/themeAgent';

const NATIVE_AGENTS = ['codex', 'claude'];

export interface RailAgent {
  /** The thread key the rail compares with the thread's agent (`acp:claude`). */
  id: string;
  /** The id the API takes for this entry (the list's own). */
  apiId: string;
  entry: ModelOptionDto;
}

function protocolOf(entry: ModelOptionDto): string | undefined {
  const info = entry.acpAgent as { harnessProtocol?: unknown } | null | undefined;
  return typeof info?.harnessProtocol === 'string' ? info.harnessProtocol : undefined;
}

/** A list entry's thread key. */
export function railKey(entry: ModelOptionDto): string {
  const id = entry.model || entry.id;
  if (isAcpAgentKey(id) || protocolOf(entry) === 'native' || !NATIVE_AGENTS.includes(id)) return id;
  return `acp:${id}`;
}

/** The entries the rail offers: visible, ready (or the thread's own), each once by key. */
export function railAgents(options: ModelOptionDto[] | null | undefined, currentAgentId: string): RailAgent[] {
  const seen = new Set<string>();
  const out: RailAgent[] = [];
  for (const entry of options ?? []) {
    if (entry.hidden) continue;
    const id = railKey(entry);
    if ((entry.acpAgent?.availability ?? 'ready') !== 'ready' && id !== currentAgentId) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, apiId: entry.model || entry.id, entry });
  }
  return out;
}
