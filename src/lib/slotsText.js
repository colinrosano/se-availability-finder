// Paste-ready "available times" text for prospect emails (Project Plan §9, "Copy available times").
// Three scopes share one formatter: ALL (every window in the visible week), DAY (one column), and
// BLOCK (the valid start times inside one clicked block). Output is the AE's local zone with an
// explicit label, and never names or counts SEs — joint availability only. Pure.

import { CHIP_STEP_MIN } from './booking.js';

const DEFAULT_INTRO = 'Here are some times that work on our end';

/** Merge adjacent offerable segments into plain ranges; which SE is free is irrelevant to a prospect. */
export function mergeRuns(offerable) {
  const runs = [];
  for (const seg of offerable) {
    const last = runs[runs.length - 1];
    if (last && last.end === seg.start) last.end = seg.end;
    else runs.push({ start: seg.start, end: seg.end });
  }
  return runs;
}

/** The segments that fall on one calendar day (`dayKey` = Date#toDateString()). */
export function forDay(offerable, dayKey) {
  return offerable.filter((seg) => new Date(seg.start).toDateString() === dayKey);
}

/** Short zone label for a moment, e.g. "CDT" / "EST". Falls back to the IANA name if the locale gives none. */
export function zoneLabel(at = Date.now(), locale = []) {
  const parts = new Intl.DateTimeFormat(locale, { timeZoneName: 'short' }).formatToParts(new Date(at));
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const fmtTime = (ms, locale) => new Date(ms).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
const fmtDay = (ms, locale) => new Date(ms).toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * The one shape every scope renders: an intro line with the zone (and any qualifier), then one
 * bullet per day listing that day's items.
 * @param {Array<{ at: number, text: string }>} items  sorted by `at`; `at` picks the day bucket
 */
function render(items, { intro, zone, qualifier, locale }) {
  if (!items.length) return '';
  const z = zone ?? zoneLabel(items[0].at, locale);
  const byDay = new Map();
  for (const it of items) {
    const key = new Date(it.at).toDateString();
    if (!byDay.has(key)) byDay.set(key, { label: fmtDay(it.at, locale), texts: [] });
    byDay.get(key).texts.push(it.text);
  }
  const lines = [...byDay.values()].map((d) => `• ${d.label}: ${d.texts.join(', ')}`);
  const head = qualifier ? `(all times ${z}, ${qualifier})` : `(all times ${z})`;
  return `${intro} ${head}:\n${lines.join('\n')}`;
}

/**
 * ALL / DAY scope: windows as ranges ("10:00 AM – 12:00 PM").
 * @param {Array<{ start: number, end: number }>} offerable  Sorted segments (from computeAvailability).
 * @param {{ zone?: string, locale?: string|string[], intro?: string }} [opts]
 * @returns {string}  '' when there is nothing to offer.
 */
export function formatSlotsText(offerable, { zone, locale = [], intro = DEFAULT_INTRO } = {}) {
  const items = mergeRuns(offerable).map((r) => ({ at: r.start, text: `${fmtTime(r.start, locale)} – ${fmtTime(r.end, locale)}` }));
  return render(items, { intro, zone, locale });
}

/** A run of this many consecutive starts (one chip step apart) is written as a range, not a list. */
export const RANGE_MIN_STARTS = 4;

/**
 * Group ascending starts into runs of consecutive chips (exactly `stepMs` apart).
 * @returns {number[][]}
 */
export function groupStarts(starts, stepMs) {
  const runs = [];
  for (const t of starts) {
    const run = runs[runs.length - 1];
    if (run && t - run[run.length - 1] === stepMs) run.push(t);
    else runs.push([t]);
  }
  return runs;
}

/**
 * BLOCK scope: the valid start times inside one clicked block, for a call of `durationMin`.
 * Already duration-filtered by construction (see booking.js validStarts). A big block would list
 * every 15-minute mark, so runs of RANGE_MIN_STARTS+ consecutive starts collapse to a range written
 * as the prospect would read it ("any time between 10:00 AM and 2:45 PM" — the end includes the
 * call length); shorter or scattered runs stay as a list. Runs are joined with "or".
 * @param {number[]} starts  epoch ms, ascending
 * @returns {string}  '' when there are no starts.
 */
export function formatStartsText(starts, durationMin, { zone, locale = [], intro = DEFAULT_INTRO, stepMin = CHIP_STEP_MIN } = {}) {
  if (!starts.length) return '';
  const durMs = durationMin * 60_000;
  const parts = groupStarts(starts, stepMin * 60_000).map((run) =>
    run.length >= RANGE_MIN_STARTS
      ? `any time between ${fmtTime(run[0], locale)} and ${fmtTime(run[run.length - 1] + durMs, locale)}`
      : run.map((t) => fmtTime(t, locale)).join(', '),
  );
  // One bullet for the block's day; render() buckets by day, and a block never crosses midnight.
  const items = [{ at: starts[0], text: parts.join(', or ') }];
  return render(items, { intro, zone, locale, qualifier: `${durationMin}-minute call` });
}
