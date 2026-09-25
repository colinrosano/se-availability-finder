// Pure interval math. An interval is { start, end } in epoch ms, half-open [start, end).
import { MIN_FREE_MS } from './config.js';

/** True if the two intervals share any time. */
export function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

/** Sort and merge overlapping or touching intervals into a non-overlapping, sorted list. */
export function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else out.push({ ...iv });
  }
  return out;
}

/**
 * The parts of each window not covered by any busy interval.
 * `busy` must be merged + sorted (see mergeIntervals). Gaps shorter than minMs are dropped.
 */
export function subtractIntervals(windows, busy, minMs = MIN_FREE_MS) {
  const free = [];
  for (const w of windows) {
    let cursor = w.start;
    for (const b of busy) {
      if (b.end <= cursor) continue;
      if (b.start >= w.end) break;
      if (b.start > cursor) free.push({ start: cursor, end: b.start });
      cursor = Math.max(cursor, b.end);
      if (cursor >= w.end) break;
    }
    if (cursor < w.end) free.push({ start: cursor, end: w.end });
  }
  return free.filter((f) => f.end - f.start >= minMs);
}

/** Overlap of two sorted, non-overlapping interval lists. Overlaps shorter than minMs are dropped. */
export function intersectIntervals(a, b, minMs = MIN_FREE_MS) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start);
    const end = Math.min(a[i].end, b[j].end);
    if (end - start >= minMs) out.push({ start, end });
    if (a[i].end < b[j].end) i++;
    else j++;
  }
  return out;
}
