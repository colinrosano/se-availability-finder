// Turns FreeBusy results into per-person free/busy lists and the windows an AE can offer.
import { SE_EMAILS, BUSINESS_DAYS_AHEAD } from './config.js';
import { getMe } from './auth.js';
import { fetchFreeBusy } from './freebusy.js';
import { businessWindows, endOfBusinessDays } from './businessDays.js';
import { mergeIntervals, subtractIntervals, intersectIntervals, overlaps } from './intervals.js';

/**
 * Pure. For each id, work out free/busy intervals within the business windows, or why we couldn't.
 *
 * @param {string[]} ids        Calendar IDs, with the AE (viewer) first.
 * @param {object}   calendars  The FreeBusy `calendars` map (see freebusy.js).
 * @param {{start:number,end:number}[]} windows  Business-hour windows (see businessDays.js).
 * @returns {{
 *   people: Array<{ id: string, error?: string, busy?: Interval[], free?: Interval[] }>,
 *   offerable: Interval[]   // AE free AND at least one readable SE free (locked product rule)
 * }}
 */
export function computeAvailability(ids, calendars, windows) {
  const people = ids.map((id) => {
    const cal = calendars[id];
    if (!cal) {
      return { id, error: `No data returned for this calendar. Returned keys: ${Object.keys(calendars).join(', ')}` };
    }
    // Per-calendar errors (e.g. "notFound" = sharing doesn't allow free/busy lookup)
    if (cal.errors?.length) {
      return { id, error: `Couldn't read calendar: ${cal.errors.map((e) => e.reason).join(', ')}` };
    }
    const busy = mergeIntervals(
      (cal.busy ?? []).map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) })),
    );
    return {
      id,
      busy: busy.filter((b) => windows.some((w) => overlaps(b, w))), // drop blocks outside business windows
      free: subtractIntervals(windows, busy),
    };
  });

  const [ae, ...others] = people;
  const readableSEs = others.filter((p) => !p.error);
  let offerable = [];
  if (ae && !ae.error && readableSEs.length) {
    // Union of all SE free time, then intersect with the AE's free time.
    const anySeFree = mergeIntervals(readableSEs.flatMap((p) => p.free));
    offerable = intersectIntervals(ae.free, anySeFree);
  }

  return { people, offerable };
}

/**
 * Full load: who am I, build the window (rest of today + BUSINESS_DAYS_AHEAD weekdays),
 * fetch FreeBusy for me + the SE roster, and compute availability.
 *
 * @param {string} accessToken  From requestAccessToken() in auth.js
 * @param {{ now?: Date }} [opts]  Override "now" for testing.
 */
export async function loadAvailability(accessToken, { now = new Date() } = {}) {
  const me = await getMe();
  const timeMin = now;
  const timeMax = endOfBusinessDays(BUSINESS_DAYS_AHEAD, timeMin);
  // AE first, then SEs, deduped (the AE may themselves be an SE).
  const ids = [...new Set([me, ...SE_EMAILS])];
  const windows = businessWindows(timeMin, timeMax);
  const calendars = await fetchFreeBusy(accessToken, { timeMin, timeMax, ids });
  const { people, offerable } = computeAvailability(ids, calendars, windows);
  return { me, timeMin, timeMax, windows, people, offerable };
}
