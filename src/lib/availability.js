// Turns FreeBusy results into per-person free/busy lists and the windows an AE can offer.
import { SE_EMAILS, MIN_FREE_MS } from './config.js';
import { getMe } from './auth.js';
import { fetchFreeBusy } from './freebusy.js';
import { businessWindows, weekBounds, defaultWeekOf } from './businessDays.js';
import { mergeIntervals, subtractIntervals, intersectIntervals, overlaps } from './intervals.js';

/**
 * Pure. For each id, work out free/busy intervals within the business windows, or why we couldn't.
 *
 * @param {string[]} ids        Calendar IDs, with the AE (viewer) first.
 * @param {object}   calendars  The FreeBusy `calendars` map (see freebusy.js).
 * @param {{start:number,end:number}[]} windows  Business-hour windows (see businessDays.js).
 * @param {{ minMs?: number }} [opts]  Minimum meeting length; a window must fit a call with ONE SE.
 * @returns {{
 *   people: Array<{ id: string, error?: string, busy?: Interval[], free?: Interval[] }>,
 *   offerable: Array<{ start: number, end: number, ses: string[] }>,
 *     // AE free AND at least one SE free for >= minMs (locked product rule: one SE per call).
 *     // Split wherever the set of available SEs changes, so each segment is labeled accurately.
 *   seFree: Record<string, Interval[]>
 *     // Each readable SE's overlap with the AE (>= minMs). Lets the UI check who is free for
 *     // one specific slot, which may span two labeled segments (see booking.js sesFreeFor).
 * }}
 */
export function computeAvailability(ids, calendars, windows, { minMs = MIN_FREE_MS } = {}) {
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
  let offerable = [];
  const seFree = {};
  if (ae && !ae.error) {
    // Each SE's overlap with the AE, individually long enough for a call with that one SE.
    const perSe = others
      .filter((p) => !p.error)
      .map((p) => ({ id: p.id, intervals: intersectIntervals(ae.free, p.free, minMs) }));
    for (const p of perSe) seFree[p.id] = p.intervals;
    offerable = labelSegments(perSe);
  }

  return { people, offerable, seFree };
}

/**
 * Pure. Merge per-SE interval lists into one timeline, split at every point where the set of
 * available SEs changes. Input intervals per SE must be sorted and non-overlapping.
 */
export function labelSegments(perSe) {
  const bounds = [...new Set(perSe.flatMap((p) => p.intervals.flatMap((iv) => [iv.start, iv.end])))].sort(
    (a, b) => a - b,
  );
  const out = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    const ses = perSe
      .filter((p) => p.intervals.some((iv) => iv.start <= start && iv.end >= end))
      .map((p) => p.id);
    if (!ses.length) continue;
    const last = out[out.length - 1];
    if (last && last.end === start && sameSet(last.ses, ses)) last.end = end;
    else out.push({ start, end, ses });
  }
  return out;
}

function sameSet(a, b) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/**
 * Full load for one Mon–Fri week: who am I, fetch FreeBusy for me + the SE roster from
 * max(now, Monday) to Saturday 00:00, and compute availability.
 *
 * @param {string} accessToken  From requestAccessToken() in auth.js
 * @param {{ weekOf?: Date, now?: Date, minMs?: number }} [opts]
 *   weekOf: any date in the week to show (default: this week, or next week on a weekend).
 */
export async function loadAvailability(accessToken, { weekOf, now = new Date(), minMs } = {}) {
  const me = await getMe();
  const { start: weekStart, end: weekEnd } = weekBounds(weekOf ?? defaultWeekOf(now));
  const timeMin = new Date(Math.max(+now, +weekStart));
  // AE first, then SEs, deduped (the AE may themselves be an SE).
  const ids = [...new Set([me, ...SE_EMAILS])];
  const windows = businessWindows(timeMin, weekEnd);

  let calendars = {};
  if (windows.length) {
    calendars = await fetchFreeBusy(accessToken, { timeMin, timeMax: weekEnd, ids });
  } else {
    // Week is entirely in the past: nothing to fetch, everyone trivially has no windows.
    for (const id of ids) calendars[id] = { busy: [] };
  }
  const { people, offerable, seFree } = computeAvailability(ids, calendars, windows, { minMs });
  return { me, ids, weekStart, weekEnd, timeMin, windows, calendars, people, offerable, seFree, fetchedAt: now };
}
