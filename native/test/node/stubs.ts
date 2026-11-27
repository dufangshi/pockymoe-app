// Native modules that tests replace.
export const getLocales = () => [{ languageTag: 'en-US' }];
const memory = new Map<string, string>();
const Storage = {
  getItemSync: (key: string) => memory.get(key) ?? null,
  setItemSync: (key: string, value: string) => { memory.set(key, value); },
  removeItemSync: (key: string) => { memory.delete(key); },
};
export default Storage;
export function browserLabel() { return 'Pockymoe app · Test · Android'; }
