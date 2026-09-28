// Google Calendar FreeBusy API call. Returns the raw per-calendar map; see availability.js for interpretation.

const FREEBUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy';

/**
 * @param {string} accessToken  Google OAuth access token (see auth.js)
 * @param {{ timeMin: Date, timeMax: Date, ids: string[] }} opts
 *   timeMax is exclusive. ids are calendar IDs (emails); never mix in "primary".
 * @returns {Promise<Record<string, { busy?: {start:string,end:string}[], errors?: {reason:string}[] }>>}
 *   Keyed by calendar ID. A missing key is an error, not "free".
 * @throws {Error & { status?: number }}  Non-2xx responses carry the HTTP status (401 = token expired).
 */
export async function fetchFreeBusy(accessToken, { timeMin, timeMax, ids }) {
  const uniqueIds = [...new Set(ids)];
  const res = await fetch(FREEBUSY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin: new Date(timeMin).toISOString(),
      timeMax: new Date(timeMax).toISOString(),
      items: uniqueIds.map((id) => ({ id })),
    }),
  });
  if (!res.ok) {
    const err = new Error(`FreeBusy request failed: ${res.status} ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return data.calendars ?? {};
}
