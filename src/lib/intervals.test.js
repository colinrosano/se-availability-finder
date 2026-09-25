import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeIntervals, subtractIntervals, intersectIntervals, overlaps } from './intervals.js';

const MIN = 60_000;
const iv = (start, end) => ({ start: start * MIN, end: end * MIN }); // minutes → ms

test('overlaps: half-open, touching does not overlap', () => {
  assert.equal(overlaps(iv(0, 10), iv(5, 15)), true);
  assert.equal(overlaps(iv(0, 10), iv(10, 20)), false);
  assert.equal(overlaps(iv(10, 20), iv(0, 10)), false);
});

test('mergeIntervals: sorts, merges overlapping and touching, leaves gaps', () => {
  const out = mergeIntervals([iv(30, 40), iv(0, 10), iv(10, 20), iv(15, 25)]);
  assert.deepEqual(out, [iv(0, 25), iv(30, 40)]);
});

test('mergeIntervals: does not mutate input', () => {
  const input = [iv(0, 10), iv(5, 15)];
  const copy = structuredClone(input);
  mergeIntervals(input);
  assert.deepEqual(input, copy);
});

test('subtractIntervals: busy inside a window splits it', () => {
  const free = subtractIntervals([iv(0, 480)], [iv(60, 120)], 30 * MIN);
  assert.deepEqual(free, [iv(0, 60), iv(120, 480)]);
});

test('subtractIntervals: busy spanning window edges clips correctly', () => {
  const free = subtractIntervals([iv(100, 200)], [iv(50, 120), iv(180, 250)], 30 * MIN);
  assert.deepEqual(free, [iv(120, 180)]);
});

test('subtractIntervals: busy covering the whole window yields nothing', () => {
  assert.deepEqual(subtractIntervals([iv(100, 200)], [iv(0, 300)], 30 * MIN), []);
});

test('subtractIntervals: gaps shorter than minMs are dropped', () => {
  const free = subtractIntervals([iv(0, 100)], [iv(20, 80)], 30 * MIN);
  assert.deepEqual(free, []); // 0–20 and 80–100 are both < 30 min
});

test('subtractIntervals: multiple windows, no busy', () => {
  const windows = [iv(0, 60), iv(100, 160)];
  assert.deepEqual(subtractIntervals(windows, [], 30 * MIN), windows);
});

test('intersectIntervals: overlap of two sorted lists', () => {
  const a = [iv(0, 60), iv(100, 200)];
  const b = [iv(30, 130), iv(150, 300)];
  assert.deepEqual(intersectIntervals(a, b, 30 * MIN), [iv(30, 60), iv(100, 130), iv(150, 200)]);
});

test('intersectIntervals: drops overlaps shorter than minMs', () => {
  assert.deepEqual(intersectIntervals([iv(0, 60)], [iv(50, 100)], 30 * MIN), []);
});

test('intersectIntervals: empty when either side is empty', () => {
  assert.deepEqual(intersectIntervals([], [iv(0, 60)]), []);
  assert.deepEqual(intersectIntervals([iv(0, 60)], []), []);
});
