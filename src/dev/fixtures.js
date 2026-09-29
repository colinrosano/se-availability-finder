// Localhost-only synthetic calendars, for exercising specific availability scenarios that real
// calendars rarely produce. Loaded by app.js ONLY when the page is on localhost AND the URL has
// ?fixture=<name>. Excluded from the Archie zip. Nothing here touches Google or HubSpot.
//
// Usage: http://localhost:5173/?fixture=segments   (navigate to a week that is not mostly past)

const COLIN = 'creinhardt@osano.com';
const JOHN = 'john.allman@osano.com';
const AE = 'fixture.ae@osano.com'; // a non-SE viewer, so both SEs appear

const MIN = 60_000;
const at = (day, [h, m]) => new Date(new Date(day).setHours(h, m, 0, 0)).getTime();

/**
 * Per weekday (1 = Mon … 5 = Fri), each person's FREE ranges; everything else is busy.
 * 'open' = free all day. Missing = busy all day.
 */
const SEGMENTS_FREE = {
  // Mon — label-split blocks: 10:00–10:30 [Colin], 10:30–11:00 [Colin·John], 11:00–11:30 [John].
  // At 60 min: 10:00 (Colin) and 10:30 (John) are bookable; the 11:00 block must disappear.
  1: { [COLIN]: [[[10, 0], [11, 0]]], [JOHN]: [[[10, 30], [11, 30]]] },
  // Tue — a 33-minute block (10:07–10:40) with no quarter-aligned 30-min start: must be hidden.
  // The afternoon block is the only thing that should show.
  2: { [COLIN]: [[[10, 7], [10, 40]], [[13, 0], [15, 0]]] },
  // Wed — adjacent blocks with different SEs: 9–10 [Colin], 10–11 [John].
  // At 60 min: chips 9:00 and 10:00 only; 9:30 fits nobody.
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
async function segmentsFreeBusy(_token, { timeMin, timeMax, ids }) {
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
      else busy = busyFromFree(day, SEGMENTS_FREE[wd]?.[id]);
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

export const fixtures = {
  segments: {
    label: 'segments — label-split blocks (Mon), unaligned short block (Tue), adjacent SEs (Wed)',
    me: AE,
    freeBusy: segmentsFreeBusy,
    createEvent: fakeCreateEvent,
    ledgerKey: 'ledger:fixture', // keep fake bookings out of the real (localhost) ledger
  },
};
