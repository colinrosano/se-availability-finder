import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSlotsText, formatStartsText, forDay, groupStarts, zoneLabel, RANGE_MIN_STARTS } from './slotsText.js';

const t = (d, h, m = 0) => new Date(2026, 8, d, h, m).getTime(); // Sep 2026 local; 28 = Mon

test('formatSlotsText groups by day with a zone label and intro', () => {
  const text = formatSlotsText(
    [
      { start: t(28, 9), end: t(28, 10, 30) },
      { start: t(28, 13), end: t(28, 15) },
      { start: t(29, 10, 30), end: t(29, 12) },
    ],
    { zone: 'CDT', locale: 'en-US' },
  );
  assert.equal(
    text,
    [
      'Here are some times that work on our end (all times CDT):',
      '• Mon, Sep 28: 9:00 AM – 10:30 AM, 1:00 PM – 3:00 PM',
      '• Tue, Sep 29: 10:30 AM – 12:00 PM',
    ].join('\n'),
  );
});

test('formatSlotsText: empty input → empty string; custom intro honoured', () => {
  assert.equal(formatSlotsText([]), '');
  const text = formatSlotsText([{ start: t(30, 8, 30), end: t(30, 9) }], { zone: 'ET', locale: 'en-US', intro: 'Options' });
  assert.equal(text, 'Options (all times ET):\n• Wed, Sep 30: 8:30 AM – 9:00 AM');
});

test('zoneLabel returns a short non-empty label', () => {
  const z = zoneLabel(t(28, 9), 'en-US');
  assert.equal(typeof z, 'string');
  assert.ok(z.length >= 2 && z.length <= 40, z);
});

test('forDay picks one calendar day out of the week', () => {
  const offerable = [
    { start: t(28, 9), end: t(28, 10) },
    { start: t(29, 10, 30), end: t(29, 12) },
    { start: t(29, 13), end: t(29, 14) },
  ];
  const tue = forDay(offerable, new Date(t(29, 0)).toDateString());
  assert.deepEqual(tue.map((s) => s.start), [t(29, 10, 30), t(29, 13)]);
  assert.deepEqual(forDay(offerable, new Date(t(30, 0)).toDateString()), []);
});

test('DAY scope: same formatter as ALL, one day only, no SE names', () => {
  const offerable = [
    { start: t(28, 9), end: t(28, 10) },
    { start: t(29, 10, 30), end: t(29, 12) },
  ];
  const text = formatSlotsText(forDay(offerable, new Date(t(29, 0)).toDateString()), { zone: 'CDT', locale: 'en-US' });
  assert.equal(text, 'Here are some times that work on our end (all times CDT):\n• Tue, Sep 29: 10:30 AM – 12:00 PM');
  assert.doesNotMatch(text, /osano\.com/);
});

test('BLOCK scope: start times with the call length in the header; empty → empty string', () => {
  const text = formatStartsText([t(1 + 30, 10), t(1 + 30, 10, 15), t(1 + 30, 10, 30)], 30, { zone: 'CDT', locale: 'en-US' });
  assert.equal(text, 'Here are some times that work on our end (all times CDT, 30-minute call):\n• Thu, Oct 1: 10:00 AM, 10:15 AM, 10:30 AM');
  assert.equal(formatStartsText([], 30), '');
});

test('groupStarts splits on any gap larger than one step', () => {
  const s15 = 15 * 60_000;
  const starts = [t(1 + 30, 10), t(1 + 30, 10, 15), t(1 + 30, 10, 30), t(1 + 30, 13), t(1 + 30, 13, 15)];
  assert.deepEqual(groupStarts(starts, s15).map((r) => r.length), [3, 2]);
  assert.deepEqual(groupStarts([], s15), []);
});

test('BLOCK scope: a long run collapses to "any time between" with the end including the call length', () => {
  const starts = Array.from({ length: 17 }, (_, i) => t(1 + 30, 10) + i * 15 * 60_000); // 10:00 … 2:00 PM at 15-min steps
  const text = formatStartsText(starts, 30, { zone: 'CDT', locale: 'en-US', stepMin: 15 });
  assert.equal(text, 'Here are some times that work on our end (all times CDT, 30-minute call):\n• Thu, Oct 1: any time between 10:00 AM and 2:30 PM');
  assert.equal(RANGE_MIN_STARTS, 4);
});

test('BLOCK scope: short runs stay as a list; mixed runs are joined with "or"', () => {
  const s = (h, m) => t(1 + 30, h, m);
  const mixed = [s(10, 0), s(10, 15), s(10, 30), s(10, 45), s(11, 0), s(13, 0), s(13, 15)];
  const text = formatStartsText(mixed, 30, { zone: 'CDT', locale: 'en-US', stepMin: 15 });
  assert.equal(text.split('\n')[1], '• Thu, Oct 1: any time between 10:00 AM and 11:30 AM, or 1:00 PM, 1:15 PM');
  const exactlyThree = formatStartsText([s(10, 0), s(10, 15), s(10, 30)], 30, { zone: 'CDT', locale: 'en-US', stepMin: 15 });
  assert.equal(exactlyThree.split('\n')[1], '• Thu, Oct 1: 10:00 AM, 10:15 AM, 10:30 AM');
});
