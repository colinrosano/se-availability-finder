// SE assignment ledger: who was assigned, and when. Aggregate scheduling metadata only —
// no meeting content, no prospect data — so it is allowed in the Archie config store.
// Lives in the shared app store (see store.js). No DOM code.
import { kvStore as store } from './store.js';

export const LEDGER_KEY = 'ledger:assignments';
export const LEDGER_RETENTION_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/** @typedef {{ se: string, at: string }} LedgerEntry  at = ISO timestamp */

/**
 * All retained entries, oldest first. Never throws; an unreadable ledger reads as empty.
 * `key` exists so localhost fixture mode can keep its fake bookings in a separate ledger.
 */
export async function readLedger({ key = LEDGER_KEY } = {}) {
  try {
    const value = await store().get(key);
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
export async function recordAssignment(se, at = new Date(), { key = LEDGER_KEY } = {}) {
  const cutoff = Date.now() - LEDGER_RETENTION_DAYS * DAY_MS;
  const entries = (await readLedger({ key })).filter((e) => Date.parse(e.at) >= cutoff);
  entries.push({ se, at: new Date(at).toISOString() });
  await store().set(key, entries);
  return entries;
}
