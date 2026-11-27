import { describe, expect, it } from 'vitest';
import { inferMode, validateWorkspace, workspaceBody } from '../../src/features/workspaces/workspaceInput';

describe('workspace form rules (same as the Web)', () => {
  it('validates each mode', () => {
    expect(validateWorkspace('folder', 'my-project')).toBeNull();
    expect(validateWorkspace('folder', '../escape')).toMatch(/letters/);
    expect(validateWorkspace('path', 'relative/dir')).toMatch(/absolute/);
    expect(validateWorkspace('path', 'C:\\code\\app')).toBeNull();
    expect(validateWorkspace('git', 'git@github.com:o/r.git')).toBeNull();
    expect(validateWorkspace('git', 'not a url')).toMatch(/Git/);
    expect(validateWorkspace('path', '  ')).toMatch(/required/);
  });
  it('builds the request body', () => {
    expect(workspaceBody('folder', 'app', '', '/home/me/dev/')).toEqual({ absPath: '/home/me/dev/app' });
    expect(workspaceBody('path', ' /srv/app ', 'App', null)).toEqual({ absPath: '/srv/app', label: 'App' });
    expect(workspaceBody('git', 'https://x/y.git', '', '/d')).toEqual({ gitUrl: 'https://x/y.git' });
  });
  it('recognises pasted values', () => {
    expect(inferMode('https://github.com/a/b')).toBe('git');
    expect(inferMode('/Users/a/b')).toBe('path');
    expect(inferMode('name')).toBeNull();
  });
});
