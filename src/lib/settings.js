// Admin-managed settings: the SE roster and business hours (Project Plan §2 "sales ops admin",
// §7 "Archie app config store"). The values in config.js are the seed and the fallback.
// Editing is gated by an admin allow-list — a UI gate, not a security boundary. No DOM code.
import { SE_ROSTER, BUSINESS_HOURS, ADMIN_EMAILS } from './config.js';
import { kvStore } from './store.js';

export const SETTINGS_KEY = 'config:settings';

/** @typedef {{ roster: Array<{ email: string, name: string }>, businessHours: { start: [number, number], end: [number, number] } }} Settings */

export function defaultSettings() {
  return structuredClone({ roster: SE_ROSTER, businessHours: BUSINESS_HOURS });
}

export function isAdmin(email) {
  return ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(String(email ?? '').toLowerCase());
}

/**
 * Validate a candidate Settings object. Returns a list of human-readable problems (empty = valid).
 * Emails are lower-cased and names trimmed in place so the saved value is canonical.
 */
export function validateSettings(s) {
  const problems = [];
  if (!s || typeof s !== 'object') return ['Settings must be an object.'];

  if (!Array.isArray(s.roster) || s.roster.length === 0) {
    problems.push('The roster needs at least one SE.');
  } else {
    const seen = new Set();
    s.roster.forEach((se, i) => {
      const email = String(se?.email ?? '').trim().toLowerCase();
      const name = String(se?.name ?? '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push(`SE ${i + 1}: "${email || '(blank)'}" is not a valid email.`);
      else if (seen.has(email)) problems.push(`SE ${i + 1}: ${email} is listed twice.`);
      seen.add(email);
      if (!name) problems.push(`SE ${i + 1}: name is required.`);
      if (se && typeof se === 'object') Object.assign(se, { email, name });
    });
  }

  const hm = (v) =>
    Array.isArray(v) && v.length === 2 && Number.isInteger(v[0]) && Number.isInteger(v[1]) && v[0] >= 0 && v[0] <= 23 && [0, 15, 30, 45].includes(v[1]);
  const bh = s.businessHours;
  if (!bh || !hm(bh.start) || !hm(bh.end)) {
    problems.push('Business hours must be quarter-hour times like 8:30 and 17:30.');
  } else if (bh.start[0] * 60 + bh.start[1] >= bh.end[0] * 60 + bh.end[1]) {
    problems.push('Business hours must start before they end.');
  }
  return problems;
}

/**
 * The current settings: the stored value when it exists and is valid, else the defaults.
 * Never throws. `source` says which one you got.
 * @returns {Promise<Settings & { source: 'store' | 'defaults' }>}
 */
export async function loadSettings() {
  try {
    const stored = await kvStore().get(SETTINGS_KEY);
    if (stored && validateSettings(stored).length === 0) {
      return { roster: stored.roster, businessHours: stored.businessHours, source: 'store' };
    }
  } catch {
    /* fall through to defaults */
  }
  return { ...defaultSettings(), source: 'defaults' };
}

/**
 * Validate and persist. Throws with the problems joined if invalid; nothing is written then.
 * @returns {Promise<Settings>} the canonical saved value
 */
export async function saveSettings(candidate) {
  const s = structuredClone({ roster: candidate.roster, businessHours: candidate.businessHours });
  const problems = validateSettings(s);
  if (problems.length) throw Object.assign(new Error(problems.join(' ')), { problems });
  await kvStore().set(SETTINGS_KEY, s);
  return s;
}
