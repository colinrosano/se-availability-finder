import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, saveSettings, validateSettings, isAdmin, defaultSettings, SETTINGS_KEY } from './settings.js';

function fakeKv(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { async get(k) { return m.has(k) ? m.get(k) : null; }, async set(k, v) { m.set(k, v); }, dump: () => Object.fromEntries(m) };
}

const good = () => ({
  roster: [{ email: 'a@osano.com', name: 'Ann A' }, { email: 'b@osano.com', name: 'Bob B' }],
  businessHours: { start: [9, 0], end: [17, 30] },
});

beforeEach(() => {
  delete globalThis.archie;
  delete globalThis.localStorage;
});

test('isAdmin: allow-list, case-insensitive, safe on junk', () => {
  assert.equal(isAdmin('creinhardt@osano.com'), true);
  assert.equal(isAdmin('CReinhardt@Osano.com'), true);
  assert.equal(isAdmin('someone@osano.com'), false);
  assert.equal(isAdmin(undefined), false);
});

test('defaults are used when the store is empty, malformed, or throwing', async () => {
  globalThis.archie = { kv: fakeKv() };
  let s = await loadSettings();
  assert.equal(s.source, 'defaults');
  assert.deepEqual({ roster: s.roster, businessHours: s.businessHours }, defaultSettings());

  globalThis.archie = { kv: fakeKv({ [SETTINGS_KEY]: { roster: [], businessHours: { start: [8, 30], end: [17, 30] } } }) };
  assert.equal((await loadSettings()).source, 'defaults');

  globalThis.archie = { kv: { async get() { throw new Error('kv down'); } } };
  assert.equal((await loadSettings()).source, 'defaults');
});

test('a valid stored value wins over the defaults', async () => {
  globalThis.archie = { kv: fakeKv({ [SETTINGS_KEY]: good() }) };
  const s = await loadSettings();
  assert.equal(s.source, 'store');
  assert.deepEqual(s.roster.map((r) => r.email), ['a@osano.com', 'b@osano.com']);
  assert.deepEqual(s.businessHours, { start: [9, 0], end: [17, 30] });
});

test('validateSettings catches each problem and canonicalises emails/names', () => {
  assert.deepEqual(validateSettings(good()), []);
  const s = good();
  s.roster[0].email = '  Ann@Osano.com ';
  s.roster[0].name = '  Ann A ';
  assert.deepEqual(validateSettings(s), []);
  assert.deepEqual(s.roster[0], { email: 'ann@osano.com', name: 'Ann A' });

  assert.match(validateSettings({ ...good(), roster: [] })[0], /at least one SE/);
  assert.match(validateSettings({ ...good(), roster: [{ email: 'nope', name: 'X' }] })[0], /not a valid email/);
  assert.match(validateSettings({ ...good(), roster: [{ email: 'a@osano.com', name: '' }] })[0], /name is required/);
  assert.match(validateSettings({ ...good(), roster: [{ email: 'a@osano.com', name: 'A' }, { email: 'A@osano.com', name: 'B' }] })[0], /listed twice/);
  assert.match(validateSettings({ ...good(), businessHours: { start: [8, 10], end: [17, 0] } })[0], /quarter-hour/);
  assert.match(validateSettings({ ...good(), businessHours: { start: [17, 0], end: [9, 0] } })[0], /start before/);
  assert.equal(validateSettings(null).length, 1);
});

test('saveSettings writes the canonical value; invalid input throws and writes nothing', async () => {
  const kv = fakeKv();
  globalThis.archie = { kv };
  const saved = await saveSettings({ ...good(), extra: 'dropped' });
  assert.deepEqual(kv.dump()[SETTINGS_KEY], saved);
  assert.equal('extra' in saved, false);

  await assert.rejects(saveSettings({ ...good(), roster: [] }), (err) => err.problems.length === 1);
  assert.deepEqual(kv.dump()[SETTINGS_KEY], saved, 'unchanged after a rejected save');
});

test('localStorage fallback round-trips when the Archie SDK is absent', async () => {
  const m = new Map();
  globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
  await saveSettings(good());
  assert.equal((await loadSettings()).source, 'store');
});
