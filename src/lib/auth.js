// Google sign-in (access token) and "who am I" (Archie identity). No DOM code.
//
// Google Identity Services (GIS) is loaded by the page via
//   <script src="https://accounts.google.com/gsi/client" async defer></script>
// and exposes the `google` global. The Archie SDK is loaded via
//   <script src="/_platform/sdk.js"></script>
// and exposes `archie` (missing on localhost, which is fine).
//
// Token renewal (Project Plan §6, Option A): the consent grant persists; only the ~1-hour access
// token expires. Callers request a token silently on page load and again ~10 minutes before
// expiry (`prompt: ''` + the viewer's email as `hint`, so no account chooser appears). Any silent
// failure — popup blocked, signed-out browser, revoked grant — falls back to the visible Connect
// button. The token is returned to the caller and never stored by this module.
import { CLIENT_ID, SCOPE, DEV_EMAIL } from './config.js';

const DEFAULT_EXPIRES_IN_S = 3600; // Google omits expires_in only in odd cases; assume the usual hour

let tokenClient; // created once, reused for every request
let pending; // { resolve, reject } for the request currently waiting on the popup

// The GIS script is loaded with `async defer`, so it may not be ready the instant a module
// runs or a user clicks. Poll briefly for the global instead of failing immediately.
const GIS_WAIT_MS = 5000;
const GIS_POLL_MS = 50;

async function waitForGis() {
  const deadline = Date.now() + GIS_WAIT_MS;
  while (Date.now() < deadline) {
    const gis = globalThis.google?.accounts?.oauth2;
    if (gis) return gis;
    await new Promise((r) => setTimeout(r, GIS_POLL_MS));
  }
  throw new Error('Google Identity Services did not load. Is the gsi/client script tag on the page?');
}

async function getTokenClient() {
  if (tokenClient) return tokenClient;
  const gis = await waitForGis();
  tokenClient = gis.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    // Called after the consent popup closes with a token or an error.
    callback: (resp) => {
      const p = pending;
      pending = undefined;
      if (!p) return;
      if (resp.error) {
        p.reject(Object.assign(new Error(`Auth failed: ${resp.error}`), { code: resp.error }));
        return;
      }
      const expiresIn = Number(resp.expires_in) || DEFAULT_EXPIRES_IN_S;
      p.resolve({ accessToken: resp.access_token, expiresAt: Date.now() + expiresIn * 1000 });
    },
    // Called if the popup couldn't open (blocked, no user gesture) or the user closed it.
    error_callback: (err) => {
      const p = pending;
      pending = undefined;
      const code = err?.type ?? 'popup_error';
      p?.reject(Object.assign(new Error(`Auth failed: ${code}`), { code }));
    },
  });
  return tokenClient;
}

/**
 * Request a short-lived access token (~1 hr).
 *
 * @param {{ silent?: boolean, hint?: string }} [opts]
 *   hint   — the viewer's email; lets Google skip the account chooser.
 *   silent — a renewal attempt with no user gesture behind it. Behaves the same on the wire
 *            (`prompt: ''`); the flag is for callers/tests to tell the two apart.
 * @returns {Promise<{ accessToken: string, expiresAt: number }>}  expiresAt in epoch ms.
 * @throws {Error & { code?: string }}  e.g. code 'popup_failed_to_open' when a silent attempt is blocked.
 */
export async function requestAccessToken({ silent = false, hint } = {}) {
  if (pending) throw Object.assign(new Error('A sign-in request is already in progress.'), { code: 'in_progress' });
  const client = await getTokenClient();
  return new Promise((resolve, reject) => {
    pending = { resolve, reject, silent };
    // prompt: '' → no chooser/consent unless Google actually needs one (first use, signed out).
    client.requestAccessToken({ prompt: '', ...(hint ? { hint } : {}) });
  });
}

/** The signed-in viewer's email. On Archie via archie.me(); locally falls back to DEV_EMAIL. */
export async function getMe() {
  const archie = globalThis.archie;
  if (archie?.me) return (await archie.me()).email;
  return DEV_EMAIL;
}
