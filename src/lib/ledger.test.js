import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readLedger, recordAssignment, LEDGER_KEY } from './ledger.js';

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

beforeEach(() => {
  delete globalThis.archie;
  delete globalThis.localStorage;
});

test('empty or malformed ledger reads as []', async () => {
  globalThis.archie = { kv: fakeKv() };
  assert.deepEqual(await readLedger(), []);
  globalThis.archie = { kv: fakeKv({ [LEDGER_KEY]: { not: 'an array' } }) };
  assert.deepEqual(await readLedger(), []);
  globalThis.archie = { kv: fakeKv({ [LEDGER_KEY]: [{ se: 'a@osano.com', at: '2026-09-01T00:00:00.000Z' }, { junk: true }] }) };
  assert.deepEqual(await readLedger(), [{ se: 'a@osano.com', at: '2026-09-01T00:00:00.000Z' }]);
});

test('recordAssignment appends to archie.kv when on Archie', async () => {
  const kv = fakeKv();
  globalThis.archie = { kv };
  const at = new Date(2026, 8, 28, 10);
  const after = await recordAssignment('a@osano.com', at);
  assert.deepEqual(after, [{ se: 'a@osano.com', at: at.toISOString() }]);
  assert.deepEqual(kv.dump()[LEDGER_KEY], after);
  await recordAssignment('b@osano.com', new Date(2026, 8, 28, 11));
  assert.equal((await readLedger()).length, 2);
});

test('recordAssignment prunes entries older than 60 days', async () => {
  const old = new Date(Date.now() - 61 * DAY).toISOString();
  const recent = new Date(Date.now() - 59 * DAY).toISOString();
  globalThis.archie = { kv: fakeKv({ [LEDGER_KEY]: [{ se: 'a@osano.com', at: old }, { se: 'b@osano.com', at: recent }] }) };
  const after = await recordAssignment('c@osano.com');
  assert.deepEqual(after.map((e) => e.se), ['b@osano.com', 'c@osano.com']);
});

test('falls back to localStorage when the Archie SDK is absent', async () => {
  const ls = fakeLocalStorage();
  globalThis.localStorage = ls;
  await recordAssignment('a@osano.com', new Date(2026, 8, 28, 10));
  assert.equal(JSON.parse(ls.dump()[LEDGER_KEY]).length, 1);
  assert.equal((await readLedger())[0].se, 'a@osano.com');
});

test('a throwing store reads as [] rather than breaking the page', async () => {
  globalThis.archie = { kv: { async get() { throw new Error('kv down'); }, async set() {} } };
  assert.deepEqual(await readLedger(), []);
});

test('a custom key keeps a separate ledger (fixture mode never touches the real one)', async () => {
  const kv = fakeKv();
  globalThis.archie = { kv };
  await recordAssignment('a@osano.com', new Date(), { key: 'ledger:fixture' });
  assert.deepEqual(await readLedger(), []);
  assert.equal((await readLedger({ key: 'ledger:fixture' })).length, 1);
  assert.deepEqual(Object.keys(kv.dump()), ['ledger:fixture']);
});
