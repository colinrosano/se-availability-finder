// UI for the week grid and booking intake. All DOM code lives here; the data layer is in ./lib/.
import { SE_ROSTER, BUSINESS_HOURS, DURATION_OPTIONS } from './lib/config.js';
import { requestAccessToken, getMe } from './lib/auth.js';
import { loadAvailability, computeAvailability } from './lib/availability.js';
import { weekBounds, defaultWeekOf, addWeeks } from './lib/businessDays.js';
import {
  PRODUCTS,
  CALL_TYPES,
  MODULES,
  normalizeProducts,
  buildEventTitle,
  buildEventDescription,
  isIntakeComplete,
  startTimes,
  sesFreeFor,
} from './lib/booking.js';
import { pickSE } from './lib/assignment.js';
import { readLedger } from './lib/ledger.js';

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
  callType: $('call-type'),
  products: $('products'),
  durations: $('duration-options'),
  company: $('company'),
  dealUrl: $('deal-url'),
  titlePreview: $('title-preview'),
  notices: $('notices'),
  grid: $('grid'),
  overlay: $('grid-overlay'),
  popover: $('popover'),
  hoursLabel: $('hours-label'),
  tzLabel: $('tz-label'),
};

const nameByEmail = new Map(SE_ROSTER.map((se) => [se.email, se.name]));
const fullName = (email) => nameByEmail.get(email) ?? email;
const firstName = (email) => fullName(email).split(' ')[0];

// ---- Boot ----
els.hoursLabel.textContent = `${fmtClock(...BUSINESS_HOURS.start)} – ${fmtClock(...BUSINESS_HOURS.end)}`;
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
els.callType.addEventListener('change', onIntakeChange);
els.company.addEventListener('input', onIntakeChange);
els.dealUrl.addEventListener('input', onIntakeChange);
els.products.addEventListener('change', onProductChange);
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
    me = await getMe();
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
      loadAvailability(accessToken, { weekOf, minMs: minMinutes * 60_000 }),
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
    // Optional in v1.5; becomes required and drives company name + Deal Collaborator in v2 (§12).
    dealUrl: els.dealUrl.value.trim(),
  };
}

function onIntakeChange() {
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
  if (intake.dealUrl) box.append(row('Deal', intake.dealUrl));
  const book = el('button', { className: 'btn btn-primary', type: 'button', textContent: 'Book', disabled: true });
  book.title = 'Booking arrives in the next build step';
  box.append(book);
  return box;

  function row(label, value, muted = false) {
    const r = el('div', { className: 'summary-row' });
    r.append(el('span', { className: 'summary-label', textContent: label }), el('span', { className: muted ? 'muted' : '', textContent: value }));
    return r;
  }
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

/** Time axis, five day columns with hour lines, today highlight, past shading. Windows come later. */
function renderGridSkeleton() {
  const { start } = weekBounds(weekOf);
  const dayStartMin = BUSINESS_HOURS.start[0] * 60 + BUSINESS_HOURS.start[1];
  const dayEndMin = BUSINESS_HOURS.end[0] * 60 + BUSINESS_HOURS.end[1];
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
    // Shade the part of the day that is already gone.
    const dayStart = new Date(d).setHours(BUSINESS_HOURS.start[0], BUSINESS_HOURS.start[1], 0, 0);
    const dayEnd = new Date(d).setHours(BUSINESS_HOURS.end[0], BUSINESS_HOURS.end[1], 0, 0);
    if (now > dayStart) {
      const past = el('div', { className: 'past' });
      past.style.height = `${((Math.min(+now, dayEnd) - dayStart) / 60_000) * PX_PER_MIN}px`;
      col.append(past);
    }
    body.append(col);
  }

  els.grid.replaceChildren(header, body);
}

/** Place offerable windows into the day columns. Rebuilds the skeleton so stale blocks go away. */
function renderWindows() {
  closePopover();
  renderGridSkeleton();
  const cols = new Map([...els.grid.querySelectorAll('.day-col')].map((c) => [c.dataset.day, c]));
  const dayStartMin = BUSINESS_HOURS.start[0] * 60 + BUSINESS_HOURS.start[1];

  for (const w of data.offerable) {
    const s = new Date(w.start);
    const col = cols.get(s.toDateString());
    if (!col) continue;
    const top = (s.getHours() * 60 + s.getMinutes() - dayStartMin) * PX_PER_MIN;
    const height = ((w.end - w.start) / 60_000) * PX_PER_MIN;
    const block = el('button', { className: 'window', type: 'button' });
    block.style.top = `${top}px`;
    block.style.height = `${height}px`;
    block.title = `${fmtTime(w.start)} – ${fmtTime(w.end)} · ${w.ses.map(fullName).join(', ')} — click to pick a start time`;
    block.append(
      el('span', { className: 'window-time', textContent: `${fmtTime(w.start)} – ${fmtTime(w.end)}` }),
      el('span', { className: 'window-ses', textContent: w.ses.map(firstName).join(' · ') }),
    );
    if (height < 40) block.classList.add('is-short');
    block.addEventListener('click', () => openPopover(w, block));
    col.append(block);
  }

  if (data.offerable.length) hideOverlay();
  else showOverlay('empty');
}

function renderPeopleNotices() {
  const notices = [];
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
    ...items.map((n) => el('div', { className: `notice notice-${n.kind}`, textContent: n.text })),
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
