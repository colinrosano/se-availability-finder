// Equitable SE assignment (Project Plan §10): a fairness ledger, not a rotation pointer. Pure.

export const LEDGER_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pick one SE from `candidates` (emails free for the slot):
 *   1. fewest assignments in the trailing LEDGER_WINDOW_DAYS,
 *   2. tie → least recently assigned (never assigned counts as least recent),
 *   3. still tied → random.
 *
 * @param {string[]} candidates
 * @param {Array<{ se: string, at: number|string }>} entries  Ledger entries (at = epoch ms or ISO).
 * @param {{ now?: number, windowDays?: number, random?: () => number }} [opts]
 * @returns {{ se: string, recentCount: number, lastAt: number|null } | null}  null if no candidates.
 */
export function pickSE(candidates, entries, { now = Date.now(), windowDays = LEDGER_WINDOW_DAYS, random = Math.random } = {}) {
  if (!candidates.length) return null;
  const since = now - windowDays * DAY_MS;

  const stats = candidates.map((se) => {
    let recentCount = 0;
    let lastAt = null;
    for (const e of entries) {
      if (e.se !== se) continue;
      const at = typeof e.at === 'string' ? Date.parse(e.at) : e.at;
      if (at >= since && at <= now) recentCount++;
      if (lastAt === null || at > lastAt) lastAt = at;
    }
    return { se, recentCount, lastAt };
  });

  const minCount = Math.min(...stats.map((s) => s.recentCount));
  let pool = stats.filter((s) => s.recentCount === minCount);
  if (pool.length > 1) {
    const oldest = Math.min(...pool.map((s) => s.lastAt ?? -Infinity));
    pool = pool.filter((s) => (s.lastAt ?? -Infinity) === oldest);
  }
  return pool[Math.floor(random() * pool.length)];
}

/**
 * Per-SE booking statistics for the admin panel. Covers every roster SE (zeros if none) plus any
 * email in the ledger that is no longer on the roster (flagged `onRoster: false`). Pure.
 *
 * @param {Array<{ se: string, at: number|string }>} entries
 * @param {Array<{ email: string, name: string }>} roster
 * @param {{ now?: number, windowDays?: number, totalDays?: number }} [opts]
 * @returns {{
 *   rows: Array<{ se: string, name: string, onRoster: boolean, recentCount: number, totalCount: number, lastAt: number|null }>,
 *   total: number,
 *   nextPick: { se: string, tie: boolean } | null   // who the fairness rule would pick if every roster SE were free
 * }}
 */
export function ledgerStats(entries, roster, { now = Date.now(), windowDays = LEDGER_WINDOW_DAYS, totalDays = 60 } = {}) {
  const recentSince = now - windowDays * DAY_MS;
  const totalSince = now - totalDays * DAY_MS;
  const byEmail = new Map(roster.map((se) => [se.email, { se: se.email, name: se.name, onRoster: true, recentCount: 0, totalCount: 0, lastAt: null }]));
  for (const e of entries) {
    const at = typeof e.at === 'string' ? Date.parse(e.at) : e.at;
    if (!byEmail.has(e.se)) byEmail.set(e.se, { se: e.se, name: e.se, onRoster: false, recentCount: 0, totalCount: 0, lastAt: null });
    const row = byEmail.get(e.se);
    if (at > now) continue;
    if (at >= recentSince) row.recentCount++;
    if (at >= totalSince) row.totalCount++;
    if (row.lastAt === null || at > row.lastAt) row.lastAt = at;
  }
  const rows = [...byEmail.values()];
  const total = rows.reduce((n, r) => n + r.totalCount, 0);

  // "Next pick": the deterministic part of the rule; a residual tie is reported, not resolved.
  const candidates = roster.map((se) => se.email);
  let nextPick = null;
  if (candidates.length) {
    const first = pickSE(candidates, entries, { now, windowDays, random: () => 0 });
    const last = pickSE(candidates, entries, { now, windowDays, random: () => 0.999 });
    nextPick = { se: first.se, tie: first.se !== last.se };
  }
  return { rows, total, nextPick };
}
