import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createEvent } from './events.js';

let calls;
function fakeFetch(status, json, text = '') {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => json, text: async () => text };
  };
}

beforeEach(() => {
  calls = [];
});

test('posts the event to the primary calendar with invites sent, and returns id + link', async () => {
  fakeFetch(200, { id: 'evt1', htmlLink: 'https://calendar.google.com/event?eid=abc', extra: 'ignored' });
  const start = new Date(2026, 8, 24, 10, 15).getTime();
  const end = start + 30 * 60_000;
  const out = await createEvent('tok', {
    summary: 'Osano // ACME - Cookie Consent Demo',
    description: 'Products: Cookie Consent',
    start,
    end,
    attendees: ['ae@osano.com', 'se@osano.com', 'se@osano.com'],
    timeZone: 'America/Chicago',
  });
  assert.deepEqual(out, { id: 'evt1', htmlLink: 'https://calendar.google.com/event?eid=abc' });

  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, 'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer tok');
  const body = JSON.parse(init.body);
  assert.equal(body.summary, 'Osano // ACME - Cookie Consent Demo');
  assert.equal(body.description, 'Products: Cookie Consent');
  assert.deepEqual(body.start, { dateTime: new Date(start).toISOString(), timeZone: 'America/Chicago' });
  assert.deepEqual(body.end, { dateTime: new Date(end).toISOString(), timeZone: 'America/Chicago' });
  assert.deepEqual(body.attendees, [{ email: 'ae@osano.com' }, { email: 'se@osano.com' }], 'attendees deduped');
});

test('defaults the display time zone to the viewer\'s and description to empty', async () => {
  fakeFetch(200, { id: 'e', htmlLink: 'l' });
  await createEvent('tok', { summary: 's', start: 0, end: 1, attendees: [] });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.start.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.equal(body.description, '');
});

test('a non-2xx response throws with the HTTP status attached', async () => {
  fakeFetch(401, {}, 'Invalid Credentials');
  await assert.rejects(createEvent('stale', { summary: 's', start: 0, end: 1, attendees: [] }), (err) => {
    assert.equal(err.status, 401);
    assert.match(err.message, /401 Invalid Credentials/);
    return true;
  });
  fakeFetch(403, {}, 'insufficientPermissions');
  await assert.rejects(createEvent('tok', { summary: 's', start: 0, end: 1, attendees: [] }), (err) => err.status === 403);
});
