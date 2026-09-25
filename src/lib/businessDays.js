// Business-day math. All calculations use the viewer's local time zone.
import { BUSINESS_HOURS, MIN_FREE_MS } from './config.js';

/** 0 = Sun, 6 = Sat */
export function isWeekend(d) {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/**
 * Walk forward day by day from `from`, counting only Mon–Fri, until n days are counted.
 * Returns a Date at midnight at the END of that day (so it works as an exclusive timeMax).
 */
export function endOfBusinessDays(n, from) {
  const d = new Date(from);
  let counted = 0;
  while (counted < n) {
    d.setDate(d.getDate() + 1);
    if (!isWeekend(d)) counted++;
  }
  d.setHours(24, 0, 0, 0); // rolls over to 12:00 AM the next day
  return d;
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
    const open = new Date(day).setHours(hours.start, 0, 0, 0);
    const close = new Date(day).setHours(hours.end, 0, 0, 0);
    const start = Math.max(open, fromMs);
    const end = Math.min(close, toMs);
    if (end - start >= minMs) windows.push({ start, end });
  }
  return windows;
}
