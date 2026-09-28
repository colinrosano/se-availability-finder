// SE assignment ledger: who was assigned, and when. Aggregate scheduling metadata only —
// no meeting content, no prospect data — so it is allowed in the Archie config store.
// On Archie: archie.kv (shared across all AEs). On localhost: browser storage, so the flow
// can be exercised without the platform. No DOM code.

export const LEDGER_KEY = 'ledger:assignments';
export const LEDGER_RETENTION_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/** @typedef {{ se: string, at: string }} LedgerEntry  at = ISO timestamp */

function store() {
  const kv = globalThis.archie?.kv;
  if (kv) return kv;
  // Local fallback with the same get/set shape.
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

/** All retained entries, oldest first. Never throws; an unreadable ledger reads as empty. */
export async function readLedger() {
  try {
    const value = await store().get(LEDGER_KEY);
    return Array.isArray(value) ? value.filter((e) => e && typeof e.se === 'string' && typeof e.at === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Append one assignment and prune entries older than LEDGER_RETENTION_DAYS.
 * Read-modify-write; two AEs booking in the same instant may lose one entry (accepted, §10).
 * @returns {Promise<LedgerEntry[]>} the ledger after the write
 */
export async function recordAssignment(se, at = new Date()) {
  const cutoff = Date.now() - LEDGER_RETENTION_DAYS * DAY_MS;
  const entries = (await readLedger()).filter((e) => Date.parse(e.at) >= cutoff);
  entries.push({ se, at: new Date(at).toISOString() });
  await store().set(LEDGER_KEY, entries);
  return entries;
}
