// Booking log (Project Plan §7, §9, §11): one entry per booking made through the app, distinct from
// the fairness ledger (which exists only to drive assignment equity). Business metadata only — AE,
// assigned SE, call type, company, call date, plus the booked-at timestamp (for ordering and the
// date range) and the HubSpot deal ID when one was linked (the audit trail for the Deal Collaborator
// write, §12). No products, duration, prospect data, or calendar contents. Append-only, full
// history (no retention pruning). Lives in the shared app store (see store.js). No DOM code.
import { kvStore as store } from './store.js';

export const LOG_KEY = 'log:bookings';
export const DEFAULT_RANGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {{
 *   at: string,        // ISO — when the booking was made
 *   callAt: string,    // ISO — the call's start time
 *   ae: string,        // AE email (the viewer who booked)
 *   se: string,        // assigned SE email
 *   callType: string,  // CALL_TYPES key (booking.js), e.g. "demo"
 *   company: string,   // company name as typed / prefilled from the deal
 *   dealId?: string,   // HubSpot deal ID when a deal was linked
 * }} LogEntry
 */

const isIso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/** A stored value is kept only if it has every required field in the right shape. */
export function isLogEntry(e) {
  return Boolean(
    e &&
      typeof e === 'object' &&
      isIso(e.at) &&
      isIso(e.callAt) &&
      typeof e.ae === 'string' &&
      typeof e.se === 'string' &&
      typeof e.callType === 'string' &&
      typeof e.company === 'string' &&
      (e.dealId === undefined || typeof e.dealId === 'string'),
  );
}

/**
 * Every entry, in append order. Never throws; an unreadable log reads as empty.
 * `key` exists so localhost fixture mode can keep its fake bookings in a separate log.
 * @returns {Promise<LogEntry[]>}
 */
export async function readBookingLog({ key = LOG_KEY } = {}) {
  try {
    const value = await store().get(key);
    return Array.isArray(value) ? value.filter(isLogEntry) : [];
  } catch {
    return [];
  }
}

/**
 * Append one booking. Read-modify-write; two AEs booking in the same instant may lose one entry
 * (accepted, same as the ledger, §10).
 * @param {{ ae: string, se: string, callType: string, company: string, callAt: number|Date|string, dealId?: string|null }} booking
 * @returns {Promise<LogEntry[]>} the log after the write
 */
export async function recordBooking(booking, at = new Date(), { key = LOG_KEY } = {}) {
  const entry = {
    at: new Date(at).toISOString(),
    callAt: new Date(booking.callAt).toISOString(),
    ae: String(booking.ae ?? '').trim().toLowerCase(),
    se: String(booking.se ?? '').trim().toLowerCase(),
    callType: String(booking.callType ?? ''),
    company: String(booking.company ?? '').trim(),
  };
  if (booking.dealId != null && String(booking.dealId).trim()) entry.dealId = String(booking.dealId).trim();
  if (!isLogEntry(entry)) throw new Error('Booking log entry is incomplete.');
  const entries = await readBookingLog({ key });
  entries.push(entry);
  await store().set(key, entries);
  return entries;
}

/** Local midnight at the start of the given instant's day. */
export function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The admin view's default: the last DEFAULT_RANGE_DAYS days, as local day bounds. */
export function defaultRange(now = Date.now()) {
  const to = startOfDay(now) + DAY_MS - 1;
  const from = startOfDay(now - (DEFAULT_RANGE_DAYS - 1) * DAY_MS);
  return { from, to };
}

/**
 * Entries whose booked-at time falls within [from, to] (epoch ms, inclusive), newest first.
 * Pass no bounds for the full history, still newest first. Pure.
 * @param {LogEntry[]} entries
 * @param {{ from?: number, to?: number }} [range]
 */
export function filterLog(entries, { from = -Infinity, to = Infinity } = {}) {
  return entries
    .filter((e) => {
      const t = Date.parse(e.at);
      return t >= from && t <= to;
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export const CSV_HEADER = ['Booked at', 'Call date', 'Call time', 'AE', 'Assigned SE', 'Call type', 'Company', 'HubSpot deal ID'];

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** RFC 4180: quote when the field has a comma, quote, or line break; double any quotes inside. */
export function csvField(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV for a spreadsheet, one row per entry in the order given, CRLF line endings. Dates and times
 * are local (the admin's zone). `nameOf` turns an SE email into a display name; `labelOf` turns a
 * call-type key into its label. Both default to identity so the module stays free of UI vocabulary.
 * @param {LogEntry[]} entries
 * @param {{ nameOf?: (email: string) => string, labelOf?: (key: string) => string }} [opts]
 */
export function toCsv(entries, { nameOf = (e) => e, labelOf = (k) => k } = {}) {
  const rows = entries.map((e) => {
    const booked = new Date(e.at);
    const call = new Date(e.callAt);
    return [`${localDate(booked)} ${localTime(booked)}`, localDate(call), localTime(call), e.ae, nameOf(e.se), labelOf(e.callType), e.company, e.dealId ?? ''];
  });
  return [CSV_HEADER, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}
