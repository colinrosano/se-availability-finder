// Google Calendar events (Project Plan §9, §11): the app's only Google writes, plus one read.
//  - createEvent: the booking on the signed-in AE's primary calendar with the assigned SE invited.
//  - listEvents / patchAttendees: the "add an SE to an existing meeting" flow lists the AE's OWN
//    events for the visible week (on request, never stored) and adds the SE to the one they pick.
// SE calendars are never read; availability always comes from FreeBusy. No DOM code.

const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

function httpError(prefix, status, text) {
  const err = new Error(`${prefix}: ${status} ${text}`);
  err.status = status;
  return err;
}

// Only the fields the picker and the attendee patch need; nothing else leaves Google.
const LIST_FIELDS =
  'items(id,etag,htmlLink,summary,status,eventType,start,end,recurringEventId,organizer(email,self),attendees(email,responseStatus,self,organizer,optional,displayName),guestsCanInviteOthers)';

/**
 * The AE's own events between timeMin and timeMax, as Google returns them (instances of recurring
 * events, in start order). Google's timeMin filters on an event's END, so a meeting already in
 * progress is still returned. No pagination: 250 is Google's page cap and one person's Mon–Fri
 * week never approaches it.
 * @returns {Promise<object[]>} raw `items`
 * @throws {Error & { status?: number }}
 */
export async function listEvents(accessToken, { timeMin, timeMax, maxResults = 250 }) {
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    timeMin: new Date(timeMin).toISOString(),
    timeMax: new Date(timeMax).toISOString(),
    maxResults: String(maxResults),
    fields: LIST_FIELDS,
  });
  const res = await fetch(`${EVENTS_URL}?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw httpError("Couldn't list your calendar events", res.status, await res.text());
  const data = await res.json();
  return data.items ?? [];
}

/**
 * Replace an event's attendee list (Google's PATCH replaces the whole array, so pass the merged
 * list — see existing.js mergeAttendees). Nothing but `attendees` is sent: title, description, and
 * time stay exactly as they are. sendUpdates=all → the new SE gets an invite and everyone already
 * on the event gets Google's "updated invitation", the same as adding a guest by hand.
 * @param {Array<{ email: string }>} attendees  full list, existing entries untouched
 * @returns {Promise<{ id: string, htmlLink: string }>}
 * @throws {Error & { status?: number }}  403 = the AE may not change this event (guest, invites off)
 */
export async function patchAttendees(accessToken, eventId, attendees) {
  const res = await fetch(`${EVENTS_URL}/${encodeURIComponent(eventId)}?sendUpdates=all`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ attendees }),
  });
  if (!res.ok) throw httpError("Couldn't update the calendar event", res.status, await res.text());
  const data = await res.json();
  return { id: data.id, htmlLink: data.htmlLink };
}

/**
 * @param {string} accessToken  Google OAuth access token with the calendar.events scope
 * @param {{
 *   summary: string, description?: string,
 *   start: number|Date, end: number|Date,          // epoch ms or Date; end is exclusive
 *   attendees: string[],                           // emails; the AE (token owner) is organizer regardless
 *   organizer?: string,                            // the AE's email: their own attendee entry is pre-accepted,
 *                                                  // otherwise Google leaves it as "needsAction" and the AE
 *                                                  // has to accept their own booking
 *   timeZone?: string                              // IANA zone for display; defaults to the viewer's
 * }} event
 * @returns {Promise<{ id: string, htmlLink: string }>}
 * @throws {Error & { status?: number }}  Non-2xx responses carry the HTTP status (401 = token expired).
 */
export async function createEvent(accessToken, { summary, description = '', start, end, attendees, organizer, timeZone }) {
  const tz = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const isOrganizer = (email) => organizer && email.toLowerCase() === organizer.toLowerCase();
  const body = {
    summary,
    description,
    start: { dateTime: new Date(start).toISOString(), timeZone: tz },
    end: { dateTime: new Date(end).toISOString(), timeZone: tz },
    attendees: [...new Set(attendees)].map((email) => (isOrganizer(email) ? { email, responseStatus: 'accepted' } : { email })),
  };
  // sendUpdates=all → Google emails the invite to attendees (the SE), like a hand-made event.
  const res = await fetch(`${EVENTS_URL}?sendUpdates=all`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw httpError("Couldn't create the calendar event", res.status, await res.text());
  const data = await res.json();
  return { id: data.id, htmlLink: data.htmlLink };
}
