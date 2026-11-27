// Git writes for one working copy (docs/git.md "Git writes"): a running turn asks once
// (`confirmRunning`), Discard always asks, every write returns the new status and the
// panel refreshes. Errors show as a toast and are returned to the caller.
import { useCallback, useEffect, useRef, useState } from 'react';
import { gitWrite, type GitStatus } from '@pockymoe/web/gitApi';
import { gitText as gt } from '@pockymoe/web/gitI18n';
import { confirmAsync, showToast } from '../../design/Overlay';
import { haptic } from '../../design/haptics';
import { translate } from '../../i18n';

export type GitWrite = <T = { status?: GitStatus }>(action: string, input?: Record<string, unknown>, options?: { quiet?: boolean; confirm?: false }) => Promise<T | null>;
export const errorText = (e: unknown) => String((e as Error)?.message ?? e);

export function useGitWrite(threadId: string, workingCopyId: string | null, deviceKey: string, running: boolean, onWritten: (status?: GitStatus) => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const accepted = useRef(false);
  const busyRef = useRef(false);
  useEffect(() => { accepted.current = false; }, [running, threadId, workingCopyId]);
  const write = useCallback(async function write<T>(action: string, input: Record<string, unknown> = {}, options: { quiet?: boolean; confirm?: false } = {}): Promise<T | null> {
    if (busyRef.current) return null;
    if (running && !accepted.current && action !== 'checkpoints/preview' && action !== 'git/commitMessage') {
      if (!await confirmAsync({ title: 'Git', message: gt('runningConfirm'), confirmLabel: gt('continue') })) return null;
      accepted.current = true;
    }
    if (action === 'git/discard' && options.confirm !== false
      && !await confirmAsync({ title: gt('discard'), message: gt('discardConfirm'), confirmLabel: gt('discard'), destructive: true })) return null;
    busyRef.current = true; setBusy(action);
    try {
      const result = await gitWrite<T>(threadId, action, { ...input, ...(workingCopyId ? { workingCopyId } : {}), ...(running && accepted.current ? { confirmRunning: true } : {}) }, deviceKey);
      const status = (result as { status?: GitStatus } | null)?.status;
      if (!options.quiet) haptic.success();
      onWritten(status);
      return result ?? ({} as T);
    } catch (error) {
      haptic.warning();
      showToast(errorText(error).split('\n')[0] || translate('workbench.gitLoadFailed'), 'error');
      return null;
    } finally { busyRef.current = false; setBusy(null); }
  }, [threadId, workingCopyId, deviceKey, running, onWritten]) as GitWrite;
  return { write, busy };
}
