// App configuration. Nothing here is a secret (the OAuth Client ID is public by design).

// Google OAuth client (Web). Registered origins: http://localhost:5173 and the Archie origin.
export const CLIENT_ID = '521631312959-uasjdvfko1f9r50gk4d3emoilkisb147.apps.googleusercontent.com';

// Two scopes, space-separated (Project Plan §6):
//  - calendar.events.freebusy: read free/busy for other people's calendars (not just our own)
//  - calendar.events: create the app's own bookings on the AE's calendar (v1.5). Never used to read.
export const SCOPE = [
  'https://www.googleapis.com/auth/calendar.events.freebusy',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

// Default SE roster. Availability is always computed against the whole roster. Admins can edit
// the live roster in the app (stored in the Archie config store, see settings.js); this is the
// seed and the fallback when nothing is stored.
export const SE_ROSTER = [
  { email: 'creinhardt@osano.com', name: 'Colin Reinhardt' },
  { email: 'john.allman@osano.com', name: 'John Allman' },
];
export const SE_EMAILS = SE_ROSTER.map((se) => se.email);

// Who may open the Settings panel (roster + business hours). A UI gate, not a security boundary.
export const ADMIN_EMAILS = ['creinhardt@osano.com', 'john.allman@osano.com'];

// Identity used when running locally (no Archie SDK available).
export const DEV_EMAIL = 'creinhardt@osano.com';

// Default business hours as [hour, minute], in the viewer's local time zone (admin-editable, as
// above). v1 ships with 8:30 AM – 5:30 PM (Project Plan / backlog item 9).
export const BUSINESS_HOURS = { start: [8, 30], end: [17, 30] };

// ---- HubSpot (v2, Project Plan §12) ----
// `portalId` is Osano's production portal ("Osano (Production)"). The private-app token is NEVER
// in code: on Archie it lives in the secrets vault under `secretName` and every call goes through
// archie.secrets.proxy; locally, scripts/dev-proxy.mjs injects it from the HUBSPOT_TOKEN env var.
// Rotate it with `archie.secrets.set('hubspot', <token>)` from the deployed app's console.
// `required`: when true, Book refuses without a linked deal (the plan's v2 rule).
export const HUBSPOT = {
  portalId: '4785246',
  secretName: 'hubspot',
  required: false,
  devProxy: 'http://localhost:8787', // scripts/dev-proxy.mjs, localhost only
};

// Minimum slot lengths the AE can filter by (minutes). The first is the default.
export const DURATION_OPTIONS = [30, 45, 60];

// Free gaps shorter than this are not worth showing.
export const MIN_FREE_MINUTES = DURATION_OPTIONS[0];
export const MIN_FREE_MS = MIN_FREE_MINUTES * 60 * 1000;
