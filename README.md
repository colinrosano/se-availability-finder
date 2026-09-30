# SE Availability Finder

Internal web app for Osano Account Executives. It shows a week grid of every time the AE and at
least one Sales Engineer are free, and books the SE call in one click: consistently titled,
fairly assigned, invite sent. It replaces the Slack back-and-forth of "who's free Thursday?".

Hosted on Osano's Archie platform. Pilot URL: https://creinhardt.archie.osano.dev/se-availability-finder/

- **Project Plan** (source of truth for design decisions): https://app.notion.com/p/3b5af0df2a53818c924ee69027bd24b1
- **Future Features backlog**: https://app.notion.com/p/3bbaf0df2a53814b8b92fb22138cd62e

## What it does

- **Availability grid.** Mon–Fri, business hours, in the viewer's local time zone. Open windows
  are drawn to the minute as one block per contiguous span where you and at least one SE are
  free; blocks carry no SE names. Everything else is hatched. Navigate by week, filter by
  minimum length (30/45/60 min).
- **Any SE, one SE per call.** A window is open when the AE is free *and* at least one SE is
  free for the chosen duration. The AE never picks an SE.
- **Booking.** Fill in the intake (call type, product, duration, company, optional prospect
  emails and HubSpot deal link), click a window, pick a start time, click Book. The app creates
  the event on the AE's calendar with the assigned SE (and any prospects) invited.
- **Fair assignment.** When several SEs are free, the one with the fewest bookings in the last
  14 days is assigned; ties go to the least recently assigned, then random. No override.
- **Admin panel** (allow-listed emails only): edit the SE roster and business hours, and see
  per-SE booking statistics from the assignment ledger.
- **Copy available times** as paste-ready text for a prospect email, at three scopes: the whole
  visible week (button by the week nav), one day (icon on the day header), or the start times of
  one block (button in the popover, already filtered to the chosen duration). Always in the AE's
  zone with a label, never naming SEs.
- Light and dark mode.

## How it works

Everything runs in the browser. There is no server of our own.

```
Archie SSO ──► archie.me() ──► viewer's email
                                   │
Google sign-in (GIS token flow) ──► short-lived access token (memory only)
                                   │
FreeBusy query: AE + every SE ──► busy blocks per calendar (no event details)
                                   │
Client-side math: free = business hours − busy; open = AE free ∩ each SE free
                                   │
Grid ──► click ──► start-time chips ──► fairness pick ──► create event ──► record in ledger
```

Key properties, all from the Project Plan:

- **Free/busy only.** The app never reads event titles, attendees, or descriptions. The only
  write is creating its own bookings.
- **Per-user consent.** Each AE authorises the app once with their own Google account. No
  shared credential exists anywhere. Tokens live in memory, renew silently, and are never stored.
- **Nothing calendar-related is persisted.** The Archie config store holds only the SE roster,
  business hours, and the assignment ledger (who was assigned, when).

## Repository layout

```
src/
  index.html          page shell, intake form, settings dialog
  app.js              all DOM code: rendering, popover, booking flow, settings, theme
  styles.css          Osano-branded styles; light/dark via tokens on html[data-theme]
  lib/                plain ES modules, no DOM, unit-tested with node:test
    config.js         Client ID, scopes, default roster/hours, admin allow-list
    auth.js           Google token client (silent renewal) + Archie identity
    freebusy.js       FreeBusy API call
    events.js         Calendar event creation
    intervals.js      merge / subtract / intersect interval math
    businessDays.js   week bounds, business-hour windows
    availability.js   busy → free → merged offerable blocks, per-SE free intervals
    booking.js        intake vocabulary, event title/description, start-time chips
    assignment.js     fairness pick + ledger statistics
    ledger.js         assignment ledger (Archie KV / localStorage fallback)
    settings.js       admin-managed roster + hours (Archie KV / localStorage fallback)
    store.js          the KV wrapper both of the above use
    slotsText.js      "available times" text for prospect emails
spike/index.html      the original proof of concept; reference only
```

## Local development

Requirements: Node 20+ and a browser. No dependencies to install, no build step.

```bash
npm run dev          # serves src/ at http://localhost:5173
npm test             # node --test over src/lib
```

Open **http://localhost:5173** exactly (not 127.0.0.1). The OAuth client only allows that
origin, and Google rejects anything else with `origin_mismatch`.

On localhost:

- Identity falls back to `DEV_EMAIL` in `config.js` because the Archie SDK isn't present.
- The roster, hours, and ledger use your browser's local storage instead of the shared Archie
  store, so nothing you save locally affects the deployed app.
- Booking creates a **real** event and sends **real** invites. Book something you'll delete.

### Fixture mode: synthetic calendars for specific scenarios

Real calendars rarely produce the edge cases the grid has to handle (an SE handoff inside one
block, short unaligned blocks, back-to-back SEs where no single SE spans the join). Fixture mode
feeds synthetic busy data through the real pipeline instead:

