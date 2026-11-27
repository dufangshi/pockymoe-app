import { describe, expect, it } from 'vitest';
import { agentEntryLabel, agentKeyName, isAdapterKey, isNativeEntry, threadAgentKey } from '../../src/protocol/agentKey';
import { worktreeFieldError, worktreeNameFrom, worktreePath } from '../../src/features/thread/worktree';

describe('agent keys (native Codex/Claude by default)', () => {
  it('routes an ACP Codex thread on acp:codex and keeps the plain id otherwise', () => {
    expect(threadAgentKey({ provider: 'acp', agentId: 'codex', harnessProtocol: 'acp' })).toBe('acp:codex');
    expect(threadAgentKey({ provider: 'acp', agentId: 'claude', harnessProtocol: 'native' })).toBe('claude');
    // ACP-only agents carry no harnessProtocol.
    expect(threadAgentKey({ provider: 'acp', agentId: 'opencode' })).toBe('opencode');
    // Older runtimes send no harnessProtocol.
    expect(threadAgentKey({ provider: 'acp', agentId: 'codex' })).toBe('codex');
    // A legacy Codex-provider thread is keyed by its provider (the shared UI's rule).
    expect(threadAgentKey({ provider: 'codex', agentId: null })).toBe('codex');
    expect(threadAgentKey({ provider: 'acp', agentId: null })).toBeNull();
  });
  it('labels the adapters so a list naming Codex twice says which is which', () => {
    expect(agentEntryLabel({ id: 'acp:codex', model: 'acp:codex', displayName: 'Codex' })).toBe('ACP · Codex');
    expect(agentEntryLabel({ id: 'acp:claude', model: 'acp:claude', displayName: 'Claude Code' })).toBe('ACP · Claude Code');
    expect(agentEntryLabel({ id: 'codex', model: 'codex', displayName: 'Codex' })).toBe('Codex');
    expect(agentKeyName('acp:claude')).toBe('ACP · Claude');
    expect(agentKeyName('codex')).toBe('Codex');
    expect(isAdapterKey('codex')).toBe(false);
  });
  it('tells native entries from ACP ones', () => {
    expect(isNativeEntry({ acpAgent: { harnessProtocol: 'native' } as never })).toBe(true);
    expect(isNativeEntry({ acpAgent: { harnessProtocol: 'acp' } as never })).toBe(false);
    expect(isNativeEntry({ acpAgent: null })).toBe(false);
  });
});

describe('new thread worktree', () => {
  it('names the worktree after the first line of the prompt', () => {
    expect(worktreeNameFrom('Fix the login bug\nmore')).toBe('fix-the-login-bug');
    expect(worktreeNameFrom('  \n2 bugs: Login & Settings!')).toBe('bugs-login-settings');
    expect(worktreeNameFrom('[PHOTO a.png] look at this')).toBe('look-at-this');
    expect(worktreeNameFrom('修复登录')).toBeNull();
    expect(worktreeNameFrom('')).toBeNull();
  });
  it('stays within 32 characters and cuts at a word end when one is close', () => {
    const name = worktreeNameFrom('Refactor the notification preferences screen for tablets')!;
    expect(name).toBe('refactor-the-notification');
    expect(name.length).toBeLessThanOrEqual(32);
    expect(worktreeNameFrom('a'.repeat(40))).toBe('a'.repeat(32));
  });
  it('previews the path beside the repository', () => {
    expect(worktreePath('/x/repo/', 'fix')).toBe('/x/repo.worktrees/fix');
  });
  it('flags names the device would refuse', () => {
    expect(worktreeFieldError('Fix')).toBe('name');
    expect(worktreeFieldError('fix-1')).toBeNull();
    expect(worktreeFieldError('')).toBeNull();
  });
});
