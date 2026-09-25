import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAvailability } from './availability.js';

// One business window: Wed 2026-09-23, 9 AM – 5 PM local.
const t = (h, m = 0) => new Date(2026, 8, 23, h, m).getTime();
const windows = [{ start: t(9), end: t(17) }];
const iso = (h, m = 0) => new Date(t(h, m)).toISOString();
const busy = (...ranges) => ({ busy: ranges.map(([s, e]) => ({ start: iso(...s), end: iso(...e) })) });

const AE = 'ae@osano.com';
const SE1 = 'se1@osano.com';
const SE2 = 'se2@osano.com';

test('per-person free/busy within the window', () => {
  const calendars = { [AE]: busy([[10], [11]]), [SE1]: { busy: [] } };
  const { people } = computeAvailability([AE, SE1], calendars, windows);
  assert.deepEqual(people[0].busy, [{ start: t(10), end: t(11) }]);
  assert.deepEqual(people[0].free, [
    { start: t(9), end: t(10) },
    { start: t(11), end: t(17) },
  ]);
  assert.deepEqual(people[1].free, windows);
});

test('busy blocks outside business windows are hidden from busy but still not free', () => {
  const calendars = { [AE]: busy([[7], [8]]), [SE1]: { busy: [] } };
  const { people } = computeAvailability([AE, SE1], calendars, windows);
  assert.deepEqual(people[0].busy, []);
  assert.deepEqual(people[0].free, windows);
});

test('offerable = AE free ∩ (any SE free)', () => {
  const calendars = {
    [AE]: busy([[9], [10]]), // free 10–17
    [SE1]: busy([[10], [14]]), // free 9–10, 14–17
    [SE2]: busy([[12], [17]]), // free 9–12
  };
  const { offerable } = computeAvailability([AE, SE1, SE2], calendars, windows);
  // SE union: 9–12, 14–17. ∩ AE 10–17 → 10–12, 14–17
  assert.deepEqual(offerable, [
    { start: t(10), end: t(12) },
    { start: t(14), end: t(17) },
  ]);
});

test('missing calendar key is an error, not free', () => {
  const calendars = { [AE]: { busy: [] } };
  const { people, offerable } = computeAvailability([AE, SE1], calendars, windows);
  assert.match(people[1].error, /No data returned/);
  assert.deepEqual(offerable, []); // no readable SE → nothing offerable
});

test('per-calendar errors (e.g. notFound) are surfaced and excluded from offerable', () => {
  const calendars = {
    [AE]: { busy: [] },
    [SE1]: { errors: [{ reason: 'notFound' }] },
    [SE2]: { busy: [] },
  };
  const { people, offerable } = computeAvailability([AE, SE1, SE2], calendars, windows);
  assert.match(people[1].error, /notFound/);
  assert.deepEqual(offerable, windows); // SE2 is wide open
});

test('unreadable AE calendar yields no offerable windows', () => {
  const calendars = { [AE]: { errors: [{ reason: 'notFound' }] }, [SE1]: { busy: [] } };
  const { offerable } = computeAvailability([AE, SE1], calendars, windows);
  assert.deepEqual(offerable, []);
});

test('AE who is also an SE (deduped to a single id) gets no offerable windows', () => {
  const calendars = { [AE]: { busy: [] } };
  const { offerable } = computeAvailability([AE], calendars, windows);
  assert.deepEqual(offerable, []);
});
