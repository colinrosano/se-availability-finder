// UI for the week grid. All DOM code lives here; the data layer is in ./lib/.
import { SE_ROSTER, BUSINESS_HOURS, DURATION_OPTIONS } from './lib/config.js';
import { requestAccessToken } from './lib/auth.js';
import { loadAvailability, computeAvailability } from './lib/availability.js';
import { weekBounds, defaultWeekOf, addWeeks } from './lib/businessDays.js';

const PX_PER_MIN = 1; // grid scale: 1 minute = 1px → a 9-hour day is 540px tall
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const PREF_KEY = 'seaf.minMinutes';

// ---- State (all in memory; the access token is never stored) ----
let accessToken = null;
let weekOf = defaultWeekOf(new Date());
let minMinutes = readPref();
let data = null; // last successful loadAvailability() result

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
  durations: $('duration-options'),
  notices: $('notices'),
  grid: $('grid'),
  overlay: $('grid-overlay'),
  hoursLabel: $('hours-label'),
  tzLabel: $('tz-label'),
};

const nameByEmail = new Map(SE_ROSTER.map((se) => [se.email, se.name]));
const firstName = (email) => (nameByEmail.get(email) ?? email.split('@')[0]).split(' ')[0];

// ---- Boot ----
els.hoursLabel.textContent = `${fmtClock(...BUSINESS_HOURS.start)} – ${fmtClock(...BUSINESS_HOURS.end)}`;
els.tzLabel.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone;
renderDurationOptions();
renderWeekHeader();
renderGridSkeleton();
showOverlay('connect');

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

// ---- Actions ----
async function connect() {
  els.connect.disabled = true;
  try {
    accessToken = await requestAccessToken();
    els.connect.hidden = true;
    els.refresh.hidden = false;
    await load();
  } catch (err) {
    setNotices([{ kind: 'error', text: err.message }]);
  } finally {
    els.connect.disabled = false;
  }
}

async function load() {
  if (!accessToken) return showOverlay('connect');
  showOverlay('loading');
  els.refresh.disabled = true;
  try {
    data = await loadAvailability(accessToken, { weekOf, minMs: minMinutes * 60_000 });
    els.asOf.textContent = `As of ${fmtTime(data.fetchedAt)}`;
    renderWeekHeader();
    renderWindows();
    renderPeopleNotices();
  } catch (err) {
    if (err.status === 401) {
      // Token expired (~1 hr). Ask for a fresh one; nothing is stored.
      accessToken = null;
      data = null;
      els.connect.textContent = 'Reconnect Google Calendar';
      els.connect.hidden = false;
      els.refresh.hidden = true;
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
  renderWeekHeader();
  renderGridSkeleton();
  if (accessToken) load();
  else showOverlay('connect');
}

function changeDuration(minutes) {
  minMinutes = minutes;
  writePref(minutes);
  renderDurationOptions();
  if (!data) return;
  // Pure recompute from the calendars already in memory; no refetch.
  const { people, offerable } = computeAvailability(data.ids, data.calendars, data.windows, {
    minMs: minutes * 60_000,
  });
  data = { ...data, people, offerable };
  renderWindows();
}

// ---- Rendering ----
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
      past.style.height = `${(Math.min(+now, dayEnd) - dayStart) / 60_000 * PX_PER_MIN}px`;
      col.append(past);
    }
    body.append(col);
  }

  els.grid.replaceChildren(header, body);
}

/** Place offerable windows into the day columns. Rebuilds the skeleton so stale blocks go away. */
function renderWindows() {
  renderGridSkeleton();
  const cols = new Map([...els.grid.querySelectorAll('.day-col')].map((c) => [c.dataset.day, c]));
  const dayStartMin = BUSINESS_HOURS.start[0] * 60 + BUSINESS_HOURS.start[1];

  for (const w of data.offerable) {
    const s = new Date(w.start);
    const col = cols.get(s.toDateString());
    if (!col) continue;
    const top = (s.getHours() * 60 + s.getMinutes() - dayStartMin) * PX_PER_MIN;
    const height = ((w.end - w.start) / 60_000) * PX_PER_MIN;
    const block = el('div', { className: 'window' });
    block.style.top = `${top}px`;
    block.style.height = `${height}px`;
    block.title = `${fmtTime(w.start)} – ${fmtTime(w.end)} · ${w.ses.map((e) => nameByEmail.get(e) ?? e).join(', ')}`;
    block.append(
      el('span', { className: 'window-time', textContent: `${fmtTime(w.start)} – ${fmtTime(w.end)}` }),
      el('span', { className: 'window-ses', textContent: w.ses.map(firstName).join(' · ') }),
    );
    if (height < 40) block.classList.add('is-short');
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
    const who = isMe ? 'your calendar' : `${nameByEmail.get(p.id) ?? p.id}'s calendar`;
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
