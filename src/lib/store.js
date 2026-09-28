// The app's config store. On Archie: archie.kv (shared across all visitors). On localhost:
// browser storage with the same get/set shape, so flows can be exercised without the platform.
// Per Archie's data policy this holds config and aggregate metadata only — never personal content.
// No DOM code.

export function kvStore() {
  const kv = globalThis.archie?.kv;
  if (kv) return kv;
  const ls = globalThis.localStorage;
  return {
    async get(key) {
      try {
        const raw = ls?.getItem(key);
        return raw == null ? null : JSON.parse(raw);
      } catch {
        return null;
      }
    },
    async set(key, value) {
      try {
        ls?.setItem(key, JSON.stringify(value));
      } catch {
        /* private mode etc. */
      }
    },
  };
}
