# SE Availability Finder

Internal web app for Osano AEs to find times when they and at least one Sales Engineer are free, and (later) book SE calls directly. Replaces Slack-based scheduling. Hosted on Osano's Archie platform (archie.osano.dev).

## Current status
- **v1 spike is done and verified** (`spike/index.html`): Google sign-in + FreeBusy works on localhost and Archie, tested by a non-SE.
- **Data layer extracted** to `src/lib/` (plain ES modules, `npm test` runs `node:test` coverage). The spike is kept for reference only; do NOT port its layout or styles.
- **Week-grid UI built** in `src/` (`index.html`, `app.js`, `styles.css`) on top of `src/lib/`.
- **Deployed to Archie (Sep 28 2026)** at https://creinhardt.archie.osano.dev/se-availability-finder/ — namespace `creinhardt`, path `se-availability-finder`, slug `richard-quiet-lynx`, visibility **restricted** for the pilot: Colin (owner) plus an allow-list of pilot users (John Allman and three AEs as of the Sep 30 2026 redeploy; the live list is in the Archie dashboard). Redeploy = zip `src/` (excluding `*.test.js` and `dev/`) with `index.html` at the root, publish with the archie-deploy script + a fresh deploy token (or the Archie connector), then re-check visibility. Only on Colin's explicit ask.
- **v1.5 booking built and verified against real Google Calendar (localhost and Archie):** intake form (call type / product / duration / company / optional HubSpot deal link), window click → start-time chips (`booking.js validStarts`, quarter-hour snap-up, **15-min step** — pilot AEs chose 15 over the §11 default of 30, Sep 30 2026), auto-assigned SE (`assignment.js pickSE` over the `ledger.js` entries), Book → `events.js createEvent` on the AE's primary calendar with the SE invited (`sendUpdates=all`), then `recordAssignment`. Event first, ledger second; a ledger failure after the event exists is reported, never hidden. The popover binds to the clicked block: chips are quarter-aligned starts *inside that block* (`booking.js validStarts`), each valid only if ONE SE covers the whole slot jointly with the AE — a start that only two SEs together could span is omitted; a slot may run past the block's edge when a single SE covers it. Blocks with no valid start are dropped from the grid (§11: no empty popovers). **Fixture mode** for exercising these cases: `http://localhost:5173/?fixture=blocks` (localhost + query param only; `src/dev/fixtures.js`, excluded from the zip; fake AE, synthetic FreeBusy, no-op booking, separate ledger key). Title uses the three-band rule; the exact modules (and the deal link, if given) go in the event description. **After a successful booking a reminder dialog** (`#booked-dialog`, `app.js showBookedDialog`) lists the two follow-ups that are still manual and expected of every AE: add call notes to the HubSpot deal record (button to the deal when one was linked) and add the Zoom link to the calendar event (button to the event). The Zoom item goes away if Zoom automation lands. The success notice stays as the persistent record.
- **Copy available times (Project Plan §9, three scopes, one formatter in `slotsText.js`):** ALL (button by the week nav, `formatSlotsText` over the visible week), DAY (⧉ icon on each day header, `forDay` + `formatSlotsText`), BLOCK ("Copy these times" in the popover, `formatStartsText` over the popover's valid starts — duration-filtered by construction; runs of ≥4 consecutive starts collapse to "any time between 10:00 AM and 2:45 PM" (end includes the call length), shorter/scattered runs stay a list, runs joined with "or" — so a big block is one line, not 17 chips). Output is the AE's local zone with a label and never names or counts SEs. No cherry-pick tray (explicitly excluded).
- **Admin settings built:** SE roster + business hours live in the app store (`settings.js`, key `config:settings`, via `store.js` = `archie.kv` on Archie / localStorage locally). `config.js` values are the seed and fallback. Settings load before the first FreeBusy fetch. The Settings button shows only for `ADMIN_EMAILS` (Colin) — a UI gate, not a security boundary. Removing an SE keeps their ledger history.
- **Offerable = AE free ∩ (one SE free)**, computed per SE (`seFree`) and then merged into one block per contiguous span so SE handoffs don't produce small back-to-back blocks (`computeAvailability` → `offerable[{start,end,ses}]`, refactor/merged-blocks, Oct 1 2026). `ses` is the grid label: everyone free *somewhere* in the block ("You · Colin · John" means Colin or John, not both for the whole span — Colin accepted that nuance). The merged block is only for drawing: every chip and the assignment come from the per-SE check (`booking.js validStarts` / `sesFreeFor`). Never let two SEs' short gaps combine into a bookable slot; a start no single SE covers is not offered.

- **v2 HubSpot built (Sep 28 2026), switched to Osano's production portal and verified end to end on Archie (Sep 29 2026):** `hubspot.js` parses the pasted deal link, verifies the portal (`HUBSPOT.portalId` = `4785246`, "Osano (Production)"), looks up name/stage/company (company fills the intake, read-only), and after booking appends the SE to Deal Collaborators (`hs_all_collaborator_owner_ids`) with a Retry on failure. Both SEs resolve as owners there (Colin 221259148, John 86829564). **The token is never in code**: Archie → `archie.secrets.proxy('hubspot', …)`, set/rotated from **Settings → HubSpot** in the app (admin panel: stored/not-stored status, replace, test connection — `settings.js hubspotTokenStatus/setHubspotToken`; the vault never returns values) or via `archie.secrets.set('hubspot', <token>)` from the console; localhost → `npm run dev:hubspot` (scripts/dev-proxy.mjs, token from `HUBSPOT_TOKEN` env var). `HUBSPOT.required` is off for the pilot; the plan's v2 rule is on.

## Canonical docs
- Project Plan (source of truth for design decisions): https://app.notion.com/p/3b5af0df2a53818c924ee69027bd24b1
- Future Features backlog: https://app.notion.com/p/3bbaf0df2a53814b8b92fb22138cd62e

If a decision is settled in the Project Plan, follow it rather than reopening it.

## How to work with Colin
- Propose a plan before writing code. One scoped task per session.
- Build and test locally. **Never deploy to Archie unless Colin explicitly asks.**
- Keep it simple; the simplest approach that ships wins. Deferred ideas go to the backlog, not into the code.
- Colin is a frontend dev (React/JS, learning TypeScript). Explain Google/OAuth specifics briefly when they come up.

## Stack
- **Vanilla HTML/CSS/JS. No framework, no build step.** Don't introduce React, Vite, or a bundler.
- `src/lib/` is plain ES modules with **no DOM code**; the UI imports them via `<script type="module">`.
- Multi-file app → publish to Archie as a zip with `index.html` at the root.
- Local dev: `npm run dev` (serves `src/` on 5173), open `http://localhost:5173` (not 127.0.0.1 — OAuth origin must match exactly).

## Archie platform rules
- Upload is a single `index.html` or a zip with `index.html` at the root. Use **relative asset URLs**; never hard-code host, slug, or path.
- SDK: `<script src="/_platform/sdk.js"></script>` exposes `window.archie`. On localhost it 404s harmlessly.
- Identity: `await archie.me()` → `{ email, name }`.
- Never put secrets in client code. Never store calendar data or other personal content in `archie.kv`; fetch fresh on load.
- No background jobs: fetch on page load or user action.

## Google setup (already configured — don't change without asking)
- GCP project under the Osano org; Calendar API enabled; consent screen audience **Internal**.
- Scopes: `calendar.events.freebusy` (NOT `calendar.freebusy`, which only covers the user's own calendars) plus, since v1.5, `calendar.events` for creating the app's own bookings. Never used to read events. Adding the second scope made everyone re-consent once.
- OAuth client (Web): `521631312959-uasjdvfko1f9r50gk4d3emoilkisb147.apps.googleusercontent.com`. Not a secret. No client secret, no redirect URIs.
- Authorized JS origins: `http://localhost:5173` and the Archie origin.
- Auth: Google Identity Services token client. Access token lives in memory only (~1 hr), never stored.
- Token renewal (Project Plan §6): silent request on page load and ~10 min before expiry (`prompt: ''` + viewer email as `hint`). Any silent failure (popup blocked, signed out, revoked) falls back to the visible Connect button — never an error state. GIS's default `prompt` is `select_account`, which is why the old Connect always showed a chooser.

## Known gotchas
- Never query `"primary"` alongside email IDs — Google collapses duplicate calendars and returns only one key. Query everyone by email, deduped: `[...new Set([ME, ...SE_EMAILS])]`.
- A calendar ID missing from the FreeBusy response is an **error**, not "free."
- A `notFound` error on a calendar means a sharing setting, not a code bug.
- `timeMax` is exclusive. Window = one Mon–Fri week (`weekBounds`), from max(now, Monday) to Saturday 00:00. Business hours 8:30–17:30 in the viewer's local zone (fixed for v1).
- `origin_mismatch` = page origin not registered on the OAuth client. `invalid_client` = wrong/placeholder Client ID or a brand-new client (wait ~5 min).

## Config
- Default SEs: `creinhardt@osano.com`, `john.allman@osano.com` (live roster is admin-editable in the app; see settings.js)
- Admin: `creinhardt@osano.com`
- Local-dev fallback identity: `creinhardt@osano.com`

## Locked product decisions
- Availability is always computed against the **entire SE roster**; no SE-selection step. A window is offerable if the AE + at least 1 SE are free. Zero-SE windows are hidden.
- One SE per call.
- **Prospects may be invited at Book time** via the optional "Prospect emails" intake field (Colin's decision, Sep 28 2026, overriding Project Plan §11 "AE + SE only" — Notion §11 needs the matching update). Emails are used transiently for the attendee list and never stored. No meeting link is attached yet; Zoom is a pending decision (SE Personal Meeting Room links in the roster is the recommended path).

## Phases
1. **v1** — Read from Google Calendar: availability week-grid + admin settings (built, deployed to Archie, restricted pilot)
2. **v1.5** — Write to Google Calendar: intake form + booking + SE assignment ledger (built, verified on Archie)
3. **v2** — HubSpot integration (built, verified on Archie against the production portal; deal link optional until HUBSPOT.required is switched on)
