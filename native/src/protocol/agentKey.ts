// Agent keys (docs/native-harnesses.md "Choosing a protocol"): `codex` and `claude` run
// natively, `acp:codex` / `acp:claude` use the ACP adapters, any other id is an ACP agent.
// The rules come from the shared UI (vendored themeAgent); this file adds what the lists need.
import type { ModelOptionDto } from '@pockymoe/shared';
import { agentDisplayName, isAcpAgentKey, threadAgentKey } from '../../vendor/pockymoe/thread-ui/components/themeAgent';

export { threadAgentKey };

/** True for an ACP variant of an agent that also runs natively (`acp:codex`). */
export const isAdapterKey = (key: string | null | undefined) => isAcpAgentKey(key);

/** An entry of `GET api/agent-runtimes/acp/agents` runs natively (Codex, Claude on new runtimes). */
export function isNativeEntry(entry: Pick<ModelOptionDto, 'acpAgent'>) {
  return (entry.acpAgent as { harnessProtocol?: string } | null | undefined)?.harnessProtocol === 'native';
}

/** "ACP · Codex" for an adapter, so a list naming Codex twice says which is which. */
export function agentEntryLabel(entry: Pick<ModelOptionDto, 'id' | 'model' | 'displayName'>) {
  return agentDisplayName(entry.model || entry.id, entry.displayName);
}

/** The name for an agent key: "ACP · Codex" for `acp:codex`, else the agent's family name. */
export const agentKeyName = (key: string) => agentDisplayName(key);
