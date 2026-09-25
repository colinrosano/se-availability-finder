import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWeekend, endOfBusinessDays, businessWindows } from './businessDays.js';

// All dates are local-time. 2026-09-23 is a Wednesday, 2026-09-26 a Saturday.
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);
const MIN = 60_000;

test('isWeekend', () => {
  assert.equal(isWeekend(local(2026, 9, 26)), true); // Sat
  assert.equal(isWeekend(local(2026, 9, 27)), true); // Sun
  assert.equal(isWeekend(local(2026, 9, 28)), false); // Mon
});

test('endOfBusinessDays: 5 weekdays from a Wednesday lands at midnight after next Wednesday', () => {
  const end = endOfBusinessDays(5, local(2026, 9, 23, 14, 30));
  assert.equal(+end, +local(2026, 10, 1)); // Thu Fri Mon Tue Wed → 00:00 Thu Oct 1
});

test('endOfBusinessDays: from a Saturday counts Mon–Fri', () => {
  const end = endOfBusinessDays(5, local(2026, 9, 26, 10));
  assert.equal(+end, +local(2026, 10, 3)); // Fri Oct 2 → midnight Sat Oct 3
});

test('endOfBusinessDays: does not mutate input', () => {
  const from = local(2026, 9, 23);
  const snapshot = +from;
  endOfBusinessDays(5, from);
  assert.equal(+from, snapshot);
});

test('businessWindows: rest of today is clipped to now, later days are full 9–5', () => {
  const from = local(2026, 9, 23, 14, 30); // Wed 2:30 PM
  const to = endOfBusinessDays(2, from); // through Fri
  const w = businessWindows(from, to);
  assert.deepEqual(w, [
    { start: +local(2026, 9, 23, 14, 30), end: +local(2026, 9, 23, 17) },
    { start: +local(2026, 9, 24, 9), end: +local(2026, 9, 24, 17) },
    { start: +local(2026, 9, 25, 9), end: +local(2026, 9, 25, 17) },
  ]);
});

test('businessWindows: skips weekends and a today that is already past close', () => {
  const from = local(2026, 9, 25, 18); // Fri 6 PM
  const to = endOfBusinessDays(1, from); // through Mon
  const w = businessWindows(from, to);
  assert.deepEqual(w, [{ start: +local(2026, 9, 28, 9), end: +local(2026, 9, 28, 17) }]);
});

test('businessWindows: drops a remaining window shorter than minMs', () => {
  const from = local(2026, 9, 23, 16, 45); // 15 min before close
  const to = endOfBusinessDays(1, from);
  const w = businessWindows(from, to, { minMs: 30 * MIN });
  assert.deepEqual(w, [{ start: +local(2026, 9, 24, 9), end: +local(2026, 9, 24, 17) }]);
});

test('businessWindows: honours custom hours and accepts ms inputs', () => {
  const from = +local(2026, 9, 23, 6);
  const to = +local(2026, 9, 24);
  const w = businessWindows(from, to, { hours: { start: 8, end: 12 } });
  assert.deepEqual(w, [{ start: +local(2026, 9, 23, 8), end: +local(2026, 9, 23, 12) }]);
});
