import { useRef, useSyncExternalStore } from 'react';

/** A tiny observable store. Components read slices with `use(selector)`. */
export interface Store<T> {
  get(): T;
  set(next: Partial<T> | ((state: T) => Partial<T>)): void;
  replace(next: T): void;
  subscribe(listener: () => void): () => void;
  useValue<S>(selector: (state: T) => S, equal?: (a: S, b: S) => boolean): S;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());
  const store: Store<T> = {
    get: () => state,
    set(next) {
      const patch = typeof next === 'function' ? next(state) : next;
      let changed = false;
      for (const key of Object.keys(patch) as (keyof T)[]) if (!Object.is(state[key], patch[key])) { changed = true; break; }
      if (!changed) return;
      state = { ...state, ...patch };
      notify();
    },
    replace(next) { if (next !== state) { state = next; notify(); } },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    useValue(selector, equal = Object.is) {
      // The cache is keyed by the state and the selector: a selector that closes over a prop
      // (`() => findDevice(key)`) is a new function when the prop changes and must re-run.
      const cache = useRef<{ state: T; selector: typeof selector; value: ReturnType<typeof selector> } | null>(null);
      const read = () => {
        const current = store.get();
        if (cache.current && cache.current.state === current && cache.current.selector === selector) return cache.current.value;
        const value = selector(current);
        if (cache.current && equal(cache.current.value, value)) { cache.current = { state: current, selector, value: cache.current.value }; return cache.current.value; }
        cache.current = { state: current, selector, value };
        return value;
      };
      return useSyncExternalStore(store.subscribe, read, read);
    },
  };
  return store;
}

export const shallowEqual = <S,>(a: S, b: S) => {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
};
