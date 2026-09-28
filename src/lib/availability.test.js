import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAvailability, labelSegments } from './availability.js';

// One business window: Wed 2026-09-23, 9 AM – 5 PM local.
const t = (h, m = 0) => new Date(2026, 8, 23, h, m).getTime();
const windows = [{ start: t(9), end: t(17) }];
const iso = (h, m = 0) => new Date(t(h, m)).toISOString();
const busy = (...ranges) => ({ busy: ranges.map(([s, e]) => ({ start: iso(...s), end: iso(...e) })) });
const MIN = 60_000;

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

test('offerable segments are labeled with the SEs free in each', () => {
  const calendars = {
    [AE]: busy([[9], [10]]), // free 10–17
    [SE1]: busy([[10], [14]]), // free 9–10, 14–17
    [SE2]: busy([[12], [17]]), // free 9–12
  };
  const { offerable } = computeAvailability([AE, SE1, SE2], calendars, windows);
  assert.deepEqual(offerable, [
    { start: t(10), end: t(12), ses: [SE2] },
    { start: t(14), end: t(17), ses: [SE1] },
  ]);
});

test('segments split where the set of free SEs changes, and merge where it does not', () => {
  const calendars = {
    [AE]: { busy: [] },
    [SE1]: busy([[11], [17]]), // free 9–11
    [SE2]: busy([[9], [10]], [[12], [17]]), // free 10–12
  };
  const { offerable, seFree } = computeAvailability([AE, SE1, SE2], calendars, windows);
  assert.deepEqual(offerable, [
    { start: t(9), end: t(10), ses: [SE1] },
    { start: t(10), end: t(11), ses: [SE1, SE2] },
    { start: t(11), end: t(12), ses: [SE2] },
  ]);
  // Per-SE overlap with the AE is exposed unsplit, for slot-level "who is free" checks.
  assert.deepEqual(seFree, {
    [SE1]: [{ start: t(9), end: t(11) }],
    [SE2]: [{ start: t(10), end: t(12) }],
  });
});

test('seFree excludes unreadable SEs and is empty when the AE is unreadable', () => {
  const a = computeAvailability([AE, SE1, SE2], { [AE]: { busy: [] }, [SE1]: { errors: [{ reason: 'notFound' }] }, [SE2]: { busy: [] } }, windows);
  assert.deepEqual(Object.keys(a.seFree), [SE2]);
  const b = computeAvailability([AE, SE1], { [AE]: { errors: [{ reason: 'notFound' }] }, [SE1]: { busy: [] } }, windows);
  assert.deepEqual(b.seFree, {});
});

test('one SE per call: adjacent short gaps from different SEs do NOT combine into a window', () => {
  const calendars = {
    [AE]: { busy: [] },
    [SE1]: busy([[9], [10]], [[10, 20], [17]]), // free 10:00–10:20 only
    [SE2]: busy([[9], [10, 20]], [[10, 40], [17]]), // free 10:20–10:40 only
  };
  const { offerable } = computeAvailability([AE, SE1, SE2], calendars, windows, { minMs: 30 * MIN });
  assert.deepEqual(offerable, []);
});

test('minMs applies per SE: a 60-min filter drops a 45-min overlap', () => {
  const calendars = {
    [AE]: { busy: [] },
    [SE1]: busy([[9], [10]], [[10, 45], [17]]), // free 10:00–10:45
    [SE2]: busy([[9], [13]], [[15], [17]]), // free 13:00–15:00
  };
  const at30 = computeAvailability([AE, SE1, SE2], calendars, windows, { minMs: 30 * MIN }).offerable;
  const at60 = computeAvailability([AE, SE1, SE2], calendars, windows, { minMs: 60 * MIN }).offerable;
  assert.deepEqual(at30, [
    { start: t(10), end: t(10, 45), ses: [SE1] },
    { start: t(13), end: t(15), ses: [SE2] },
  ]);
  assert.deepEqual(at60, [{ start: t(13), end: t(15), ses: [SE2] }]);
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
  assert.deepEqual(offerable, [{ start: t(9), end: t(17), ses: [SE2] }]); // SE2 is wide open
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

test('labelSegments: empty input, and touching intervals with the same SE merge', () => {
  assert.deepEqual(labelSegments([]), []);
  const seg = labelSegments([{ id: SE1, intervals: [{ start: 0, end: 10 }, { start: 10, end: 20 }] }]);
  assert.deepEqual(seg, [{ start: 0, end: 20, ses: [SE1] }]);
});
