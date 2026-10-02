// Booking intake vocabulary, event naming, and start-time chips (Project Plan §11). Pure.

export const PRODUCTS = {
  cookie_consent: 'Cookie Consent',
  unified_consent: 'Unified Consent',
  subject_rights: 'Subject Rights',
  data_mapping: 'Data Mapping',
  vendor_monitoring: 'Vendor Monitoring',
  assessments: 'Assessments',
  full_platform: 'Full Platform',
};

export const CALL_TYPES = {
  discovery: 'Discovery',
  demo: 'Demo',
  trial_kickoff: 'Trial Kickoff',
  trial_working_session: 'Trial Working Session',
  trial_wrap_up: 'Trial Wrap-Up',
  technical_qa: 'Technical Q&A',
};

// Duration is an independent AE choice, not derived from call type.
export const DURATIONS = [30, 45, 60];

export const MODULES = Object.keys(PRODUCTS).filter((k) => k !== 'full_platform');

const MIN = 60_000;
const QUARTER_MS = 15 * MIN;
export const CHIP_STEP_MIN = 15; // Pilot feedback (Sep 30 2026) chose 15 over the §11 default of 30 ("can be loosened to 15 if the pilot shows demand")

/** Full Platform wins outright; all six modules collapse to it. */
export function normalizeProducts(keys) {
  if (keys.includes('full_platform')) return ['full_platform'];
  if (MODULES.every((m) => keys.includes(m))) return ['full_platform'];
  return keys.filter((k) => MODULES.includes(k));
}

/**
 * Three-band product segment for the title (decided Sep 2026 — long module lists made
 * prospect-visible titles unreadable): 1–2 modules spelled out and joined with " + ",
 * 3–5 → "Multi-Product", all six or Full Platform → "Full Platform".
 */
export function productTitleSegment(productKeys) {
  const keys = normalizeProducts(productKeys);
  if (keys[0] === 'full_platform') return PRODUCTS.full_platform;
  if (keys.length >= 3) return 'Multi-Product';
  return keys.map((k) => PRODUCTS[k]).join(' + ');
}

/** `Osano // {Company} - {Product segment} {Call Type}` */
export function buildEventTitle({ companyName, productKeys, callTypeKey }) {
  return `Osano // ${companyName.trim()} - ${productTitleSegment(productKeys)} ${CALL_TYPES[callTypeKey]}`;
}

/** The exact module selection always goes in the event description, whatever the title band. */
export function buildEventDescription({ productKeys }) {
  const names = normalizeProducts(productKeys).map((k) => PRODUCTS[k]);
  return `Products: ${names.join(', ')}`;
}

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/**
 * Parse a free-text list of prospect emails (comma, semicolon, or whitespace separated).
 * Lower-cased and deduped. Anything that isn't an email is reported, not dropped silently.
 * @returns {{ emails: string[], invalid: string[] }}
 */
export function parseEmails(text) {
  const emails = [];
  const invalid = [];
  for (const raw of String(text ?? '').split(/[\s,;]+/)) {
    if (!raw) continue;
    const e = raw.replace(/^<|>$/g, '').toLowerCase();
    if (!EMAIL_RE.test(e)) invalid.push(raw);
    else if (!emails.includes(e)) emails.push(e);
  }
  return { emails, invalid };
}

/** True when every required field is present. */
export function isIntakeComplete({ companyName, productKeys, callTypeKey, durationMin }) {
  return Boolean(
    companyName?.trim() &&
      normalizeProducts(productKeys ?? []).length &&
      CALL_TYPES[callTypeKey] &&
      DURATIONS.includes(durationMin),
  );
}

/** Round an epoch-ms instant up to the next quarter hour (all UTC offsets are multiples of 15 min). */
export function snapUpToQuarter(ms) {
  return Math.ceil(ms / QUARTER_MS) * QUARTER_MS;
}

/**
 * Valid start times inside an open window for a meeting of `durationMin` minutes:
 * quarter-hour aligned (edges snap UP), stepping every `stepMin`, and `start + duration` must fit.
 * A 10:15–12:00 window with 30 min offers 10:15 / 10:45 / 11:15.
 * @returns {number[]} epoch ms
 */
export function startTimes(window, durationMin, stepMin = CHIP_STEP_MIN) {
  const durMs = durationMin * MIN;
  const out = [];
  for (let t = snapUpToQuarter(window.start); t + durMs <= window.end; t += stepMin * MIN) out.push(t);
  return out;
}

/**
 * Which SEs are free for the whole slot [start, end). `seFree` maps email → sorted, merged
 * intervals of that SE's overlap with the AE (from computeAvailability).
 * @returns {string[]} emails, in roster order
 */
export function sesFreeFor(seFree, start, end) {
  return Object.entries(seFree)
    .filter(([, ivs]) => ivs.some((iv) => iv.start <= start && iv.end >= end))
    .map(([email]) => email);
}

/**
 * Valid start times for ONE grid block (§11): quarter-hour aligned, stepping every `stepMin`,
 * starting inside the block. A start is valid when ONE SE is free for the whole slot, jointly
 * with the AE. Blocks are merged across SE handoffs, so a start that only two SEs together could
 * span is omitted; a slot may still run past the block's edge when a single SE covers it. The SE
 * assigned at booking is drawn from exactly this per-slot check.
 * @returns {number[]} epoch ms, ascending
 */
export function validStarts(block, seFree, durationMin, stepMin = CHIP_STEP_MIN) {
  const durMs = durationMin * MIN;
  const out = [];
  for (let t = snapUpToQuarter(block.start); t < block.end; t += stepMin * MIN) {
    if (sesFreeFor(seFree, t, t + durMs).length) out.push(t);
  }
  return out;
}
