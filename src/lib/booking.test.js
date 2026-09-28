import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProducts,
  productTitleSegment,
  buildEventTitle,
  buildEventDescription,
  isIntakeComplete,
  parseEmails,
  snapUpToQuarter,
  startTimes,
  sesFreeFor,
  MODULES,
} from './booking.js';

const t = (h, m = 0) => new Date(2026, 8, 24, h, m).getTime(); // Thu 2026-09-24 local
const MIN = 60_000;

test('normalizeProducts: Full Platform wins; all six modules collapse to it; unknown keys dropped', () => {
  assert.deepEqual(normalizeProducts(['full_platform', 'cookie_consent']), ['full_platform']);
  assert.deepEqual(normalizeProducts([...MODULES]), ['full_platform']);
  assert.deepEqual(normalizeProducts(['subject_rights', 'data_mapping']), ['subject_rights', 'data_mapping']);
  assert.deepEqual(normalizeProducts(['data_mapping', 'bogus']), ['data_mapping']);
  assert.deepEqual(normalizeProducts([]), []);
});

test('productTitleSegment: three bands — 1–2 spelled out, 3–5 Multi-Product, six/full → Full Platform', () => {
  assert.equal(productTitleSegment(['cookie_consent']), 'Cookie Consent');
  assert.equal(productTitleSegment(['subject_rights', 'data_mapping']), 'Subject Rights + Data Mapping');
  assert.equal(productTitleSegment(MODULES.slice(0, 3)), 'Multi-Product');
  assert.equal(productTitleSegment(MODULES.slice(0, 5)), 'Multi-Product');
  assert.equal(productTitleSegment(MODULES), 'Full Platform');
  assert.equal(productTitleSegment(['full_platform']), 'Full Platform');
  assert.equal(productTitleSegment(['full_platform', 'assessments']), 'Full Platform');
});

test('buildEventTitle matches the Project Plan examples', () => {
  assert.equal(
    buildEventTitle({ companyName: 'ACME', productKeys: ['cookie_consent'], callTypeKey: 'demo' }),
    'Osano // ACME - Cookie Consent Demo',
  );
  assert.equal(
    buildEventTitle({ companyName: ' ACME ', productKeys: ['subject_rights', 'data_mapping'], callTypeKey: 'discovery' }),
    'Osano // ACME - Subject Rights + Data Mapping Discovery',
  );
  assert.equal(
    buildEventTitle({ companyName: 'ACME', productKeys: ['cookie_consent', 'subject_rights', 'data_mapping'], callTypeKey: 'trial_kickoff' }),
    'Osano // ACME - Multi-Product Trial Kickoff',
  );
  assert.equal(
    buildEventTitle({ companyName: 'ACME', productKeys: MODULES, callTypeKey: 'trial_kickoff' }),
    'Osano // ACME - Full Platform Trial Kickoff',
  );
});

test('buildEventDescription always lists the exact modules, whatever the title band', () => {
  assert.equal(buildEventDescription({ productKeys: ['cookie_consent'] }), 'Products: Cookie Consent');
  assert.equal(
    buildEventDescription({ productKeys: ['cookie_consent', 'subject_rights', 'data_mapping'] }),
    'Products: Cookie Consent, Subject Rights, Data Mapping',
  );
  assert.equal(buildEventDescription({ productKeys: MODULES }), 'Products: Full Platform');
  assert.equal(buildEventDescription({ productKeys: ['full_platform'] }), 'Products: Full Platform');
});

test('isIntakeComplete requires every field', () => {
  const ok = { companyName: 'ACME', productKeys: ['demo'], callTypeKey: 'demo', durationMin: 30 };
  assert.equal(isIntakeComplete({ ...ok, productKeys: ['cookie_consent'] }), true);
  assert.equal(isIntakeComplete({ ...ok, productKeys: ['cookie_consent'], companyName: '   ' }), false);
  assert.equal(isIntakeComplete({ ...ok, productKeys: [] }), false);
  assert.equal(isIntakeComplete({ ...ok, productKeys: ['cookie_consent'], callTypeKey: '' }), false);
  assert.equal(isIntakeComplete({ ...ok, productKeys: ['cookie_consent'], durationMin: 20 }), false);
});

test('parseEmails: separators, case, dedupe, angle brackets, and invalid entries reported', () => {
  assert.deepEqual(parseEmails(''), { emails: [], invalid: [] });
  assert.deepEqual(parseEmails('  '), { emails: [], invalid: [] });
  assert.deepEqual(parseEmails('A@Acme.com, b@acme.com; c@acme.com d@acme.com\n<a@acme.com>'), {
    emails: ['a@acme.com', 'b@acme.com', 'c@acme.com', 'd@acme.com'],
    invalid: [],
  });
  assert.deepEqual(parseEmails('a@acme.com, nope, b@acme'), { emails: ['a@acme.com'], invalid: ['nope', 'b@acme'] });
});

test('snapUpToQuarter rounds up, and leaves aligned times alone', () => {
  assert.equal(snapUpToQuarter(t(10, 7)), t(10, 15));
  assert.equal(snapUpToQuarter(t(10, 15)), t(10, 15));
  assert.equal(snapUpToQuarter(t(10, 46)), t(11, 0));
});

test('startTimes: the §11 example — 10:15–12:00 with 30 min → 10:15 / 10:45 / 11:15', () => {
  assert.deepEqual(startTimes({ start: t(10, 15), end: t(12) }, 30), [t(10, 15), t(10, 45), t(11, 15)]);
});

test('startTimes: edge snaps up (10:07 → 10:15), duration must fit, 15-min step available', () => {
  assert.deepEqual(startTimes({ start: t(10, 7), end: t(11) }, 30), [t(10, 15)]);
  assert.deepEqual(startTimes({ start: t(10, 7), end: t(11) }, 30, 15), [t(10, 15), t(10, 30)]);
  assert.deepEqual(startTimes({ start: t(10, 7), end: t(10, 40) }, 30), []);
  assert.deepEqual(startTimes({ start: t(9), end: t(10) }, 60), [t(9)]);
});

test('sesFreeFor: an SE must cover the whole slot; slot may span two labeled segments', () => {
  const seFree = {
    'se1@osano.com': [{ start: t(9), end: t(11) }],
    'se2@osano.com': [{ start: t(10), end: t(12) }],
  };
  assert.deepEqual(sesFreeFor(seFree, t(10), t(10, 30)), ['se1@osano.com', 'se2@osano.com']);
  assert.deepEqual(sesFreeFor(seFree, t(10, 45), t(11, 15)), ['se2@osano.com']); // crosses the 11:00 split
  assert.deepEqual(sesFreeFor(seFree, t(9), t(9, 30)), ['se1@osano.com']);
  assert.deepEqual(sesFreeFor(seFree, t(11, 45), t(12, 15)), []);
});
