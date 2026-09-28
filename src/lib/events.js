// Google Calendar event creation (Project Plan §11). The only write the app makes to Google.
// Creates the booking on the signed-in AE's primary calendar with the assigned SE invited.
// Never reads events. No DOM code.

const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

/**
 * @param {string} accessToken  Google OAuth access token with the calendar.events scope
 * @param {{
 *   summary: string, description?: string,
 *   start: number|Date, end: number|Date,          // epoch ms or Date; end is exclusive
 *   attendees: string[],                           // emails; the AE (token owner) is organizer regardless
 *   timeZone?: string                              // IANA zone for display; defaults to the viewer's
 * }} event
 * @returns {Promise<{ id: string, htmlLink: string }>}
 * @throws {Error & { status?: number }}  Non-2xx responses carry the HTTP status (401 = token expired).
 */
export async function createEvent(accessToken, { summary, description = '', start, end, attendees, timeZone }) {
  const tz = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body = {
    summary,
    description,
    start: { dateTime: new Date(start).toISOString(), timeZone: tz },
    end: { dateTime: new Date(end).toISOString(), timeZone: tz },
    attendees: [...new Set(attendees)].map((email) => ({ email })),
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
  if (!res.ok) {
    const err = new Error(`Couldn't create the calendar event: ${res.status} ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return { id: data.id, htmlLink: data.htmlLink };
}
