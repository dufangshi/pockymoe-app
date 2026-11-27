// The Web's workspace form rules (apps/supervisor-web/src/components/WorkspaceForm.tsx), as
// pure functions so they can be tested without React Native.
import { translate } from '../../i18n';

export type WorkspaceMode = 'folder' | 'path' | 'git';
export const folderNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export function isGitInput(value: string) {
  const v = value.trim();
  return /^https?:\/\/.+/i.test(v) || /^ssh:\/\/.+/i.test(v) || /^git@[^:]+:.+/.test(v);
}
export function isAbsolutePath(value: string) {
  const v = value.trim();
  return v.startsWith('/') || /^[A-Za-z]:[\\/]/.test(v) || /^\\\\[^\\]+\\[^\\]+/.test(v);
}
/** What a pasted value most likely is, so the form can switch for the reader. */
export function inferMode(value: string): WorkspaceMode | null {
  if (isGitInput(value)) return 'git';
  if (isAbsolutePath(value)) return 'path';
  return null;
}
export function fieldLabel(mode: WorkspaceMode) {
  return translate(mode === 'folder' ? 'files.folderName' : mode === 'path' ? 'files.absolutePath' : 'files.repositoryURL');
}
/** null when the value can be sent. */
export function validateWorkspace(mode: WorkspaceMode, raw: string): string | null {
  const value = raw.trim();
  if (!value) return translate('files.isRequired', { value1: fieldLabel(mode) });
  if (mode === 'folder' && !folderNamePattern.test(value)) return translate('files.use1128LettersNumbersPeriodsUnderscores');
  if (mode === 'path' && !isAbsolutePath(value)) return translate('files.enterAnAbsolutePathSuchAsUsers');
  if (mode === 'git' && !isGitInput(value)) return translate('files.enterAnHTTPSOrSSHGitRepository');
  return null;
}
/** The body of `POST /api/workspaces`, as the Web sends it. */
export function workspaceBody(mode: WorkspaceMode, raw: string, label: string, devHome: string | null) {
  const value = raw.trim();
  const named = label.trim() ? { label: label.trim() } : {};
  if (mode === 'git') return { gitUrl: value, ...named };
  return { absPath: mode === 'folder' && devHome ? `${devHome.replace(/[\\/]+$/, '')}/${value}` : value, ...named };
}
