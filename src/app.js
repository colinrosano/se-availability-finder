// UI for the week grid and booking intake. All DOM code lives here; the data layer is in ./lib/.
import { DURATION_OPTIONS, HUBSPOT } from './lib/config.js';
import { parseDealUrl, isExpectedPortal, getDeal, findOwnerIdByEmail, addCollaborator } from './lib/hubspot.js';
import { loadSettings, saveSettings, defaultSettings, isAdmin } from './lib/settings.js';
import { requestAccessToken, getMe } from './lib/auth.js';
import { loadAvailability, computeAvailability } from './lib/availability.js';
import { weekBounds, defaultWeekOf, addWeeks } from './lib/businessDays.js';
import {
  PRODUCTS,
  CALL_TYPES,
  normalizeProducts,
  buildEventTitle,
  buildEventDescription,
  isIntakeComplete,
  parseEmails,
  startTimes,
  sesFreeFor,
} from './lib/booking.js';
import { pickSE, ledgerStats } from './lib/assignment.js';
import { readLedger, recordAssignment } from './lib/ledger.js';
import { createEvent } from './lib/events.js';
import { formatSlotsText, mergeRuns } from './lib/slotsText.js';

const PX_PER_MIN = 1; // grid scale: 1 minute = 1px → a 9-hour day is 540px tall
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const PREF_KEY = 'seaf.minMinutes';
const RENEW_BEFORE_EXPIRY_MS = 10 * 60_000; // silent renewal ~50 min into a 60-min token
const RENEW_MIN_DELAY_MS = 30_000;

// ---- State (all in memory; the access token is never stored) ----
let accessToken = null;
let me = null; // viewer email from Archie SSO (or the dev fallback); used as the Google account hint
let renewTimer = null;
let weekOf = defaultWeekOf(new Date());
let minMinutes = readPref(); // doubles as the booking duration (Project Plan §11)
let data = null; // last successful loadAvailability() result
let ledger = []; // SE assignment ledger entries, for the fairness pick
let picked = null; // { run, start } while the popover is open
let bookingInFlight = false;
let flash = null; // a notice that survives the next grid reload (e.g. "Booked ✓")
let settings = defaultSettings(); // roster + business hours; replaced by the stored value at boot
let nameByEmail = new Map();
let linkedDeal = null; // { id, name, stageLabel, companyName, url } once a pasted deal link resolves
let dealLookupSeq = 0; // ignore stale lookups when the link changes mid-flight
let dealDebounce = null;

// ---- Elements ----
const $ = (id) => document.getElementById(id);
const els = {
  connect: $('connect'),
  refresh: $('refresh'),
  asOf: $('as-of'),
  prev: $('prev-week'),
  next: $('next-week'),
  thisWeek: $('this-week'),
  weekLabel: $('week-label'),
  jump: $('jump-date'),
  copySlots: $('copy-slots'),
  callType: $('call-type'),
  products: $('products'),
  durations: $('duration-options'),
  company: $('company'),
  prospects: $('prospects'),
  dealUrl: $('deal-url'),
  dealStatus: $('deal-status'),
  titlePreview: $('title-preview'),
  notices: $('notices'),
  grid: $('grid'),
  overlay: $('grid-overlay'),
  popover: $('popover'),
  hoursLabel: $('hours-label'),
  tzLabel: $('tz-label'),
  settingsBtn: $('settings'),
  themeBtn: $('theme'),
  dialog: $('settings-dialog'),
  rosterRows: $('roster-rows'),
  rosterAdd: $('roster-add'),
  hoursStart: $('hours-start'),
  hoursEnd: $('hours-end'),
  settingsErrors: $('settings-errors'),
  settingsCancel: $('settings-cancel'),
  settingsSave: $('settings-save'),
  statsBody: $('stats-table').querySelector('tbody'),
  statsNext: $('stats-next'),
};

const fullName = (email) => nameByEmail.get(email) ?? email;
const firstName = (email) => fullName(email).split(' ')[0];
const hours = () => settings.businessHours;

// ---- Boot ----
initTheme();
applySettings(settings);
els.tzLabel.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone;
renderIntakeForm();
renderWeekHeader();
renderGridSkeleton();
showOverlay('connect');
bootAuth();