```
http://localhost:5173/?fixture=blocks
```

It works **only on localhost and only with that query parameter**. It skips Google sign-in, makes
you a fake non-SE AE so both SEs appear, swaps the FreeBusy fetch for the fixture's data, turns
Book into a no-op that creates nothing, and keeps its bookings in a separate ledger. A banner says
so. Remove the parameter for live data. Scenarios are defined in `src/dev/fixtures.js`, which is
excluded from the Archie zip; navigate to a week that isn't mostly in the past to see all of them.

## Configuration

All in `src/lib/config.js`:

| Constant | Purpose |
|---|---|
| `CLIENT_ID` | Google OAuth Web client. Public by design; no secret exists. |
| `SCOPE` | `calendar.events.freebusy` (read free/busy) + `calendar.events` (create bookings). |
| `SE_ROSTER`, `BUSINESS_HOURS` | Seed values; the live ones are edited in the app's Settings panel. |
| `ADMIN_EMAILS` | Who sees the Settings panel. A UI gate, not a security boundary. |
| `DEV_EMAIL` | Identity used on localhost. |
| `DURATION_OPTIONS` | 30 / 45 / 60 minutes. |

Google Cloud side (already provisioned): Calendar API enabled, consent screen **Internal**,
authorised JavaScript origins `http://localhost:5173` and `https://creinhardt.archie.osano.dev`.

## HubSpot (v2)

Pasting a HubSpot deal link into the intake looks the deal up, shows "name · stage · company"
so the AE can confirm the record, fills the company name from the deal, and after booking
appends the assigned SE to the deal's **Deal Collaborator** field (never removing anyone). If
that last step fails, the booking notice says so and offers Retry.

**The token is never in code.**

- On Archie, every HubSpot call goes through `archie.secrets.proxy('hubspot', …)`, which
  injects the private-app token server-side. Store or rotate it from **Settings → HubSpot**
  in the app (admins only): paste the new token, Save, then "Test connection". The panel can
  only tell whether a token is stored, never read it. (The console equivalent is
  `await archie.secrets.set('hubspot', '<token>')`.)
- On localhost, run the dev proxy in a second terminal and it injects the token from an env var:

  ```bash
  HUBSPOT_TOKEN=pat-… npm run dev:hubspot     # http://localhost:8787 → api.hubapi.com
  ```

`HUBSPOT.portalId` in `src/lib/config.js` is Osano's production portal. Links from any other
portal are rejected before any lookup. `HUBSPOT.required` decides whether a booking must link a
deal (the Project Plan's v2 rule); it starts off during the pilot.

Private-app scopes needed: deals read/write, companies read, owners read. Both SEs resolve as
owners in the portal, so the collaborator step succeeds for either assignment.

## Deploying to Archie

Archie serves a zip whose root is `index.html`. Deploy only when asked to.

```bash
cd src && zip -r ../app.zip . -x '*.test.js' -x 'dev/*' -x '.DS_Store'
```

Then publish with the `archie-deploy` skill's `scripts/publish.sh` and a deploy token from the
Archie dashboard ("Deploy with an AI agent" → Create deploy token; tokens last 24 h):

```bash
ARCHIE_DEPLOY_TOKEN=archd_… scripts/publish.sh --file app.zip \
  --subdomain creinhardt --path se-availability-finder --title "SE Availability Finder"
```

Visibility is managed separately (Archie dashboard or the Archie MCP connector's `update_site`).
The pilot is `restricted` with an allow-list. Republishing preserves visibility and the allow-list.

Deploying to a different namespace requires adding that origin to the OAuth client first.

## Gotchas worth knowing

- Never query `"primary"` alongside email IDs in a FreeBusy request. Google collapses duplicate
  calendars and silently drops one. Query everyone by email, deduped.
- A calendar missing from the FreeBusy response is an **error**, not "free". A `notFound` on
  a colleague means their calendar doesn't share free/busy; the UI says so per person.
- Never let two SEs' short gaps combine into a slot nobody can take. `computeAvailability`
  intersects per SE (`seFree`) and merges those into blocks only for drawing; every start time
  in the popover is checked against one SE at a time, and a start no single SE covers is omitted.
- The first page load after adding a scope re-prompts everyone for consent once. That's expected.
- Business hours are in each viewer's local zone (the plan's deliberate v1 simplification).
- The assignment ledger counts bookings made through this app only, never calls booked
  directly in Google Calendar. The Settings panel labels it as such.

## Status

v1 (availability) and v1.5 (booking + fair assignment + admin settings) are built and deployed
for a restricted pilot. v2 (HubSpot deal linking and Deal Collaborator attribution) waits on
IT approval for a HubSpot private-app token. Meeting links (Zoom) are an open decision.
