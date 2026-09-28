import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSE } from './assignment.js';

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

test('future-dated entries are ignored for counting but still set lastAt', () => {
  const entries = [{ se: A, at: NOW + DAY }];
  const pick = pickSE([A, B], entries, { now: NOW });
  assert.equal(pick.se, B); // A's lastAt is newer, B never assigned
});
