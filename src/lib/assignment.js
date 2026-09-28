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
