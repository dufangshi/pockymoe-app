import type { LocalBridge, LocalState } from '../shared/local';
/** Subscribe before requesting the initial snapshot: IPC events can arrive while
 * getState is in flight. Mount synchronously before releasing the buffer. */
export async function mountInitialState(bridge: LocalBridge, mount: (state: LocalState) => void): Promise<void> {
  let pending: LocalState | undefined;
  const stop = bridge.onState(next => { pending = next; });
  try {
    const initial = await bridge.getState();
    mount(pending && (pending.revision ?? 0) >= (initial.revision ?? 0) ? pending : initial);
  } finally { stop(); }
}
