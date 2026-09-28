import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWeekend, weekBounds, defaultWeekOf, addWeeks, businessWindows } from './businessDays.js';

// All dates are local-time. 2026-09-23 is a Wednesday, 2026-09-26 a Saturday.
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);
const MIN = 60_000;

test('isWeekend', () => {
  assert.equal(isWeekend(local(2026, 9, 26)), true); // Sat
  assert.equal(isWeekend(local(2026, 9, 27)), true); // Sun
  assert.equal(isWeekend(local(2026, 9, 28)), false); // Mon
});

test('weekBounds: Monday 00:00 through Saturday 00:00 for a mid-week date', () => {
  const { start, end } = weekBounds(local(2026, 9, 23, 14, 30));
  assert.equal(+start, +local(2026, 9, 21));
  assert.equal(+end, +local(2026, 9, 26));
});

test('weekBounds: Monday maps to itself, Sunday belongs to the week just ended', () => {
  assert.equal(+weekBounds(local(2026, 9, 21, 9)).start, +local(2026, 9, 21));
  assert.equal(+weekBounds(local(2026, 9, 27)).start, +local(2026, 9, 21));
});

test('defaultWeekOf: weekday stays, weekend jumps to next Monday', () => {
  assert.equal(+weekBounds(defaultWeekOf(local(2026, 9, 23))).start, +local(2026, 9, 21));
  assert.equal(+weekBounds(defaultWeekOf(local(2026, 9, 26))).start, +local(2026, 9, 28)); // Sat
  assert.equal(+weekBounds(defaultWeekOf(local(2026, 9, 27))).start, +local(2026, 9, 28)); // Sun
});

test('addWeeks shifts by whole weeks', () => {
  assert.equal(+addWeeks(local(2026, 9, 21), 1), +local(2026, 9, 28));
  assert.equal(+addWeeks(local(2026, 9, 21), -1), +local(2026, 9, 14));
});

test('businessWindows: rest of today is clipped to now, later days are full 8:30–5:30', () => {
  const from = local(2026, 9, 23, 14, 30); // Wed 2:30 PM
  const to = local(2026, 9, 26); // Sat 00:00
  const w = businessWindows(from, to);
  assert.deepEqual(w, [
    { start: +local(2026, 9, 23, 14, 30), end: +local(2026, 9, 23, 17, 30) },
    { start: +local(2026, 9, 24, 8, 30), end: +local(2026, 9, 24, 17, 30) },
    { start: +local(2026, 9, 25, 8, 30), end: +local(2026, 9, 25, 17, 30) },
  ]);
});

test('businessWindows: skips weekends and a today that is already past close', () => {
  const from = local(2026, 9, 25, 18); // Fri 6 PM
  const to = local(2026, 9, 29); // through Mon
  const w = businessWindows(from, to);
  assert.deepEqual(w, [{ start: +local(2026, 9, 28, 8, 30), end: +local(2026, 9, 28, 17, 30) }]);
});

test('businessWindows: drops a remaining window shorter than minMs', () => {
  const from = local(2026, 9, 23, 17, 15); // 15 min before close
  const to = local(2026, 9, 25);
  const w = businessWindows(from, to, { minMs: 30 * MIN });
  assert.deepEqual(w, [{ start: +local(2026, 9, 24, 8, 30), end: +local(2026, 9, 24, 17, 30) }]);
});

test('businessWindows: honours custom hours and accepts ms inputs', () => {
  const from = +local(2026, 9, 23, 6);
  const to = +local(2026, 9, 24);
  const w = businessWindows(from, to, { hours: { start: [8, 0], end: [12, 0] } });
  assert.deepEqual(w, [{ start: +local(2026, 9, 23, 8), end: +local(2026, 9, 23, 12) }]);
});

test('businessWindows: empty when the whole range is in the past week', () => {
  assert.deepEqual(businessWindows(local(2026, 9, 26), local(2026, 9, 26)), []);
});
