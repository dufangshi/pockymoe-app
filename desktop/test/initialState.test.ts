import { expect, it } from 'vitest';
import { mountInitialState } from '../src/local/initialState';
import type { LocalBridge, LocalState } from '../src/shared/local';

it.each([[1, 2, 2], [3, 2, 3]])('mounts the newest snapshot when getState(%i) races a broadcast(%i)', async (reply, event, expected) => {
  const listeners = new Set<(state: LocalState) => void>();
  const value = (revision: number): LocalState => ({ revision, locale: 'en' } as LocalState);
  const bridge: LocalBridge = {
    onState: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getState: async () => { for (const listener of listeners) listener(value(event)); return value(reply); },
    action: async () => ({ ok: true })
  };
  let mounted: LocalState | undefined;
  await mountInitialState(bridge, initial => { mounted = initial; });
  expect(mounted?.revision).toBe(expected);
  expect(listeners.size).toBe(0);
});
