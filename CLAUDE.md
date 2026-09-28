# SE Availability Finder

Internal web app for Osano AEs to find times when they and at least one Sales Engineer are free, and (later) book SE calls directly. Replaces Slack-based scheduling. Hosted on Osano's Archie platform (archie.osano.dev).

## Current status
- **v1 spike is done and verified** (`spike/index.html`): Google sign-in + FreeBusy works on localhost and Archie, tested by a non-SE.
- **Data layer extracted** to `src/lib/` (plain ES modules, `npm test` runs `node:test` coverage). The spike is kept for reference only; do NOT port its layout or styles.
- **Week-grid UI built** in `src/` (`index.html`, `app.js`, `styles.css`) on top of `src/lib/`. Local-verified; not yet deployed to Archie.
- **Offerable = AE free ∩ (one SE free)**, computed per SE and split into segments labeled with the available SEs (`computeAvailability` → `offerable[{start,end,ses}]`). Never intersect the AE with the *union* of SE free time; two SEs' short gaps must not combine into one window.

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
- Scope: `https://www.googleapis.com/auth/calendar.events.freebusy` (NOT `calendar.freebusy`, which only covers the user's own calendars).
- OAuth client (Web): `521631312959-uasjdvfko1f9r50gk4d3emoilkisb147.apps.googleusercontent.com`. Not a secret. No client secret, no redirect URIs.
- Authorized JS origins: `http://localhost:5173` and the Archie origin.
- Auth: Google Identity Services token client. Access token lives in memory only (~1 hr), never stored.

## Known gotchas
- Never query `"primary"` alongside email IDs — Google collapses duplicate calendars and returns only one key. Query everyone by email, deduped: `[...new Set([ME, ...SE_EMAILS])]`.
- A calendar ID missing from the FreeBusy response is an **error**, not "free."
- A `notFound` error on a calendar means a sharing setting, not a code bug.
- `timeMax` is exclusive. Window = one Mon–Fri week (`weekBounds`), from max(now, Monday) to Saturday 00:00. Business hours 8:30–17:30 in the viewer's local zone (fixed for v1).
- `origin_mismatch` = page origin not registered on the OAuth client. `invalid_client` = wrong/placeholder Client ID or a brand-new client (wait ~5 min).

## Config
- SEs: `creinhardt@osano.com`, `john.allman@osano.com`
- Local-dev fallback identity: `creinhardt@osano.com`

## Locked product decisions
- Availability is always computed against the **entire SE roster**; no SE-selection step. A window is offerable if the AE + at least 1 SE are free. Zero-SE windows are hidden.
- One SE per call.

## Phases
1. **v1** — Read from Google Calendar: availability week-grid (built, local-verified; remaining: Archie pilot deploy, admin-managed roster/business hours)
2. **v1.5** — Write to Google Calendar: intake form + booking + SE assignment ledger
3. **v2** — HubSpot integration
