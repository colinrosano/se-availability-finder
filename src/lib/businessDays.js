// Business-day math. All calculations use the viewer's local time zone.
import { BUSINESS_HOURS, MIN_FREE_MS } from './config.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 0 = Sun, 6 = Sat */
export function isWeekend(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/**
 * The Mon–Fri week containing `date`, as local-midnight Dates:
 * start = Monday 00:00, end = Saturday 00:00 (exclusive). Sunday belongs to the week just ended.
 */
export function weekBounds(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // back to Monday
  const end = new Date(start);
  end.setDate(end.getDate() + 5); // Saturday 00:00
  return { start, end };
}

/**
 * The week an AE most likely wants to see "now": this week on a weekday,
 * next week on a weekend (this week's business days are already over).
 */
export function defaultWeekOf(now = new Date()) {
  const d = new Date(now);
  const day = d.getDay();
  if (day === 6) d.setDate(d.getDate() + 2);
  else if (day === 0) d.setDate(d.getDate() + 1);
  return d;
}

/** Shift a date by whole weeks (for prev/next navigation). */
export function addWeeks(date, n) {
  return new Date(+date + n * 7 * DAY_MS);
}

/**
 * One interval per business day between from and to (Dates or ms), clipped to business hours
 * and to [from, to). Days whose remaining window is shorter than minMs are skipped.
 */
export function businessWindows(from, to, { hours = BUSINESS_HOURS, minMs = MIN_FREE_MS } = {}) {
  const fromMs = +from;
  const toMs = +to;
  const windows = [];
  const day = new Date(fromMs);
  day.setHours(0, 0, 0, 0);
  for (; day < toMs; day.setDate(day.getDate() + 1)) {
    if (isWeekend(day)) continue;
    const open = new Date(day).setHours(hours.start[0], hours.start[1], 0, 0);
    const close = new Date(day).setHours(hours.end[0], hours.end[1], 0, 0);
    const start = Math.max(open, fromMs);
    const end = Math.min(close, toMs);
    if (end - start >= minMs) windows.push({ start, end });
  }
  return windows;
}
