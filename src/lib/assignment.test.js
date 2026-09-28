import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSE, ledgerStats } from './assignment.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 8, 28, 12).getTime();
const daysAgo = (n) => NOW - n * DAY;
const A = 'a@osano.com';
const B = 'b@osano.com';
const C = 'c@osano.com';

test('no candidates → null; one candidate → that one', () => {
  assert.equal(pickSE([], [], { now: NOW }), null);
  assert.equal(pickSE([A], [{ se: B, at: daysAgo(1) }], { now: NOW }).se, A);
});

test('fewest assignments in the trailing 14 days wins', () => {
  const entries = [
    { se: A, at: daysAgo(1) },
    { se: A, at: daysAgo(3) },
    { se: B, at: daysAgo(2) },
  ];
  const pick = pickSE([A, B], entries, { now: NOW });
  assert.equal(pick.se, B);
  assert.equal(pick.recentCount, 1);
});

test('assignments older than the window do not count (self-corrects after PTO)', () => {
  const entries = [
    { se: A, at: daysAgo(20) },
    { se: A, at: daysAgo(30) },
    { se: A, at: daysAgo(40) },
    { se: B, at: daysAgo(1) },
  ];
  assert.equal(pickSE([A, B], entries, { now: NOW }).se, A);
});

test('ISO-string timestamps are accepted', () => {
  const entries = [{ se: A, at: new Date(daysAgo(1)).toISOString() }];
  assert.equal(pickSE([A, B], entries, { now: NOW }).se, B);
});

test('tie on count → least recently assigned; never assigned counts as least recent', () => {
  const entries = [
    { se: A, at: daysAgo(2) },
    { se: B, at: daysAgo(5) },
  ];
  assert.equal(pickSE([A, B], entries, { now: NOW }).se, B);
  assert.equal(pickSE([A, B, C], entries, { now: NOW }).se, C);
});

test('still tied → random among the tied pool only', () => {
  const entries = [{ se: C, at: daysAgo(1) }]; // C is behind; A and B tie with nothing
  assert.equal(pickSE([A, B, C], entries, { now: NOW, random: () => 0 }).se, A);
  assert.equal(pickSE([A, B, C], entries, { now: NOW, random: () => 0.99 }).se, B);
});

const roster = [
  { email: A, name: 'Ann A' },
  { email: B, name: 'Bob B' },
];

test('ledgerStats: zeros for every roster SE when the ledger is empty; next pick is a tie', () => {
  const s = ledgerStats([], roster, { now: NOW });
  assert.deepEqual(
    s.rows.map((r) => [r.name, r.recentCount, r.totalCount, r.lastAt, r.onRoster]),
    [['Ann A', 0, 0, null, true], ['Bob B', 0, 0, null, true]],
  );
  assert.equal(s.total, 0);
  assert.deepEqual(s.nextPick, { se: A, tie: true });
});

test('ledgerStats: 14-day and 60-day counts, last assigned, total, and a deterministic next pick', () => {
  const entries = [
    { se: A, at: daysAgo(1) },
    { se: A, at: daysAgo(10) },
    { se: A, at: daysAgo(30) }, // outside 14, inside 60
    { se: A, at: daysAgo(70) }, // outside 60
    { se: B, at: new Date(daysAgo(3)).toISOString() },
  ];
  const s = ledgerStats(entries, roster, { now: NOW });
  const a = s.rows.find((r) => r.se === A);
  const b = s.rows.find((r) => r.se === B);
  assert.deepEqual([a.recentCount, a.totalCount, a.lastAt], [2, 3, daysAgo(1)]);
  assert.deepEqual([b.recentCount, b.totalCount, b.lastAt], [1, 1, daysAgo(3)]);
  assert.equal(s.total, 4);
  assert.deepEqual(s.nextPick, { se: B, tie: false });
});

test('ledgerStats: an SE removed from the roster still appears, flagged, and is not a next-pick candidate', () => {
  const entries = [{ se: C, at: daysAgo(2) }];
  const s = ledgerStats(entries, roster, { now: NOW });
  const c = s.rows.find((r) => r.se === C);
  assert.deepEqual([c.name, c.onRoster, c.recentCount], [C, false, 1]);
  assert.notEqual(s.nextPick.se, C);
});

test('ledgerStats: empty roster → no next pick', () => {
  assert.equal(ledgerStats([], [], { now: NOW }).nextPick, null);
});

test('future-dated entries are ignored for counting but still set lastAt', () => {
  const entries = [{ se: A, at: NOW + DAY }];
  const pick = pickSE([A, B], entries, { now: NOW });
  assert.equal(pick.se, B); // A's lastAt is newer, B never assigned
});
