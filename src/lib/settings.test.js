import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, saveSettings, validateSettings, isAdmin, defaultSettings, featureEnabled, SETTINGS_KEY, hubspotTokenStatus, setHubspotToken } from './settings.js';
import { FEATURES } from './config.js';

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
  assert.deepEqual({ roster: s.roster, businessHours: s.businessHours, features: s.features }, defaultSettings());

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

// ---- Feature flags (Settings → Features) ----

test('a stored value from before feature flags existed still loads, with the config.js defaults filled in', async () => {
  globalThis.archie = { kv: fakeKv({ [SETTINGS_KEY]: good() }) }; // no `features` key at all
  const s = await loadSettings();
  assert.equal(s.source, 'store');
  assert.deepEqual(s.features, FEATURES);
});

test('validateSettings: missing flags take the default, unknown flags are dropped, bad levels are a problem', () => {
  const s = { ...good(), features: { bogus: 'all' } };
  assert.deepEqual(validateSettings(s), []);
  assert.deepEqual(s.features, FEATURES, 'canonicalised in place');

  const t = { ...good(), features: { availabilityToggle: 'everyone' } };
  assert.match(validateSettings(t)[0], /not one of off \/ admins \/ all/);
  assert.deepEqual(validateSettings({ ...good(), features: { availabilityToggle: 'all' } }), []);
});

test('saveSettings persists the flags and loadSettings returns them', async () => {
  const kv = fakeKv();
  globalThis.archie = { kv };
  const saved = await saveSettings({ ...good(), features: { availabilityToggle: 'off' } });
  assert.deepEqual(saved.features, { availabilityToggle: 'off' });
  assert.deepEqual((await loadSettings()).features, { availabilityToggle: 'off' });
});

test('featureEnabled: off hides for all, admins shows to the allow-list only, all shows to everyone; unknown flag → default', () => {
  const at = (level) => ({ ...good(), features: { availabilityToggle: level } });
  const admin = 'creinhardt@osano.com';
  const ae = 'someone@osano.com';
  assert.equal(featureEnabled(at('off'), 'availabilityToggle', { email: admin }), false);
  assert.equal(featureEnabled(at('admins'), 'availabilityToggle', { email: admin }), true);
  assert.equal(featureEnabled(at('admins'), 'availabilityToggle', { email: ae }), false);
  assert.equal(featureEnabled(at('admins'), 'availabilityToggle', { email: ae, admin: true }), true, 'fixture override');
  assert.equal(featureEnabled(at('all'), 'availabilityToggle', { email: ae }), true);
  // Settings without the flag (or without `features`) fall back to config.js, never to "shown".
  assert.equal(featureEnabled(good(), 'availabilityToggle', { email: ae }), FEATURES.availabilityToggle === 'all');
  assert.equal(featureEnabled(good(), 'noSuchFlag', { email: admin }), false);
});

test('localStorage fallback round-trips when the Archie SDK is absent', async () => {
  const m = new Map();
  globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
  await saveSettings(good());
  assert.equal((await loadSettings()).source, 'store');
});

test('hubspotTokenStatus: no vault on localhost; stored/not stored on Archie; list errors read as not stored', async () => {
  assert.deepEqual(await hubspotTokenStatus(), { vault: false, stored: false });
  globalThis.archie = { secrets: { async list() { return ['other']; } } };
  assert.deepEqual(await hubspotTokenStatus(), { vault: true, stored: false });
  globalThis.archie = { secrets: { async list() { return ['other', 'hubspot']; } } };
  assert.deepEqual(await hubspotTokenStatus(), { vault: true, stored: true });
  globalThis.archie = { secrets: { async list() { throw new Error('down'); } } };
  assert.deepEqual(await hubspotTokenStatus(), { vault: true, stored: false });
});

test('setHubspotToken: validates the shape, trims quotes, writes under the configured name, refuses without a vault', async () => {
  const writes = [];
  globalThis.archie = { secrets: { async set(name, value) { writes.push([name, value]); } } };
  await setHubspotToken('  "pat-test-0000000000000000000000000000"  ');
  assert.deepEqual(writes, [['hubspot', 'pat-test-0000000000000000000000000000']]);
  await assert.rejects(setHubspotToken('hubspot-app-name'), /start with "pat-"/);
  await assert.rejects(setHubspotToken(''), /start with "pat-"/);
  assert.equal(writes.length, 1, 'nothing written on rejection');
  delete globalThis.archie;
  await assert.rejects(setHubspotToken('pat-test-0000000000000000000000000000'), /No secrets vault/);
});