els.connect.addEventListener('click', connect);
els.refresh.addEventListener('click', () => load());
els.prev.addEventListener('click', () => changeWeek(addWeeks(weekOf, -1)));
els.next.addEventListener('click', () => changeWeek(addWeeks(weekOf, 1)));
els.thisWeek.addEventListener('click', () => changeWeek(defaultWeekOf(new Date())));
els.jump.addEventListener('change', () => {
  if (!els.jump.value) return;
  const [y, m, d] = els.jump.value.split('-').map(Number);
  changeWeek(new Date(y, m - 1, d)); // parse as local, not UTC
});
els.copySlots.addEventListener('click', copySlots);
els.callType.addEventListener('change', onIntakeChange);
els.company.addEventListener('input', onIntakeChange);
els.dealUrl.addEventListener('input', onDealInput);
els.prospects.addEventListener('input', onIntakeChange);
els.products.addEventListener('change', onProductChange);
els.settingsBtn.addEventListener('click', openSettings);
els.rosterAdd.addEventListener('click', () => addRosterRow());
els.settingsCancel.addEventListener('click', () => els.dialog.close());
els.settingsSave.addEventListener('click', saveSettingsFromDialog);
document.addEventListener('keydown', (e) => e.key === 'Escape' && closePopover());
// Clicks inside the popover never reach the document (a chip click re-renders the popover, which
// would otherwise detach the target and make the "outside" check below close it).
els.popover.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', (e) => {
  if (els.popover.hidden || e.target.closest?.('.window')) return;
  closePopover();
});

// ---- Auth ----

/**
 * Page load: try to get a token without bothering the user. After the one-time consent this
 * completes invisibly (or as a sub-second popup flash). If it fails for any reason — popup
 * blocked, signed-out browser, grant revoked — the Connect button is the fallback, not an error.
 */
async function bootAuth() {
  els.connect.disabled = true;
  try {
    // Settings first: the roster decides whose calendars the first fetch asks for.
    [me, settings] = await Promise.all([getMe(), loadSettings()]);
    applySettings(settings);
    els.settingsBtn.hidden = !isAdmin(me);
    setToken(await requestAccessToken({ silent: true, hint: me }));
    await load();
  } catch (err) {
    console.debug('Silent sign-in unavailable, showing Connect:', err.code ?? err.message);
    showOverlay('connect');
  } finally {
    els.connect.disabled = false;
  }
}

/** The visible fallback. Same request; a user gesture lets the popup open if it was blocked. */
async function connect() {
  els.connect.disabled = true;
  try {
    me ??= await getMe();
    setToken(await requestAccessToken({ hint: me }));
    await load();
  } catch (err) {
    setNotices([{ kind: 'error', text: err.message }]);
  } finally {
    els.connect.disabled = false;
  }
}

function setToken({ accessToken: token, expiresAt }) {
  accessToken = token;
  els.connect.hidden = true;
  els.refresh.hidden = false;
  scheduleRenewal(expiresAt);
}

function clearToken() {
  accessToken = null;
  clearTimeout(renewTimer);
  renewTimer = null;
  els.connect.textContent = 'Reconnect Google Calendar';
  els.connect.hidden = false;
  els.refresh.hidden = true;
}

/** Renew silently ~10 minutes before expiry so a tab left open never goes stale mid-use. */
function scheduleRenewal(expiresAt) {
  clearTimeout(renewTimer);
  const delay = Math.max(expiresAt - Date.now() - RENEW_BEFORE_EXPIRY_MS, RENEW_MIN_DELAY_MS);
  renewTimer = setTimeout(renewSilently, delay);
}

async function renewSilently() {
  try {
    setToken(await requestAccessToken({ silent: true, hint: me }));
  } catch (err) {
    // Keep the current token (still valid for a few minutes) and surface the one-click fix.
    // If it does expire before the user clicks, the 401 path in load() takes over.
    console.debug('Silent renewal failed, showing Reconnect:', err.code ?? err.message);
    els.connect.textContent = 'Reconnect Google Calendar';
    els.connect.hidden = false;
  }
}

// ---- Actions ----

async function load() {
  if (!accessToken) return showOverlay('connect');
  closePopover();
  showOverlay('loading');
  els.refresh.disabled = true;
  try {
    [data, ledger] = await Promise.all([
      loadAvailability(accessToken, {
        weekOf,
        minMs: minMinutes * 60_000,
        roster: settings.roster,
        hours: settings.businessHours,
      }),
      readLedger(),
    ]);
    els.asOf.textContent = `As of ${fmtTime(data.fetchedAt)}`;
    renderWeekHeader();
    renderWindows();
    renderPeopleNotices();
  } catch (err) {
    if (err.status === 401) {
      // Token expired and silent renewal didn't get there first. Ask for a fresh one.
      clearToken();
      data = null;
      showOverlay('connect');
      setNotices([{ kind: 'warn', text: 'Your Google session expired. Reconnect to refresh availability.' }]);
    } else {
      showOverlay('error', err.message);
    }
  } finally {
    els.refresh.disabled = false;
  }
}

