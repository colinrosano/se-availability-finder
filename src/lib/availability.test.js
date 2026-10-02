import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAvailability, mergeBlocks, loadAvailability } from './availability.js';
import { validStarts } from './booking.js';

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

test('offerable blocks are AE free ∩ (some SE free), labeled with the SEs they touch', () => {
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

test('blocks merge across SE handoffs and list both SEs; seFree keeps the per-SE overlap for slot checks', () => {
  const calendars = {
    [AE]: { busy: [] },
    [SE1]: busy([[11], [17]]), // free 9–11
    [SE2]: busy([[9], [10]], [[12], [17]]), // free 10–12
  };
  const { offerable, seFree } = computeAvailability([AE, SE1, SE2], calendars, windows);
  assert.deepEqual(offerable, [{ start: t(9), end: t(12), ses: [SE1, SE2] }]);
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

test('one SE per call: adjacent short gaps from different SEs do NOT combine into a block', () => {
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

test('unreadable AE calendar yields no offerable blocks', () => {
  const calendars = { [AE]: { errors: [{ reason: 'notFound' }] }, [SE1]: { busy: [] } };
  const { offerable } = computeAvailability([AE, SE1], calendars, windows);
  assert.deepEqual(offerable, []);
});

test('AE who is also an SE (deduped to a single id) gets no offerable blocks', () => {
  const calendars = { [AE]: { busy: [] } };
  const { offerable } = computeAvailability([AE], calendars, windows);
  assert.deepEqual(offerable, []);
});

test('mergeBlocks: empty input; touching and overlapping spans merge, labeled with every SE they touch', () => {
  assert.deepEqual(mergeBlocks([]), []);
  const blocks = mergeBlocks([
    { id: SE1, intervals: [{ start: 0, end: 10 }, { start: 30, end: 40 }, { start: 60, end: 70 }] },
    { id: SE2, intervals: [{ start: 10, end: 20 }, { start: 35, end: 50 }] },
  ]);
  assert.deepEqual(blocks, [
    { start: 0, end: 20, ses: [SE1, SE2] }, // handoff at 10: both are listed, neither covers it all
    { start: 30, end: 50, ses: [SE1, SE2] },
    { start: 60, end: 70, ses: [SE1] },
  ]);
});

test('render start snaps UP to the quarter hour; seFree keeps the exact minutes', () => {
  const calendars = {
    [AE]: { busy: [] },
    [SE1]: busy([[9], [10, 7]], [[11], [17]]), // free 10:07–11:00
  };
  const { offerable, seFree } = computeAvailability([AE, SE1], calendars, windows, { minMs: 30 * MIN });
  assert.deepEqual(offerable, [{ start: t(10, 15), end: t(11), ses: [SE1] }]);
  assert.deepEqual(seFree[SE1], [{ start: t(10, 7), end: t(11) }]);
  assert.deepEqual(validStarts(offerable[0], seFree, 30), [t(10, 15), t(10, 30)]);
});

test('a block is dropped when the snapped start leaves less than the minimum call length', () => {
  const calendars = {
    [AE]: { busy: [] },
    [SE1]: busy([[9], [10, 52]], [[11, 20], [17]]), // free 10:52–11:20: 28 min, 20 after the snap to 11:00
  };
  const { offerable, seFree } = computeAvailability([AE, SE1], calendars, windows, { minMs: 30 * MIN });
  assert.deepEqual(seFree[SE1], [], 'shorter than minMs, so not even a per-SE overlap');
  assert.deepEqual(offerable, []);
  // Long enough to pass the per-SE filter (10:52–11:25 = 33 min) but 25 min after the snap: still dropped.
  const r = computeAvailability([AE, SE1], { [AE]: { busy: [] }, [SE1]: busy([[9], [10, 52]], [[11, 25], [17]]) }, windows, { minMs: 30 * MIN });
  assert.deepEqual(r.seFree[SE1], [{ start: t(10, 52), end: t(11, 25) }]);
  assert.deepEqual(r.offerable, []);
});

test('blocks with no valid quarter-aligned start are hidden (§11: no empty popovers)', () => {
  // SE1 free only 10:07–10:40 (33 min): passes the 30-min length filter, but no aligned 30-min start fits.
  const calendars = {
    [AE]: { busy: [] },
    [SE1]: busy([[9], [10, 7]], [[10, 40], [17]]),
  };
  const { offerable, seFree } = computeAvailability([AE, SE1], calendars, windows, { minMs: 30 * MIN });
  assert.deepEqual(seFree[SE1], [{ start: t(10, 7), end: t(10, 40) }], 'the SE overlap itself is still reported');
  assert.deepEqual(offerable, []);
});

test('a merged block stays when some start inside it is bookable with ONE SE, even past the handoff', () => {
  // SE1 free 10–11, SE2 free 10:30–11:30, 60-min duration → 10:00 (SE1) and 10:30 (SE2) bookable; 11:00 not.
  const calendars = {
    [AE]: { busy: [] },
    [SE1]: busy([[9], [10]], [[11], [17]]),
    [SE2]: busy([[9], [10, 30]], [[11, 30], [17]]),
  };
  const { offerable, seFree } = computeAvailability([AE, SE1, SE2], calendars, windows, { minMs: 60 * MIN });
  assert.deepEqual(offerable, [{ start: t(10), end: t(11, 30), ses: [SE1, SE2] }]);
  assert.deepEqual(validStarts(offerable[0], seFree, 60), [t(10), t(10, 30)]);
});

test('the spec example: 10:00–11:30 block, SE1 10–11, SE2 11–11:30, 30 min → 10:45 is omitted', () => {
  // No single SE covers 10:45–11:15 (SE1 ends 11:00, SE2 starts 11:00), so it is not offered even though
  // the two together span it. 10:15 is fine (SE1 covers 10:15–10:45).
  const calendars = {
    [AE]: { busy: [] },
    [SE1]: busy([[9], [10]], [[11], [17]]),
    [SE2]: busy([[9], [11]], [[11, 30], [17]]),
  };
  const { offerable, seFree } = computeAvailability([AE, SE1, SE2], calendars, windows, { minMs: 30 * MIN });
  assert.deepEqual(offerable, [{ start: t(10), end: t(11, 30), ses: [SE1, SE2] }]);
  assert.deepEqual(validStarts(offerable[0], seFree, 30), [t(10), t(10, 15), t(10, 30), t(11)]);
  assert.deepEqual(validStarts(offerable[0], seFree, 30, 30), [t(10), t(10, 30), t(11)]);
});

test('loadAvailability accepts identity and FreeBusy overrides (fixture injection points)', async () => {
  const seen = [];
  const freeBusy = async (token, { ids }) => { seen.push({ token, ids }); const out = {}; for (const id of ids) out[id] = { busy: [] }; return out; };
  const now = new Date(2026, 8, 23, 9); // Wed, so the week has business time left
  const r = await loadAvailability('tok', { now, me: 'fixture.ae@osano.com', freeBusy, roster: [{ email: SE1, name: 'S1' }], minMs: 30 * MIN });
  assert.equal(r.me, 'fixture.ae@osano.com');
  assert.deepEqual(seen[0], { token: 'tok', ids: ['fixture.ae@osano.com', SE1] });
  assert.ok(r.offerable.length > 0);
});
