import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickableEvents, sesForEvent, mergeAttendees } from './existing.js';

const AE = 'ae@osano.com';
const COLIN = 'creinhardt@osano.com';
const JOHN = 'john.allman@osano.com';
const ROSTER = [COLIN, JOHN];

// Wed 2026-11-18 local.
const t = (h, m = 0) => new Date(2026, 10, 18, h, m).getTime();
const iso = (ms) => new Date(ms).toISOString();
const NOW = t(12);

const timed = (id, s, e, extra = {}) => ({ id, summary: id, start: { dateTime: iso(s) }, end: { dateTime: iso(e) }, ...extra });

test('pickableEvents: keeps staffable timed meetings and maps the fields', () => {
  const items = [
    timed('normal', t(14), t(15), {
      etag: '"1"',
      htmlLink: 'L',
      organizer: { email: 'AE@osano.com' },
      attendees: [{ email: AE, self: true, organizer: true, responseStatus: 'accepted' }, { email: 'Jane@Acme.com', responseStatus: 'needsAction' }],
    }),
  ];
  const [ev] = pickableEvents(items, { now: NOW, me: AE, roster: ROSTER });
  assert.deepEqual(ev, {
    id: 'normal',
    etag: '"1"',
    htmlLink: 'L',
    title: 'normal',
    start: t(14),
    end: t(15),
    attendees: items[0].attendees,
    attendeeEmails: [AE, 'jane@acme.com'],
    organizerIsMe: true,
    guestsCanInviteOthers: true,
    recurringEventId: null,
    seOnEvent: null,
  });
});

test('pickableEvents: drops all-day, cancelled, non-default types, ended, and declined-by-me; keeps in-progress and no-attendee events', () => {
  const items = [
    { id: 'allday', summary: 'OOO', start: { date: '2026-11-18' }, end: { date: '2026-11-19' } },
    timed('cancelled', t(14), t(15), { status: 'cancelled' }),
    timed('focus', t(14), t(15), { eventType: 'focusTime' }),
    timed('ooo', t(14), t(15), { eventType: 'outOfOffice' }),
    timed('ended', t(9), t(10)),
    timed('ends-now', t(11), NOW),
    timed('declined', t(14), t(15), { attendees: [{ email: AE, self: true, responseStatus: 'declined' }] }),
    timed('in-progress', t(11, 30), t(12, 30)),
    timed('placeholder', t(16), t(16, 30)), // no attendees at all
    timed('default-type', t(16), t(17), { eventType: 'default' }),
  ];
  const ids = pickableEvents(items, { now: NOW, me: AE, roster: ROSTER }).map((e) => e.id);
  assert.deepEqual(ids, ['in-progress', 'placeholder', 'default-type']);
});

test('pickableEvents: SE already attending → seOnEvent (declined SE does not count); guest flags; recurring instance; untitled', () => {
  const items = [
    timed('with-john', t(14), t(15), { attendees: [{ email: AE, self: true }, { email: 'John.Allman@osano.com', responseStatus: 'accepted' }] }),
    timed('john-declined', t(14), t(15), { attendees: [{ email: AE, self: true }, { email: JOHN, responseStatus: 'declined' }] }),
    timed('guest', t(14), t(15), { organizer: { email: 'jane@acme.com' }, guestsCanInviteOthers: false, attendees: [{ email: AE, self: true }] }),
    timed('recurring', t(14), t(15), { recurringEventId: 'series1', summary: '  ' }),
  ];
  const out = pickableEvents(items, { now: NOW, me: AE, roster: ROSTER });
  assert.equal(out[0].seOnEvent, JOHN);
  assert.equal(out[1].seOnEvent, null);
  assert.equal(out[2].organizerIsMe, false);
  assert.equal(out[2].guestsCanInviteOthers, false);
  assert.equal(out[3].recurringEventId, 'series1');
  assert.equal(out[3].title, '(No title)');
});

const busy = (...ranges) => ({ busy: ranges.map(([s, e]) => ({ start: iso(s), end: iso(e) })) });
const ev = (s, e, attendees = []) => ({ start: s, end: e, attendees });

test('sesForEvent: exact [start,end) overlap against raw FreeBusy, half-open edges, roster order', () => {
  const calendars = {
    [COLIN]: busy([t(13), t(14)], [t(15), t(16)]), // free 14–15 exactly; busy touching both edges
    [JOHN]: busy([t(14, 15), t(14, 30)]), // busy inside the slot
  };
  assert.deepEqual(sesForEvent(ev(t(14), t(15)), calendars, ROSTER, AE), { onEvent: [], free: [COLIN], unreadable: [] });
  // Slot shifted 1 min into Colin's 13–14 meeting → Colin not free; John's 14:15 block is now outside → free.
  assert.deepEqual(sesForEvent(ev(t(13, 59), t(14, 14)), calendars, ROSTER, AE).free, [JOHN]);
  // Early-morning event works: no business-hours clipping.
  assert.deepEqual(sesForEvent(ev(t(7), t(7, 30)), calendars, ROSTER, AE).free, [COLIN, JOHN]);
});

test('sesForEvent: SEs on the invite (any RSVP) are reported, never candidates; the AE is skipped; unreadable calendars reported', () => {
  const calendars = { [COLIN]: { busy: [] }, [JOHN]: { errors: [{ reason: 'notFound' }] } };
  const r = sesForEvent(ev(t(14), t(15), [{ email: 'CReinhardt@osano.com', responseStatus: 'declined' }]), calendars, ROSTER, AE);
  assert.deepEqual(r, { onEvent: [COLIN], free: [], unreadable: [JOHN] });
  // Missing from the map entirely → unreadable; the AE on the roster is skipped, not a candidate.
  const r2 = sesForEvent(ev(t(14), t(15)), { [COLIN]: { busy: [] } }, [AE, COLIN, JOHN], AE);
  assert.deepEqual(r2, { onEvent: [], free: [COLIN], unreadable: [JOHN] });
});

test('mergeAttendees: appends the SE once (case-insensitive), preserves existing entries by reference, adds a missing organizer pre-accepted', () => {
  const existing = [{ email: AE, self: true, responseStatus: 'accepted' }, { email: 'jane@acme.com', responseStatus: 'tentative', optional: true }];
  const merged = mergeAttendees(existing, COLIN, { organizer: AE });
  assert.equal(merged.length, 3);
  assert.equal(merged[0], existing[0]);
  assert.equal(merged[1], existing[1]);
  assert.deepEqual(merged[2], { email: COLIN });
  assert.notEqual(merged, existing, 'a new array');
  assert.equal(mergeAttendees(merged, 'CReinhardt@osano.com', { organizer: AE }).length, 3, 'idempotent');
  // No attendees at all and the AE organises: AE first, pre-accepted, then the SE.
  assert.deepEqual(mergeAttendees([], JOHN, { organizer: AE }), [{ email: AE, responseStatus: 'accepted' }, { email: JOHN }]);
  // Not the organiser: only the SE is added.
  assert.deepEqual(mergeAttendees(undefined, JOHN), [{ email: JOHN }]);
});
