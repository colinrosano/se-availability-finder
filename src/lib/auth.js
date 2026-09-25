// Google sign-in (access token) and "who am I" (Archie identity). No DOM code.
//
// Google Identity Services (GIS) is loaded by the page via
//   <script src="https://accounts.google.com/gsi/client" async defer></script>
// and exposes the `google` global. The Archie SDK is loaded via
//   <script src="/_platform/sdk.js"></script>
// and exposes `archie` (missing on localhost, which is fine).
import { CLIENT_ID, SCOPE, DEV_EMAIL } from './config.js';

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
      if (resp.error) p.reject(new Error(`Auth failed: ${resp.error}`));
      else p.resolve(resp.access_token);
    },
    // Called if the popup couldn't open or the user closed it.
    error_callback: (err) => {
      const p = pending;
      pending = undefined;
      p?.reject(new Error(`Auth failed: ${err?.type ?? 'popup_error'}`));
    },
  });
  return tokenClient;
}

/**
 * Opens Google's consent popup and resolves with a short-lived access token (~1 hr).
 * The token is returned to the caller only; this module never stores it.
 */
export async function requestAccessToken() {
  if (pending) throw new Error('A sign-in request is already in progress.');
  const client = await getTokenClient();
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    client.requestAccessToken();
  });
}

/** The signed-in viewer's email. On Archie via archie.me(); locally falls back to DEV_EMAIL. */
export async function getMe() {
  const archie = globalThis.archie;
  if (archie?.me) return (await archie.me()).email;
  return DEV_EMAIL;
}
