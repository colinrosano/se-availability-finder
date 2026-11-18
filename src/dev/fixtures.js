// Localhost-only synthetic calendars, for exercising specific availability scenarios that real
// calendars rarely produce. Loaded by app.js ONLY when the page is on localhost AND the URL has
// ?fixture=<name>. Excluded from the Archie zip. Nothing here touches Google or HubSpot.
//
// Usage: http://localhost:5173/?fixture=blocks   (navigate to a week that is not mostly past)

const COLIN = 'creinhardt@osano.com';
const JOHN = 'john.allman@osano.com';
const AE = 'fixture.ae@osano.com'; // a non-SE viewer, so both SEs appear

const MIN = 60_000;
const at = (day, [h, m]) => new Date(new Date(day).setHours(h, m, 0, 0)).getTime();

/**
 * Per weekday (1 = Mon … 5 = Fri), each person's FREE ranges; everything else is busy.
 * 'open' = free all day. Missing = busy all day.
 */
const BLOCKS_FREE = {
  // Mon — SE handoff inside one block: Colin 10:00–11:00, John 10:30–11:30 → ONE block 10:00–11:30.
  // At 60 min: chips 10:00 (Colin) and 10:30 (John) only; 10:15 and 11:00 fit no single SE.
  1: { [COLIN]: [[[10, 0], [11, 0]]], [JOHN]: [[[10, 30], [11, 30]]] },
  // Tue — a 33-minute block (10:07–10:40) with no quarter-aligned 30-min start: must be hidden.
  // The afternoon block starts at 1:07 but DRAWS from 1:15 (render start snaps up to the quarter).
  2: { [COLIN]: [[[10, 7], [10, 40]], [[13, 7], [15, 0]]] },
  // Wed — back-to-back SEs: Colin 9–10, John 10–11 → ONE block 9:00–11:00.
  // At 60 min: chips 9:00 and 10:00 only; 9:15/9:30/9:45 fit nobody (no single SE spans the handoff).
  3: { [COLIN]: [[[9, 0], [10, 0]]], [JOHN]: [[[10, 0], [11, 0]]] },
  // Thu/Fri — wide open, for normal behaviour and the copy text.
  4: { [COLIN]: 'open', [JOHN]: 'open' },
  5: { [COLIN]: 'open', [JOHN]: 'open' },
};

/** Busy = the day minus the free ranges. */
function busyFromFree(day, free) {
  if (free === 'open') return [];
  const ranges = (free ?? []).map(([s, e]) => [at(day, s), at(day, e)]);
  const out = [];
  let cursor = at(day, [0, 0]);
  for (const [s, e] of ranges) {
    if (s > cursor) out.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  const midnight = at(day, [0, 0]) + 24 * 60 * MIN;
  if (cursor < midnight) out.push([cursor, midnight]);
  return out;
}

/** Same signature as lib/freebusy.js fetchFreeBusy. */
async function blocksFreeBusy(_token, { timeMin, timeMax, ids }) {
  const calendars = {};
  for (const id of ids) calendars[id] = { busy: [] };
  const day = new Date(timeMin);
  day.setHours(0, 0, 0, 0);
  for (; day < timeMax; day.setDate(day.getDate() + 1)) {
    const wd = day.getDay();
    for (const id of ids) {
      let busy;
      if (id === AE) busy = [[at(day, [12, 0]), at(day, [13, 0])]]; // the AE's lunch, every day
      else if (wd === 0 || wd === 6) busy = [];
      else busy = busyFromFree(day, BLOCKS_FREE[wd]?.[id]);
      for (const [s, e] of busy) calendars[id].busy.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString() });
    }
  }
  return calendars;
}

/** Stand-in for lib/events.js createEvent: nothing is created anywhere. */
async function fakeCreateEvent(_token, { summary }) {
  await new Promise((r) => setTimeout(r, 300));
  return { id: `fixture-${Date.now()}`, htmlLink: `#fixture-booked-${encodeURIComponent(summary)}` };
}