function changeWeek(date) {
  weekOf = date;
  data = null;
  flash = null;
  els.copySlots.disabled = true;
  closePopover();
  renderWeekHeader();
  renderGridSkeleton();
  if (accessToken) load();
  else showOverlay('connect');
}

function changeDuration(minutes) {
  minMinutes = minutes;
  writePref(minutes);
  renderDurationOptions();
  onIntakeChange();
  if (!data) return;
  // Pure recompute from the calendars already in memory; no refetch.
  const { people, offerable, seFree } = computeAvailability(data.ids, data.calendars, data.windows, {
    minMs: minutes * 60_000,
  });
  data = { ...data, people, offerable, seFree };
  renderWindows();
}

// ---- Theme ----
// The inline script in index.html already applied html[data-theme] before first paint
// (stored preference, else OS preference). This wires the toggle and follows OS changes
// until the user picks one explicitly.
const THEME_KEY = 'seaf.theme';

function initTheme() {
  renderThemeButton();
  els.themeBtn.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* preference just won't persist */
    }
    renderThemeButton();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    let stored = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch {
      /* ignore */
    }
    if (stored === 'light' || stored === 'dark') return; // explicit choice wins
    document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    renderThemeButton();
  });
}

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function renderThemeButton() {
  const dark = currentTheme() === 'dark';
  els.themeBtn.textContent = dark ? '☀' : '☾';
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  els.themeBtn.setAttribute('aria-label', label);
  els.themeBtn.title = label;
}

// ---- Copy available times ----

/** Paste-ready text of the windows on screen (this week, at the current duration filter). */
async function copySlots() {
  const text = formatSlotsText(data?.offerable ?? []);
  if (!text) return;
  const btn = els.copySlots;
  try {
    await navigator.clipboard.writeText(text);
    const label = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => (btn.textContent = label), 2000);
    const n = mergeRuns(data.offerable).length;
    toast(`Copied ${n} window${n === 1 ? '' : 's'} when you and an SE are both free.`);
  } catch {
    // Clipboard blocked (permissions, insecure context): show the text so it can be selected by hand.
    const box = el('div', { className: 'notice notice-warn' });
    box.append(
      el('div', { textContent: "Couldn't copy automatically — select and copy the text below." }),
      el('textarea', { className: 'slots-text', readOnly: true, value: text, rows: Math.min(8, text.split('\n').length + 1) }),
    );
    els.notices.prepend(box);
    box.querySelector('textarea').select();
  }
}

// ---- Settings (admin) ----

/** Make the loaded settings the live ones: names for labels, hours for the grid and footer. */
function applySettings(s) {
  settings = s;
  nameByEmail = new Map(s.roster.map((se) => [se.email, se.name]));
  els.hoursLabel.textContent = `${fmtClock(...s.businessHours.start)} – ${fmtClock(...s.businessHours.end)}`;
}

async function openSettings() {
  els.rosterRows.replaceChildren();
  for (const se of settings.roster) addRosterRow(se);
  els.hoursStart.value = toTimeInputValue(settings.businessHours.start);
  els.hoursEnd.value = toTimeInputValue(settings.businessHours.end);
  els.settingsErrors.replaceChildren();
  renderStats([]); // placeholder while the ledger loads
  els.dialog.showModal();
  ledger = await readLedger(); // fresh each time the panel opens
  renderStats(ledger);
}

