(globalThis as Record<string, unknown>).__DEV__ = false;
import { installMemoryIdb } from './node/memoryIdb';
(globalThis as Record<string, unknown>).__POCKYMOE_ENV__ = {};
export const idb = installMemoryIdb();