// ---- "Add an SE to an existing meeting" stand-ins ----
// The AE's own calendar for the week, in Google's events.list shape. Each row exercises one rule
// of lib/existing.js against the BLOCKS_FREE calendars above:
//   Mon 10:00–10:30  Acme intro        → Colin free, John busy until 10:30 → Colin assigned
//   Thu  7:30– 8:00  Early sync        → outside business hours; both SEs free (Thu is open) → direct busy check
//   Tue 10:00–10:30  Initech discovery → Colin free 10:07–10:40 only (busy at 10:00), John busy → nobody
//   Wed 10:00–10:30  Globex demo       → John already attending → row disabled
//   Thu 14:00–15:00  Hooli kickoff     → both free → fairness pick
//   Thu all day      OOO               → all-day, filtered out
//   Fri  9:00– 9:30  Focus time        → eventType focusTime, filtered out
//   Fri 11:00–11:30  Vendor call       → AE is a guest and guests can't invite → row disabled
//   Fri 15:00–15:30  Weekly sync       → a recurring instance ("this occurrence only")
//   plus one ended event in the current week (today 00:15–00:30), filtered out
const AE_EVENTS = [
  { wd: 1, s: [10, 0], e: [10, 30], summary: 'Osano <> Acme intro', guests: ['jane@acme.com'] },
  { wd: 4, s: [7, 30], e: [8, 0], summary: 'Early sync', guests: [] },
  { wd: 2, s: [10, 0], e: [10, 30], summary: 'Initech discovery', guests: ['pat@initech.com'] },
  { wd: 3, s: [10, 0], e: [10, 30], summary: 'Globex demo', guests: ['sam@globex.com', JOHN] },
  { wd: 4, s: [14, 0], e: [15, 0], summary: 'Hooli kickoff', guests: ['gavin@hooli.com', 'jared@hooli.com'] },
  { wd: 4, allDay: true, summary: 'OOO' },
  { wd: 5, s: [9, 0], e: [9, 30], summary: 'Focus time', eventType: 'focusTime', guests: [] },
  { wd: 5, s: [11, 0], e: [11, 30], summary: 'Vendor call', guest: true, guests: ['rep@vendor.com'] },
  { wd: 5, s: [15, 0], e: [15, 30], summary: 'Weekly sync', recurring: true, guests: ['sam.seller@osano.com'] },
];

/** Same signature as lib/events.js listEvents. Returns raw Google-shaped items in start order. */
async function fakeListEvents(_token, { timeMin, timeMax }) {
  await new Promise((r) => setTimeout(r, 200));
  const items = [];
  const day = new Date(timeMin);
  day.setHours(0, 0, 0, 0);
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  for (; day < timeMax; day.setDate(day.getDate() + 1)) {
    const wd = day.getDay();
    for (const spec of AE_EVENTS.filter((x) => x.wd === wd)) {
      const id = `fx-${ymd(day)}-${spec.summary.replace(/\W+/g, '-').toLowerCase()}`;
      if (spec.allDay) {
        const next = new Date(day);
        next.setDate(next.getDate() + 1);
        items.push({ id, summary: spec.summary, status: 'confirmed', start: { date: ymd(day) }, end: { date: ymd(next) } });
        continue;
      }
      const organizer = spec.guest ? spec.guests[0] : AE;
      const attendees = [
        { email: AE, self: true, organizer: !spec.guest, responseStatus: 'accepted' },
        ...spec.guests.map((email) => ({ email, organizer: spec.guest && email === organizer, responseStatus: email === JOHN ? 'accepted' : 'needsAction' })),
      ];
      items.push({
        id,
        etag: `"${id}"`,
        htmlLink: `#fixture-event-${id}`,
        summary: spec.summary,
        status: 'confirmed',
        ...(spec.eventType ? { eventType: spec.eventType } : {}),
        start: { dateTime: new Date(at(day, spec.s)).toISOString() },
        end: { dateTime: new Date(at(day, spec.e)).toISOString() },
        organizer: { email: organizer, self: !spec.guest },
        ...(spec.guest ? { guestsCanInviteOthers: false } : {}),
        ...(spec.recurring ? { recurringEventId: 'fx-weekly-sync' } : {}),
        attendees,
      });
    }
  }
  // One meeting that already ended today, so the "ended" filter is exercised in the current week.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (today >= new Date(timeMin).setHours(0, 0, 0, 0) && today < timeMax) {
    items.push({
      id: 'fx-ended',
      summary: 'Ended earlier today',
      status: 'confirmed',
      start: { dateTime: new Date(at(today, [0, 15])).toISOString() },
      end: { dateTime: new Date(at(today, [0, 30])).toISOString() },
      organizer: { email: AE, self: true },
      attendees: [{ email: AE, self: true, organizer: true, responseStatus: 'accepted' }],
    });
  }
  items.sort((a, b) => Date.parse(a.start.dateTime ?? a.start.date) - Date.parse(b.start.dateTime ?? b.start.date));
  return items;
}

