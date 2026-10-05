import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOG_KEY,
  DEFAULT_RANGE_DAYS,
  isLogEntry,
  readBookingLog,
  recordBooking,
  startOfDay,
  defaultRange,
  filterLog,
  csvField,
  toCsv,
  CSV_HEADER,
} from './bookingLog.js';

const DAY = 24 * 60 * 60 * 1000;

/** In-memory stand-ins for archie.kv and localStorage. */
function fakeKv(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { async get(k) { return m.has(k) ? m.get(k) : null; }, async set(k, v) { m.set(k, v); }, dump: () => Object.fromEntries(m) };
}
function fakeLocalStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), dump: () => Object.fromEntries(m) };
}

const entry = (over = {}) => ({
  at: '2026-10-01T15:00:00.000Z',
  callAt: '2026-10-07T19:00:00.000Z',
  ae: 'ae@osano.com',
  se: 'se@osano.com',
  callType: 'demo',
  company: 'Acme',
  ...over,
});

beforeEach(() => {
  delete globalThis.archie;
  delete globalThis.localStorage;
});

test('isLogEntry accepts the stored shape and rejects anything incomplete', () => {
  assert.equal(isLogEntry(entry()), true);
  assert.equal(isLogEntry(entry({ dealId: '123' })), true);
  assert.equal(isLogEntry(entry({ dealId: 123 })), false);
  assert.equal(isLogEntry(entry({ at: 'yesterday' })), false);
  assert.equal(isLogEntry(entry({ company: undefined })), false);
  assert.equal(isLogEntry(null), false);
  assert.equal(isLogEntry('nope'), false);
});

test('empty or malformed log reads as [] and junk entries are dropped', async () => {
  globalThis.archie = { kv: fakeKv() };
  assert.deepEqual(await readBookingLog(), []);
  globalThis.archie = { kv: fakeKv({ [LOG_KEY]: { not: 'an array' } }) };
  assert.deepEqual(await readBookingLog(), []);
  globalThis.archie = { kv: fakeKv({ [LOG_KEY]: [entry(), { junk: true }] }) };
  assert.deepEqual(await readBookingLog(), [entry()]);
});

test('recordBooking appends a canonical entry to archie.kv and never prunes', async () => {
  const kv = fakeKv({ [LOG_KEY]: [entry({ at: '2020-01-01T00:00:00.000Z' })] }); // six years old: kept
  globalThis.archie = { kv };
  const at = new Date(2026, 9, 5, 10);
  const callAt = new Date(2026, 9, 8, 14);
  const after = await recordBooking(
    { ae: ' AE@Osano.com ', se: 'SE@osano.com', callType: 'discovery', company: '  Globex  ', callAt, dealId: ' 987 ' },
    at,
  );
  assert.equal(after.length, 2);
  assert.deepEqual(after[1], {
    at: at.toISOString(),
    callAt: callAt.toISOString(),
    ae: 'ae@osano.com',
    se: 'se@osano.com',
    callType: 'discovery',
    company: 'Globex',
    dealId: '987',
  });
  assert.deepEqual(kv.dump()[LOG_KEY], after);
});

test('recordBooking omits dealId when none was linked and rejects an incomplete booking', async () => {
  globalThis.archie = { kv: fakeKv() };
  const [e] = await recordBooking({ ae: 'a@osano.com', se: 's@osano.com', callType: 'demo', company: 'Acme', callAt: Date.now(), dealId: null });
  assert.equal('dealId' in e, false);
  await assert.rejects(recordBooking({ ae: 'a@osano.com', se: 's@osano.com', callType: 'demo', company: 'Acme', callAt: 'not a date' }));
  assert.equal((await readBookingLog()).length, 1, 'nothing written on rejection');
});

test('falls back to localStorage off Archie, and a custom key keeps fixture data separate', async () => {
  const ls = fakeLocalStorage();
  globalThis.localStorage = ls;
  await recordBooking({ ae: 'a@osano.com', se: 's@osano.com', callType: 'demo', company: 'Acme', callAt: Date.now() }, new Date(), { key: 'log:fixture' });
  assert.equal(ls.dump()[LOG_KEY], undefined);
  assert.equal(JSON.parse(ls.dump()['log:fixture']).length, 1);
  assert.deepEqual(await readBookingLog(), []);
  assert.equal((await readBookingLog({ key: 'log:fixture' })).length, 1);
});

test('defaultRange covers the last 30 local days through the end of today', () => {
  const now = new Date(2026, 9, 5, 15, 42).getTime();
  const { from, to } = defaultRange(now);
  assert.equal(from, new Date(2026, 8, 6).getTime()); // 30 days inclusive of today
  assert.equal(to, new Date(2026, 9, 6).getTime() - 1);
  assert.equal((startOfDay(to) - from) / DAY + 1, DEFAULT_RANGE_DAYS);
});

test('filterLog keeps entries booked inside the inclusive range, newest first; no range = everything', () => {
  const t0 = new Date(2026, 9, 1, 9).getTime();
  const entries = [0, 5, 10, 40].map((d) => entry({ at: new Date(t0 + d * DAY).toISOString(), company: `day${d}` }));
  const all = filterLog(entries);
  assert.deepEqual(all.map((e) => e.company), ['day40', 'day10', 'day5', 'day0']);
  const some = filterLog(entries, { from: t0 + 5 * DAY, to: t0 + 10 * DAY });
  assert.deepEqual(some.map((e) => e.company), ['day10', 'day5']);
  assert.deepEqual(filterLog(entries, { from: t0 + 41 * DAY }), []);
});

test('csvField quotes only when needed and doubles inner quotes', () => {
  assert.equal(csvField('Acme'), 'Acme');
  assert.equal(csvField('Acme, Inc.'), '"Acme, Inc."');
  assert.equal(csvField('Say "hi"'), '"Say ""hi"""');
  assert.equal(csvField('two\nlines'), '"two\nlines"');
  assert.equal(csvField(undefined), '');
});

test('toCsv: header, local dates/times, name and label hooks, blank deal when none, CRLF', () => {
  const at = new Date(2026, 9, 3, 16, 5);
  const callAt = new Date(2026, 9, 7, 14, 30);
  const rows = [
    entry({ at: at.toISOString(), callAt: callAt.toISOString(), company: 'Acme, Inc.', dealId: '42' }),
    entry({ at: at.toISOString(), callAt: callAt.toISOString(), company: 'Globex' }),
  ];
  const csv = toCsv(rows, { nameOf: (e) => (e === 'se@osano.com' ? 'Sam SE' : e), labelOf: (k) => (k === 'demo' ? 'Demo' : k) });
  const lines = csv.split('\r\n');
  assert.equal(lines[0], CSV_HEADER.join(','));
  assert.equal(lines[1], '2026-10-03 16:05,2026-10-07,14:30,ae@osano.com,Sam SE,Demo,"Acme, Inc.",42');
  assert.equal(lines[2], '2026-10-03 16:05,2026-10-07,14:30,ae@osano.com,Sam SE,Demo,Globex,');
  assert.equal(lines[3], '', 'trailing CRLF');
  assert.equal(toCsv([]), CSV_HEADER.join(',') + '\r\n');
});
