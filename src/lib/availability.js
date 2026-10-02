// Turns FreeBusy results into per-person free/busy lists and the windows an AE can offer.
import { SE_ROSTER, BUSINESS_HOURS, MIN_FREE_MS } from './config.js';
import { getMe } from './auth.js';
import { fetchFreeBusy } from './freebusy.js';
import { businessWindows, weekBounds, defaultWeekOf } from './businessDays.js';
import { mergeIntervals, subtractIntervals, intersectIntervals, overlaps } from './intervals.js';
import { validStarts } from './booking.js';

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
 *     // Contiguous spans where the AE and at least one SE are free, merged across SE handoffs.
 *     // `ses` lists everyone free at some point in the block (the grid label), not necessarily
 *     // for the whole span. The union is only for DRAWING: every bookable start inside it is checked
 *     // against one SE at a time (booking.js validStarts / sesFreeFor), so two SEs' short gaps
 *     // never combine into a slot nobody can take. Blocks with no valid quarter-aligned start
 *     // are dropped, so every block on the grid opens to a non-empty popover (§11).
 *   seFree: Record<string, Interval[]>
 *     // Each readable SE's overlap with the AE (>= minMs): the source of truth for which SE can
 *     // cover one specific slot, which may run past the block's edge.
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
    const durationMin = minMs / 60_000;
    offerable = mergeBlocks(perSe).filter((block) => validStarts(block, seFree, durationMin).length > 0);
  }

  return { people, offerable, seFree };
}

/**
 * Pure. Merge every SE's intervals into one timeline of contiguous blocks, joining touching or
 * overlapping spans regardless of which SE covers them, and label each with the SEs it touches.
 * @param {Array<{ id: string, intervals: Interval[] }>} perSe  roster order
 * @returns {Array<{ start: number, end: number, ses: string[] }>}  sorted, non-overlapping
 */
export function mergeBlocks(perSe) {
  return mergeIntervals(perSe.flatMap((p) => p.intervals)).map((block) => ({
    ...block,
    // Everyone free at SOME point in the block, in roster order — a label, not a guarantee for
    // the whole span. Which SE covers a given slot is decided per start time (booking.js).
    ses: perSe.filter((p) => p.intervals.some((iv) => overlaps(iv, block))).map((p) => p.id),
  }));
}

/**
 * Full load for one Mon–Fri week: who am I, fetch FreeBusy for me + the SE roster from
 * max(now, Monday) to Saturday 00:00, and compute availability.
 *
 * @param {string} accessToken  From requestAccessToken() in auth.js
 * @param {{ weekOf?: Date, now?: Date, minMs?: number, roster?: {email:string}[], hours?: {start:number[], end:number[]} }} [opts]
 *   weekOf: any date in the week to show (default: this week, or next week on a weekend).
 *   roster/hours: the admin-managed settings (see settings.js); default to the config.js seeds.
 */
export async function loadAvailability(
  accessToken,
  { weekOf, now = new Date(), minMs, roster = SE_ROSTER, hours = BUSINESS_HOURS, me: meOverride, freeBusy = fetchFreeBusy } = {},
) {
  // `me` and `freeBusy` are injection points for localhost fixture mode (src/dev/); production never sets them.
  const me = meOverride ?? (await getMe());
  const { start: weekStart, end: weekEnd } = weekBounds(weekOf ?? defaultWeekOf(now));
  const timeMin = new Date(Math.max(+now, +weekStart));
  // AE first, then SEs, deduped (the AE may themselves be an SE).
  const ids = [...new Set([me, ...roster.map((se) => se.email)])];
  const windows = businessWindows(timeMin, weekEnd, { hours });

  let calendars = {};
  if (windows.length) {
    calendars = await freeBusy(accessToken, { timeMin, timeMax: weekEnd, ids });
  } else {
    // Week is entirely in the past: nothing to fetch, everyone trivially has no windows.
    for (const id of ids) calendars[id] = { busy: [] };
  }
  const { people, offerable, seFree } = computeAvailability(ids, calendars, windows, { minMs });
  return { me, ids, weekStart, weekEnd, timeMin, windows, calendars, people, offerable, seFree, fetchedAt: now };
}