/** Stand-in for lib/events.js patchAttendees: nothing is changed anywhere. */
async function fakePatchAttendees(_token, eventId) {
  await new Promise((r) => setTimeout(r, 300));
  return { id: eventId, htmlLink: `#fixture-added-${encodeURIComponent(eventId)}` };
}

/** Stand-in for lib/hubspot.js getDeal, so the flow completes without the HubSpot dev proxy. */
async function fakeGetDeal(dealId) {
  await new Promise((r) => setTimeout(r, 200));
  return { id: String(dealId), name: `Fixture deal ${dealId}`, stageId: 'fx', stageLabel: 'Demo scheduled', companyId: null, companyName: 'Fixture Co', collaboratorIds: [] };
}

// ---- Booking log seed (admin view) ----
// Written to the fixture's own log key on every fixture boot, so the admin panel always opens on a
// known state: entries spread over the last ~60 days (so the 30-day default and "full history"
// differ), several AEs and both SEs, every call type, a company with a comma (CSV quoting), and a
// mix of linked / unlinked deals. Dates are relative to now so the data never ages out.
const LOG_KEY_FIXTURE = 'log:fixture';
const SEED_AES = ['fixture.ae@osano.com', 'sam.seller@osano.com', 'kai.closer@osano.com'];
const SEED_COMPANIES = ['Acme Corp', 'Globex, Inc.', 'Initech', 'Umbrella Health', 'Vandelay Industries', 'Hooli', 'Stark Industries', 'Wonka "Candy" Co'];
const SEED_CALL_TYPES = ['discovery', 'demo', 'trial_kickoff', 'trial_working_session', 'trial_wrap_up', 'technical_qa'];

function seedBookingLog(now = Date.now()) {
  const entries = [];
  // Deterministic spread: 26 bookings, 0–60 days ago, call 2–9 days after booking at a quarter hour.
  for (let i = 0; i < 26; i++) {
    const daysAgo = Math.round((i * i * 60) / (25 * 25)); // front-loaded: more recent bookings than old ones
    const booked = new Date(now - daysAgo * 24 * 60 * MIN);
    booked.setHours(9 + (i % 7), (i * 11) % 60, 0, 0);
    const call = new Date(booked.getTime() + (2 + (i % 8)) * 24 * 60 * MIN);
    call.setHours(10 + (i % 6), [0, 15, 30, 45][i % 4], 0, 0);
    const entry = {
      at: booked.toISOString(),
      callAt: call.toISOString(),
      ae: SEED_AES[i % SEED_AES.length],
      se: i % 3 === 0 ? JOHN : COLIN,
      callType: SEED_CALL_TYPES[i % SEED_CALL_TYPES.length],
      company: SEED_COMPANIES[i % SEED_COMPANIES.length],
    };
    if (i % 2 === 0) entry.dealId = String(30000000000 + i * 7919);
    entries.push(entry);
  }
  entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)); // append order, oldest first, like the real log
  localStorage.setItem(LOG_KEY_FIXTURE, JSON.stringify(entries));
  return entries;
}

export const fixtures = {
  blocks: {
    label: 'blocks — SE handoff inside a block (Mon), unaligned short block (Tue), back-to-back SEs (Wed); "Add an SE to it" lists synthetic meetings and accepts any deal link.',
    me: AE,
    freeBusy: blocksFreeBusy,
    createEvent: fakeCreateEvent,
    listEvents: fakeListEvents, // "Add an SE to an existing meeting": the fake AE's own calendar
    patchAttendees: fakePatchAttendees, // … and the no-op attendee write
    getDeal: fakeGetDeal, // any parseable deal link resolves, no HubSpot proxy needed
    ledgerKey: 'ledger:fixture', // keep fake bookings out of the real (localhost) ledger
    logKey: LOG_KEY_FIXTURE, // same for the booking log …
    seed: seedBookingLog, // … which is reseeded with dummy entries on every fixture boot
  },
};
