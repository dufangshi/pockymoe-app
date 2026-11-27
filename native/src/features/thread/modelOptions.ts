// The models a thread (or a new thread's agent) can use, for the composer's model key: the
// key shows the model's display name as the Web does. Shared by every composer on the device
// for a minute, like the picker's own cache.
import { useEffect, useState } from 'react';
import type { ModelOptionDto } from '@pockymoe/shared';
import type { DeviceApi } from '../../protocol/api';
import type { AgentChoice } from './ModelPicker';

const cache = new Map<string, { at: number; request: Promise<ModelOptionDto[]> }>();

export function useModelOptions(api: DeviceApi | null, threadId: string | null, agent: AgentChoice, cwd?: string | null) {
  const [options, setOptions] = useState<ModelOptionDto[] | null>(null);
  const key = threadId ? `thread\u0000${threadId}` : `agent\u0000${agent.provider}\u0000${agent.agentId ?? ''}\u0000${cwd ?? ''}`;
  useEffect(() => {
    if (!api) return;
    let live = true;
    let hit = cache.get(key);
    if (!hit || Date.now() - hit.at > 60_000) {
      hit = { at: Date.now(), request: threadId ? api.threadModels(threadId) : api.runtimeModels(agent.provider, agent.agentId, cwd) };
      cache.set(key, hit);
      hit.request.catch(() => cache.delete(key));
    }
    hit.request.then(list => { if (live) setOptions(list); }, () => undefined);
    return () => { live = false; };
  }, [api, key, threadId, agent.provider, agent.agentId, cwd]);
  return options;
}
