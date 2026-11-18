// "Add an SE to an existing meeting" (Project Plan §9, graduated from backlog #12). Pure. No DOM.
//
// The AE picks one of their OWN events for the visible week; the app works out which roster SEs
// are free for exactly that slot, the fairness rule picks one, and the SE is added as an attendee.
// Everything here is client-side and transient: the event list is read on request and never stored.
// SE calendars stay FreeBusy-only; the per-SE check below uses the raw FreeBusy map, not the
// business-hours-clipped `seFree`, so a 7 AM or 6 PM meeting works and no minimum length applies.
import { overlaps } from './intervals.js';

const lower = (s) => String(s ?? '').toLowerCase();

/**
 * Normalise Google's `events.list` items into what the picker needs, dropping what can't be
 * staffed: all-day events, cancelled ones, non-meeting types (OOO, focus time, working location,
 * birthdays), meetings that have already ended, and invites the AE declined. Order is preserved
 * (Google returns start order). Events with no attendees (a self-made placeholder) are kept.
 *
 * @param {object[]} items  raw items from events.js listEvents
 * @param {{ now: number, me: string, roster: string[] }} ctx  roster = SE emails
 * @returns {Array<{
 *   id: string, etag?: string, htmlLink?: string, title: string,
 *   start: number, end: number,                         // epoch ms
 *   attendees: object[],                                // raw entries, for the PATCH (RSVPs preserved)
 *   attendeeEmails: string[],                           // lower-cased
 *   organizerIsMe: boolean, guestsCanInviteOthers: boolean,
 *   recurringEventId: string|null,
 *   seOnEvent: string|null,                             // first roster SE already attending (not declined)
 * }>}
 */
export function pickableEvents(items, { now, me, roster }) {
  const meL = lower(me);
  const rosterL = roster.map(lower);
  const out = [];
  for (const it of items ?? []) {
    if (!it?.start?.dateTime || !it?.end?.dateTime) continue; // all-day
    if (it.status === 'cancelled') continue;
    if (it.eventType && it.eventType !== 'default') continue;
    const start = Date.parse(it.start.dateTime);
    const end = Date.parse(it.end.dateTime);
    if (!(end > now)) continue;
    const attendees = Array.isArray(it.attendees) ? it.attendees : [];
    const mine = attendees.find((a) => a.self || lower(a.email) === meL);
    if (mine?.responseStatus === 'declined') continue;
    const attendeeEmails = attendees.map((a) => lower(a.email)).filter(Boolean);
    const organizerIsMe = Boolean(it.organizer?.self || lower(it.organizer?.email) === meL);
    const seOnEvent =
      rosterL.find((se) => attendees.some((a) => lower(a.email) === se && a.responseStatus !== 'declined')) ?? null;
    out.push({
      id: it.id,
      etag: it.etag,
      htmlLink: it.htmlLink,
      title: it.summary?.trim() || '(No title)',
      start,
      end,
      attendees,
      attendeeEmails,
      organizerIsMe,
      guestsCanInviteOthers: it.guestsCanInviteOthers !== false,
      recurringEventId: it.recurringEventId ?? null,
      seOnEvent,
    });
  }
  return out;
}

/**
 * Which roster SEs can take this exact event. `calendars` is the raw FreeBusy map from
 * availability.js (`data.calendars`): { [email]: { busy: [{start,end ISO}], errors? } }.
 *  - onEvent: roster SEs already on the invite, in ANY response state. A declined SE shows as
 *    free in FreeBusy, but re-picking them would re-invite someone who said no.
 *  - free: candidates (roster − onEvent − the AE) with no busy interval overlapping [start, end).
 *  - unreadable: candidates whose calendar is missing from the map or returned an error.
 * All lists are in roster order.
 * @returns {{ onEvent: string[], free: string[], unreadable: string[] }}
 */
export function sesForEvent(event, calendars, rosterEmails, me) {
  const meL = lower(me);
  const onInvite = new Set((event.attendees ?? []).map((a) => lower(a.email)));
  const slot = { start: event.start, end: event.end };
  const onEvent = [];
  const free = [];
  const unreadable = [];
  for (const se of rosterEmails) {
    const seL = lower(se);
    if (seL === meL) continue;
    if (onInvite.has(seL)) {
      onEvent.push(se);
      continue;
    }
    const cal = calendars?.[se] ?? calendars?.[seL];
    if (!cal || cal.errors?.length) {
      unreadable.push(se);
      continue;
    }
    const busy = (cal.busy ?? []).map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
    if (!busy.some((b) => overlaps(b, slot))) free.push(se);
  }
  return { onEvent, free, unreadable };
}

/**
 * The attendee list to PATCH back: every existing entry untouched (Google keeps the RSVPs you send
 * back), plus the SE unless already present. When the AE organises the event but has no attendee
 * entry (an event with no guests), they are added pre-accepted, as createEvent does, so their own
 * meeting doesn't turn into a pending invite. Idempotent; returns a new array.
 * @param {object[]} existing
 * @param {string} email  the SE
 * @param {{ organizer?: string }} [opts]  the AE's email when they organise the event
 */
export function mergeAttendees(existing, email, { organizer } = {}) {
  const out = [...(existing ?? [])];
  const has = (e) => out.some((a) => lower(a.email) === lower(e));
  if (organizer && !has(organizer)) out.unshift({ email: organizer, responseStatus: 'accepted' });
  if (!has(email)) out.push({ email });
  return out;
}
