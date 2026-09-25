// App configuration. Nothing here is a secret (the OAuth Client ID is public by design).

// Google OAuth client (Web). Registered origins: http://localhost:5173 and the Archie origin.
export const CLIENT_ID = '521631312959-uasjdvfko1f9r50gk4d3emoilkisb147.apps.googleusercontent.com';

// Lets us read free/busy for other people's calendars (not just our own).
export const SCOPE = 'https://www.googleapis.com/auth/calendar.events.freebusy';

// The full SE roster. Availability is always computed against everyone here.
export const SE_EMAILS = ['creinhardt@osano.com', 'john.allman@osano.com'];

// Identity used when running locally (no Archie SDK available).
export const DEV_EMAIL = 'creinhardt@osano.com';

// Window = rest of today + this many Mon–Fri days.
export const BUSINESS_DAYS_AHEAD = 5;

// 9 AM – 5 PM in the viewer's local time zone.
export const BUSINESS_HOURS = { start: 9, end: 17 };

// Free gaps shorter than this are not worth showing.
export const MIN_FREE_MINUTES = 30;
export const MIN_FREE_MS = MIN_FREE_MINUTES * 60 * 1000;
