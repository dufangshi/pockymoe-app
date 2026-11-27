import { describe, expect, it } from 'vitest';
import type { ModelOptionDto } from '@pockymoe/shared';
import { railAgents } from './pickerRail';

const entry = (id: string, protocol?: string, availability = 'ready') => ({
  id, model: id, displayName: id, description: '', isDefault: false, hidden: false, supportedReasoningEfforts: [], defaultReasoningEffort: null,
  acpAgent: { availability, ...(protocol ? { harnessProtocol: protocol } : {}) },
}) as unknown as ModelOptionDto;

describe('railAgents', () => {
  it('keeps a routed Supervisor list as it is', () => {
    const list = [entry('codex', 'native'), entry('claude', 'native'), entry('acp:codex', 'acp'), entry('acp:claude', 'acp'), entry('opencode', 'acp')];
    const rail = railAgents(list, 'acp:claude');
    expect(rail.map(a => a.id)).toEqual(['codex', 'claude', 'acp:codex', 'acp:claude', 'opencode']);
    expect(rail.map(a => a.apiId)).toEqual(['codex', 'claude', 'acp:codex', 'acp:claude', 'opencode']);
  });
  it('keys bare adapters of an unrouted list like their threads', () => {
    const rail = railAgents([entry('codex'), entry('claude', 'acp'), entry('deepseek')], 'acp:claude');
    expect(rail.map(a => a.id)).toEqual(['acp:codex', 'acp:claude', 'deepseek']);
    expect(rail.map(a => a.apiId)).toEqual(['codex', 'claude', 'deepseek']);
  });
  it('drops unready entries except the thread own', () => {
    const rail = railAgents([entry('acp:claude', 'acp', 'adapter_missing'), entry('opencode', 'acp', 'base_missing')], 'acp:claude');
    expect(rail.map(a => a.id)).toEqual(['acp:claude']);
  });
});