/** Booking statistics from the ledger: per-SE counts, last assigned, and the rule's next pick. */
function renderStats(entries) {
  const { rows, total, nextPick } = ledgerStats(entries, settings.roster);
  els.statsBody.replaceChildren(
    ...rows.map((r) => {
      const tr = el('tr');
      const who = el('td', { textContent: r.name });
      if (!r.onRoster) who.append(' ', el('span', { className: 'muted', textContent: '(removed from roster)' }));
      tr.append(
        who,
        el('td', { textContent: String(r.recentCount) }),
        el('td', { textContent: String(r.totalCount) }),
        el('td', { textContent: r.lastAt ? new Date(r.lastAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'never' }),
      );
      return tr;
    }),
  );
  const totalLine = `${total} booking${total === 1 ? '' : 's'} in the last 60 days.`;
  const nextLine = !nextPick
    ? ''
    : nextPick.tie
      ? ' Next pick if everyone is free: tie (random).'
      : ` Next pick if everyone is free: ${fullName(nextPick.se)}.`;
  els.statsNext.textContent = totalLine + nextLine;
}

function addRosterRow({ name = '', email = '' } = {}) {
  const row = el('div', { className: 'roster-row' });
  const nameIn = el('input', { type: 'text', value: name, placeholder: 'Name', ariaLabel: 'SE name', autocomplete: 'off' });
  const emailIn = el('input', { type: 'email', value: email, placeholder: 'email@osano.com', ariaLabel: 'SE email', autocomplete: 'off' });
  const remove = el('button', { className: 'roster-remove', type: 'button', textContent: '×', ariaLabel: `Remove ${name || 'SE'}` });
  remove.addEventListener('click', () => row.remove());
  row.append(nameIn, emailIn, remove);
  els.rosterRows.append(row);
  if (!name && !email) nameIn.focus();
}

function readSettingsDialog() {
  const roster = [...els.rosterRows.querySelectorAll('.roster-row')].map((row) => {
    const [nameIn, emailIn] = row.querySelectorAll('input');
    return { name: nameIn.value, email: emailIn.value };
  });
  return {
    roster,
    businessHours: { start: fromTimeInputValue(els.hoursStart.value), end: fromTimeInputValue(els.hoursEnd.value) },
  };
}

async function saveSettingsFromDialog() {
  els.settingsSave.disabled = true;
  try {
    const saved = await saveSettings(readSettingsDialog());
    applySettings(saved);
    els.dialog.close();
    flash = { kind: 'success', text: 'Settings saved. Availability now uses the updated roster and hours.' };
    if (data) await load();
    else renderGridSkeleton();
  } catch (err) {
    els.settingsErrors.replaceChildren(...(err.problems ?? [err.message]).map((p) => el('div', { textContent: p })));
  } finally {
    els.settingsSave.disabled = false;
  }
}

function toTimeInputValue([h, m]) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function fromTimeInputValue(v) {
  const [h, m] = String(v ?? '').split(':').map(Number);
  return [h, m];
}

// ---- Intake form ----

function renderIntakeForm() {
  els.callType.replaceChildren(
    el('option', { value: '', textContent: 'Select…' }),
    ...Object.entries(CALL_TYPES).map(([k, label]) => el('option', { value: k, textContent: label })),
  );
  els.products.replaceChildren(
    ...Object.entries(PRODUCTS).map(([k, label]) => {
      const pill = el('label', { className: `pill${k === 'full_platform' ? ' pill-full' : ''}` });
      pill.append(el('input', { type: 'checkbox', value: k }), el('span', { textContent: label }));
      return pill;
    }),
  );
  renderDurationOptions();
  updateTitlePreview();
}

function renderDurationOptions() {
  els.durations.replaceChildren(
    ...DURATION_OPTIONS.map((m) => {
      const b = el('button', { className: 'seg', type: 'button', textContent: `${m} min` });
      b.setAttribute('aria-pressed', String(m === minMinutes));
      b.addEventListener('click', () => changeDuration(m));
      return b;
    }),
  );
}

/** Full Platform is exclusive: it clears + disables the modules; all six modules collapse to it. */
function onProductChange(e) {
  const boxes = [...els.products.querySelectorAll('input')];
  const full = boxes.find((b) => b.value === 'full_platform');
  const modules = boxes.filter((b) => b.value !== 'full_platform');
  if (e?.target !== full && modules.every((b) => b.checked)) full.checked = true;
  for (const b of modules) {
    if (full.checked) b.checked = false;
    b.disabled = full.checked;
  }
  onIntakeChange();
}

function readIntake() {
  return {
    callTypeKey: els.callType.value,
    productKeys: normalizeProducts([...els.products.querySelectorAll('input:checked')].map((b) => b.value)),
    durationMin: minMinutes,
    companyName: els.company.value,
    // v2 (§12): a resolved deal fills the company name and gets the SE as Deal Collaborator on Book.
    // Optional while HUBSPOT.required is false (test phase); required at go-live.
    dealUrl: els.dealUrl.value.trim(),
    deal: linkedDeal,
    // Optional (Colin, Sep 2026, overriding §11 "AE + SE only"): prospects invited at Book time.
    // Used transiently for the attendee list; never stored.
    ...(() => {
      const { emails, invalid } = parseEmails(els.prospects.value);
      return { prospectEmails: emails, invalidProspects: invalid };
    })(),
  };
}

// ---- HubSpot deal link ----

/** Debounced: parse the link, verify the portal, look the deal up, fill the company name. */
function onDealInput() {
  clearTimeout(dealDebounce);
  const url = els.dealUrl.value.trim();
  const seq = ++dealLookupSeq;
  setLinkedDeal(null);
  if (!url) {
    setDealStatus('');
    onIntakeChange();
    return;
  }
  const ref = parseDealUrl(url);
  if (!ref) {
    setDealStatus('Not a HubSpot deal link.', 'error');
    onIntakeChange();
    return;
  }
  if (!isExpectedPortal(ref.portalId)) {
    setDealStatus('That link is for a different HubSpot portal.', 'error');
    onIntakeChange();
    return;
  }
  setDealStatus('Looking up the deal…');
  onIntakeChange();
  dealDebounce = setTimeout(async () => {
    try {
      const deal = await getDeal(ref.dealId);
      if (seq !== dealLookupSeq) return; // link changed while we were fetching
      setLinkedDeal({ ...deal, url });
      const parts = [deal.name || `Deal ${deal.id}`, deal.stageLabel, deal.companyName].filter(Boolean);
      setDealStatus(`✓ ${parts.join(' · ')} — correct deal?`, 'ok');
    } catch (err) {
      if (seq !== dealLookupSeq) return;
      setDealStatus(err.status === 404 ? 'Deal not found in HubSpot.' : `Couldn't look up the deal (${err.message}).`, 'error');
    }
    onIntakeChange();
  }, 400);
}

/** A resolved deal supplies the company name (read-only while linked); clearing it hands the field back. */
function setLinkedDeal(deal) {
  linkedDeal = deal;
  if (deal?.companyName) {
    els.company.value = deal.companyName;
    els.company.readOnly = true;
    els.company.title = 'From the linked HubSpot deal';
  } else {
    els.company.readOnly = false;
    els.company.title = '';
  }
}

function setDealStatus(text, kind = '') {
  els.dealStatus.textContent = text;
  els.dealStatus.className = `field-status${kind ? ` is-${kind}` : ''}`;
  els.dealUrl.setAttribute('aria-invalid', String(kind === 'error'));
}

/**
 * After the event exists: append the assigned SE to the deal's collaborators. Returns a flash
 * notice describing the outcome; a failure gets a Retry action rather than being hidden (§12).
 */
async function attachCollaborator(deal, se, base) {
  try {
    const ownerId = await findOwnerIdByEmail(se);
    if (!ownerId) throw new Error(`${fullName(se)} is not a user in this HubSpot portal`);
    await addCollaborator(deal.id, ownerId);
    return { ...base, text: `${base.text} ${fullName(se)} set as Deal Collaborator on ${deal.name}.` };
  } catch (err) {
    return {
      ...base,
      kind: 'warn',
      text: `${base.text} But ${fullName(se)} could not be set as Deal Collaborator on ${deal.name} (${err.message}). Retry, or set it manually in HubSpot.`,
      action: {
        label: 'Retry',
        run: async () => {
          flash = await attachCollaborator(deal, se, base);
          if (data) renderPeopleNotices();
        },
      },
    };
  }
}

function onIntakeChange() {
  const { invalid } = parseEmails(els.prospects.value);
  els.prospects.setAttribute('aria-invalid', String(invalid.length > 0));
  els.prospects.title = invalid.length ? `Not an email: ${invalid.join(', ')}` : '';
  updateTitlePreview();
  if (picked) renderPopover(); // keep the summary in sync
}

function updateTitlePreview() {
  const intake = readIntake();
  if (isIntakeComplete(intake)) {
    els.titlePreview.textContent = buildEventTitle(intake);
    els.titlePreview.classList.remove('muted');
  } else {
    els.titlePreview.textContent = 'complete the form above';
    els.titlePreview.classList.add('muted');
  }
}

// ---- Popover: start-time chips + assignment preview ----

/** The maximal contiguous run of offerable time containing this segment (segments only split on label changes). */
function runContaining(segment) {
  const segs = data.offerable;
  let i = segs.indexOf(segment);
  let j = i;
  while (i > 0 && segs[i - 1].end === segs[i].start) i--;
  while (j < segs.length - 1 && segs[j].end === segs[j + 1].start) j++;
  const run = segs.slice(i, j + 1);
  return { start: run[0].start, end: run[run.length - 1].end, ses: [...new Set(run.flatMap((s) => s.ses))] };
}

function openPopover(segment, blockEl) {
  const run = runContaining(segment);
  picked = { run, start: null };
  renderPopover();
  positionPopover(blockEl);
}

function closePopover() {
  picked = null;
  els.popover.hidden = true;
  els.popover.replaceChildren();
}

function renderPopover() {
  const { run, start } = picked;
  const durMs = minMinutes * 60_000;
  const chips = startTimes(run, minMinutes).filter((t) => sesFreeFor(data.seFree, t, t + durMs).length);
  const day = new Date(run.start).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  const head = el('div', { className: 'popover-head' });
  head.append(
    el('div', { className: 'popover-title', textContent: `${day} · ${fmtTime(run.start)} – ${fmtTime(run.end)}` }),
    el('button', { className: 'popover-close', type: 'button', textContent: '×', ariaLabel: 'Close' }),
  );
  head.querySelector('.popover-close').addEventListener('click', closePopover);

  const chipsEl = el('div', { className: 'chips' });
  if (!chips.length) {
    chipsEl.append(el('p', { className: 'muted', textContent: `No ${minMinutes}-minute slot fits here.` }));
  }
  for (const t of chips) {
    const c = el('button', { className: 'chip', type: 'button', textContent: fmtTime(t) });
    c.setAttribute('aria-pressed', String(t === start));
    c.addEventListener('click', () => {
      picked.start = t;
      renderPopover();
    });
    chipsEl.append(c);
  }

  els.popover.replaceChildren(head, el('p', { className: 'popover-hint', textContent: `Start time (${minMinutes} min)` }), chipsEl);
  if (start != null) els.popover.append(renderSummary(start, start + durMs));
  els.popover.hidden = false;
}

function renderSummary(start, end) {
  const intake = readIntake();
  const candidates = sesFreeFor(data.seFree, start, end);
  const pick = pickSE(candidates, ledger);

  const box = el('div', { className: 'summary' });
  box.append(row('When', `${fmtTime(start)} – ${fmtTime(end)}`));
  box.append(row('SE', pick ? fullName(pick.se) : 'No SE is free for this slot'));
  const complete = isIntakeComplete(intake);
  box.append(row('Title', complete ? buildEventTitle(intake) : 'Complete the form above to set the title', !complete));
  // The title may say "Multi-Product"; the description (shown to the SE) always lists the modules.
  if (complete) box.append(row('Products', buildEventDescription(intake).replace(/^Products: /, '')));
  if (intake.deal) box.append(row('Deal', [intake.deal.name, intake.deal.stageLabel].filter(Boolean).join(' · ')));
  else if (intake.dealUrl) box.append(row('Deal', 'Link not resolved — no collaborator will be set', true));
  const needsDeal = HUBSPOT.required && !intake.deal;
  const badProspects = intake.invalidProspects.length > 0;
  if (badProspects) box.append(row('Prospects', `Not an email: ${intake.invalidProspects.join(', ')}`, true));
  else if (intake.prospectEmails.length) {
    box.append(row('Prospects', intake.prospectEmails.join(', ')));
    box.append(el('p', { className: 'muted summary-note', textContent: 'They get the invite when you click Book. No meeting link is attached yet — add Zoom in Google Calendar afterwards.' }));
  }

  const canBook = complete && pick && !badProspects && !needsDeal && !bookingInFlight;
  const book = el('button', { className: 'btn btn-primary', type: 'button', disabled: !canBook });
  book.textContent = bookingInFlight ? 'Booking…' : 'Book';
  if (!complete) book.title = 'Complete the form above to book';
  else if (!pick) book.title = 'No SE is free for this slot';
  else if (badProspects) book.title = 'Fix the prospect emails to book';
  else if (needsDeal) book.title = 'Link a HubSpot deal to book';
  book.addEventListener('click', () => book_(start, end, pick.se, intake));
  box.append(book);
  return box;

  function row(label, value, muted = false) {
    const r = el('div', { className: 'summary-row' });
    r.append(el('span', { className: 'summary-label', textContent: label }), el('span', { className: muted ? 'muted' : '', textContent: value }));
    return r;
  }
}

/**
 * Booking and ledger recording are one action (§11). Order: calendar event first, then the ledger.
 * If the ledger write fails after the event exists, say exactly that rather than pretending.
 */
async function book_(start, end, se, intake) {
  if (bookingInFlight) return;
  bookingInFlight = true;
  flash = null;
  renderPopover();

  const summary = buildEventTitle(intake);
  const description = buildEventDescription(intake) + (intake.dealUrl ? `\nHubSpot deal: ${intake.dealUrl}` : '');
  let event;
  try {
    event = await createEvent(accessToken, {
      summary,
      description,
      start,
      end,
      attendees: [me, se, ...intake.prospectEmails],
      organizer: me, // the AE's own entry is pre-accepted; everyone else gets a normal invite
    });
  } catch (err) {
    bookingInFlight = false;
    if (err.status === 401) {
      clearToken();
      setNotices([{ kind: 'warn', text: 'Your Google session expired before the event was created. Reconnect and book again.' }]);
      closePopover();
    } else {
      renderPopover();
      setNotices([{ kind: 'error', text: `${err.message} Nothing was booked.` }]);
    }
    return;
  }

  const when = `${new Date(start).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}, ${fmtTime(start)} – ${fmtTime(end)}`;
  const n = intake.prospectEmails.length;
  const sentTo = n ? `Invites sent to ${fullName(se)} and ${n} prospect${n === 1 ? '' : 's'}.` : 'Invite sent.';
  try {
    ledger = await recordAssignment(se);
    flash = {
      kind: 'success',
      text: `Booked: ${summary} · ${when} with ${fullName(se)}. ${sentTo}`,
      link: { href: event.htmlLink, label: 'Open in Google Calendar' },
    };
  } catch (err) {
    flash = {
      kind: 'warn',
      text: `Booked: ${summary} · ${when} with ${fullName(se)} — but the assignment could not be recorded in the fairness ledger (${err.message}).`,
      link: { href: event.htmlLink, label: 'Open in Google Calendar' },
    };
  }
  // v2: event first, collaborator second; a failure here is reported with a Retry, never hidden.
  if (intake.deal) flash = await attachCollaborator(intake.deal, se, flash);
  bookingInFlight = false;
  closePopover();
  await load(); // the new event now shows as busy time
}

/** Place the popover beside the clicked block, flipping left when it would overflow the grid. */
function positionPopover(blockEl) {
  const wrap = els.grid.parentElement.getBoundingClientRect();
  const b = blockEl.getBoundingClientRect();
  const p = els.popover;
  const width = p.offsetWidth || 280;
  let left = b.right - wrap.left + 8;
  if (left + width > wrap.width) left = Math.max(8, b.left - wrap.left - width - 8);
  const top = Math.min(b.top - wrap.top, Math.max(0, wrap.height - (p.offsetHeight || 200) - 8));
  p.style.left = `${left}px`;
  p.style.top = `${top}px`;
}

// ---- Rendering ----

function renderWeekHeader() {
  const { start, end } = weekBounds(weekOf);
  const fri = new Date(+end - 1);
  const sameMonth = start.getMonth() === fri.getMonth();
  const a = start.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const b = fri.toLocaleDateString([], sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
  els.weekLabel.textContent = `${a} – ${b}, ${fri.getFullYear()}`;
  els.jump.value = toDateInputValue(start);
}

/** Time axis, five hatched ("unavailable") day columns with hour lines and today highlight. Windows come later. */
function renderGridSkeleton() {
  const { start } = weekBounds(weekOf);
  const dayStartMin = hours().start[0] * 60 + hours().start[1];
  const dayEndMin = hours().end[0] * 60 + hours().end[1];
  const height = (dayEndMin - dayStartMin) * PX_PER_MIN;
  const now = new Date();
  const todayKey = now.toDateString();

  // Header row
  const header = el('div', { className: 'grid-header' });
  header.append(el('div', { className: 'axis-spacer' }));
  const days = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push(d);
    const isToday = d.toDateString() === todayKey;
    const h = el('div', { className: `day-head${isToday ? ' is-today' : ''}` });
    h.append(
      el('span', { className: 'day-name', textContent: DAY_NAMES[i] }),
      el('span', { className: 'day-num', textContent: String(d.getDate()) }),
    );
    header.append(h);
  }

  // Body: axis + columns
  const body = el('div', { className: 'grid-body' });
  body.style.height = `${height}px`;
  const axis = el('div', { className: 'axis' });
  for (let m = Math.ceil(dayStartMin / 60) * 60; m <= dayEndMin; m += 60) {
    const label = el('span', { className: 'axis-label', textContent: fmtClock(m / 60, 0) });
    label.style.top = `${(m - dayStartMin) * PX_PER_MIN}px`;
    axis.append(label);
  }
  body.append(axis);

  for (const d of days) {
    const isToday = d.toDateString() === todayKey;
    const col = el('div', { className: `day-col${isToday ? ' is-today' : ''}` });
    col.dataset.day = d.toDateString();
    for (let m = Math.ceil(dayStartMin / 60) * 60; m <= dayEndMin; m += 60) {
      const line = el('div', { className: 'hour-line' });
      line.style.top = `${(m - dayStartMin) * PX_PER_MIN}px`;
      col.append(line);
    }
    // No separate past shading: the whole column is hatched "unavailable"; open windows sit on top.
    body.append(col);
  }

  els.grid.replaceChildren(header, body);
}

/** Place offerable windows into the day columns. Rebuilds the skeleton so stale blocks go away. */
function renderWindows() {
  closePopover();
  renderGridSkeleton();
  const cols = new Map([...els.grid.querySelectorAll('.day-col')].map((c) => [c.dataset.day, c]));
  const dayStartMin = hours().start[0] * 60 + hours().start[1];

  for (const w of data.offerable) {
    const s = new Date(w.start);
    const col = cols.get(s.toDateString());
    if (!col) continue;
    const top = (s.getHours() * 60 + s.getMinutes() - dayStartMin) * PX_PER_MIN;
    const height = ((w.end - w.start) / 60_000) * PX_PER_MIN;
    const block = el('button', { className: 'window', type: 'button' });
    block.style.top = `${top}px`;
    block.style.height = `${height}px`;
    // "You" first: every window is the viewer's free time intersected with the named SEs'.
    block.title = `${fmtTime(w.start)} – ${fmtTime(w.end)} · you and ${w.ses.map(fullName).join(', ')} are free — click to pick a start time`;
    block.append(
      el('span', { className: 'window-time', textContent: `${fmtTime(w.start)} – ${fmtTime(w.end)}` }),
      el('span', { className: 'window-ses', textContent: ['You', ...w.ses.map(firstName)].join(' · ') }),
    );
    if (height < 40) block.classList.add('is-short');
    block.addEventListener('click', () => openPopover(w, block));
    col.append(block);
  }

  els.copySlots.disabled = data.offerable.length === 0;
  if (data.offerable.length) hideOverlay();
  else showOverlay('empty');
}

function renderPeopleNotices() {
  const notices = flash ? [flash] : [];
  for (const p of data.people) {
    if (!p.error) continue;
    const isMe = p.id === data.me;
    const who = isMe ? 'your calendar' : `${fullName(p.id)}'s calendar`;
    notices.push({
      kind: isMe ? 'error' : 'warn',
      text: isMe
        ? `Couldn't read ${who}, so no windows can be shown. (${p.error})`
        : `Couldn't read ${who} — it may not share free/busy. Showing availability without them. (${p.error})`,
    });
  }
  setNotices(notices);
}

function setNotices(items) {
  els.notices.replaceChildren(
    ...items.map((n) => {
      const d = el('div', { className: `notice notice-${n.kind}`, textContent: n.text });
      if (n.link) d.append(' ', el('a', { href: n.link.href, target: '_blank', rel: 'noopener', textContent: n.link.label }));
      if (n.action) {
        const b = el('button', { className: 'btn btn-ghost btn-small notice-action', type: 'button', textContent: n.action.label });
        b.addEventListener('click', async () => {
          b.disabled = true;
          await n.action.run();
        });
        d.append(' ', b);
      }
      return d;
    }),
  );
}

function showOverlay(kind, detail = '') {
  const o = els.overlay;
  o.hidden = false;
  o.replaceChildren();
  if (kind === 'connect') {
    o.append(
      el('p', { textContent: 'Connect your Google Calendar to see when you and an SE are both free.' }),
      el('p', { className: 'muted', textContent: 'Google will ask for free/busy access only.' }),
    );
  } else if (kind === 'loading') {
    o.append(el('p', { textContent: 'Loading availability…' }));
  } else if (kind === 'empty') {
    o.append(
      el('p', { textContent: `No windows of ${minMinutes}+ minutes this week.` }),
      el('p', { className: 'muted', textContent: 'Try a shorter meeting length or the next week.' }),
    );
  } else if (kind === 'error') {
    o.append(el('p', { className: 'error', textContent: `Couldn't load availability: ${detail}` }));
  }
}

function hideOverlay() {
  els.overlay.hidden = true;
}

/** A brief, self-dismissing confirmation that doesn't disturb the notices area. */
function toast(text, ms = 3500) {
  document.querySelector('.toast')?.remove();
  const t = el('div', { className: 'toast', textContent: text, role: 'status' });
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

// ---- Helpers ----
function el(tag, props = {}) {
  return Object.assign(document.createElement(tag), props);
}

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtClock(h, m) {
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: m ? '2-digit' : undefined });
}

function toDateInputValue(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function readPref() {
  try {
    const v = Number(localStorage.getItem(PREF_KEY));
    return DURATION_OPTIONS.includes(v) ? v : DURATION_OPTIONS[0];
  } catch {
    return DURATION_OPTIONS[0];
  }
}

function writePref(v) {
  try {
    localStorage.setItem(PREF_KEY, String(v));
  } catch {
    /* private mode etc. — preference just won't persist */
  }
}
