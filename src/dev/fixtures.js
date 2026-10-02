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

export const fixtures = {
  blocks: {
    label: 'blocks — SE handoff inside a block (Mon), unaligned short block (Tue), back-to-back SEs (Wed)',
    me: AE,
    freeBusy: blocksFreeBusy,
    createEvent: fakeCreateEvent,
    ledgerKey: 'ledger:fixture', // keep fake bookings out of the real (localhost) ledger
  },
};
