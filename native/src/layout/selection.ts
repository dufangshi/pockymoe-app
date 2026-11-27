// The workbench's selection survives rotation and folding: it is not tied to a column.
import { prefs } from '../platform/prefs';
import { createStore } from '../state/store';
import type { InspectorPane } from '../features/inspector/Inspector';

const DEVICE_KEY = 'pockymoe-native.device';
export const selectionStore = createStore<{ deviceKey: string | null; threadId: string | null; newThread: { workspaceId?: string } | null; inspector: InspectorPane | null; inspectorPaths: string[]; inspectorTurnId: string | null }>({
  deviceKey: prefs.get(DEVICE_KEY), threadId: null, newThread: null, inspector: null, inspectorPaths: [], inspectorTurnId: null,
});
export function selectDevice(deviceKey: string) {
  prefs.set(DEVICE_KEY, deviceKey);
  selectionStore.set({ deviceKey, threadId: null, newThread: null, inspector: null });
}

