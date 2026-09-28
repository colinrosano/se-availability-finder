import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRuns, formatSlotsText, zoneLabel } from './slotsText.js';

const t = (d, h, m = 0) => new Date(2026, 8, d, h, m).getTime(); // Sep 2026 local; 28 = Mon
const SE1 = 'a@osano.com';
const SE2 = 'b@osano.com';

test('mergeRuns joins touching segments regardless of label, keeps gaps', () => {
  const runs = mergeRuns([
    { start: t(28, 9), end: t(28, 10), ses: [SE1] },
    { start: t(28, 10), end: t(28, 10, 30), ses: [SE1, SE2] },
    { start: t(28, 13), end: t(28, 15), ses: [SE2] },
    { start: t(29, 10, 30), end: t(29, 12), ses: [SE1] },
  ]);
  assert.deepEqual(runs, [
    { start: t(28, 9), end: t(28, 10, 30) },
    { start: t(28, 13), end: t(28, 15) },
    { start: t(29, 10, 30), end: t(29, 12) },
  ]);
});

test('formatSlotsText groups by day with a zone label and intro', () => {
  const text = formatSlotsText(
    [
      { start: t(28, 9), end: t(28, 10), ses: [SE1] },
      { start: t(28, 10), end: t(28, 10, 30), ses: [SE1, SE2] },
      { start: t(28, 13), end: t(28, 15), ses: [SE2] },
      { start: t(29, 10, 30), end: t(29, 12), ses: [SE1] },
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
  const text = formatSlotsText([{ start: t(30, 8, 30), end: t(30, 9), ses: [SE1] }], { zone: 'ET', locale: 'en-US', intro: 'Options' });
  assert.equal(text, 'Options (all times ET):\n• Wed, Sep 30: 8:30 AM – 9:00 AM');
});

test('zoneLabel returns a short non-empty label', () => {
  const z = zoneLabel(t(28, 9), 'en-US');
  assert.equal(typeof z, 'string');
  assert.ok(z.length >= 2 && z.length <= 40, z);
});
